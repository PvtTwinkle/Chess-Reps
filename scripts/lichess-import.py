#!/usr/bin/env python3
from __future__ import annotations
"""
Lichess PGN Import — Parses Lichess Open Database games into the lichess_moves table.

Streams .pgn.zst files from the Lichess Open Database, replays every move with
python-chess to compute 4-field normalized FENs, and bulk-loads
(position_fen, move_san, rating_bracket) tuples with per-move W/D/L counts
into PostgreSQL.

Rating brackets:
  0 = 0–1000, 1 = 1001–1200, 2 = 1201–1400, 3 = 1401–1600,
  4 = 1601–1800, 5 = 1801–2000, 6 = 2001–2200, 7 = 2201–2400
Games where the moving player is rated >= 2400 are skipped for that move (covered
by the Chessmont/Masters database).

Strategy: COPY (append-only) into an unindexed staging table during import,
then one GROUP BY aggregation pass at the end to consolidate duplicates.

Supports incremental month-by-month import:
  --no-finalize   Parse PGN and append to staging table, skip aggregation.
  --finalize-only Aggregate all staging data into final table (no PGN needed).

Dependencies:
  pip install python-chess psycopg2-binary zstandard

Usage:
  # Single month (parse + finalize in one step):
  python lichess-import.py /data/lichess_2025-02.pgn.zst

  # Multi-month incremental:
  python lichess-import.py /data/lichess_2025-02.pgn.zst --no-finalize
  python lichess-import.py /data/lichess_2025-01.pgn.zst --no-finalize
  python lichess-import.py --finalize-only --min-games 100

  # Other options:
  python lichess-import.py file.pgn.zst --workers 14
  python lichess-import.py file.pgn.zst --resume
  python lichess-import.py --clean

Environment:
  DATABASE_URL  PostgreSQL connection string (required)
  PGN_PATH      Fallback path to .pgn.zst file (CLI arg takes priority)
"""

import argparse
import io
import multiprocessing as mp
import os
import subprocess
import sys
import time
from collections import defaultdict

import chess
import chess.pgn
import psycopg2
import zstandard as zstd


# ── FEN normalization ────────────────────────────────────────────────────────

def normalize_fen(fen: str) -> str:
    parts = fen.split(" ")
    return " ".join(parts[:4])


# ── Rating bracket ───────────────────────────────────────────────────────────
# 0 = 0–1000, 1 = 1001–1200, 2 = 1201–1400, 3 = 1401–1600,
# 4 = 1601–1800, 5 = 1801–2000, 6 = 2001–2200, 7 = 2201–2400

def rating_bracket(elo: int) -> int | None:
    """Return bracket ID 0–7, or None if >= 2400 (covered by Masters)."""
    if elo >= 2400:
        return None
    if elo <= 1000:
        return 0
    # 1001–1200 → 1, 1201–1400 → 2, ..., 2201–2400 → 7
    return min(7, (elo - 1001) // 200 + 1)


# ── Single-game processing (runs in worker processes) ────────────────────────

def process_game_pgn(pgn_str: str) -> dict:
    """Parse a PGN string, replay all moves, return aggregated move data.

    Returns a dict mapping (position_fen, move_san, bracket) -> {
        'to_fen': str,
        'w': int,
        'b': int,
        'd': int,
    }
    """
    game = chess.pgn.read_game(io.StringIO(pgn_str))
    if game is None:
        return {}

    # Header pre-filtering (runs in parallel across workers)
    headers = game.headers
    if headers.get("Variant", "Standard") != "Standard":
        return {}
    if "Casual" in headers.get("Event", ""):
        return {}

    result_str = headers.get("Result", "*")
    if result_str == "1-0":
        result_key = "w"
    elif result_str == "0-1":
        result_key = "b"
    elif result_str == "1/2-1/2":
        result_key = "d"
    else:
        return {}

    try:
        white_elo = int(headers.get("WhiteElo", "0"))
        black_elo = int(headers.get("BlackElo", "0"))
    except ValueError:
        return {}

    white_bracket = rating_bracket(white_elo)
    black_bracket = rating_bracket(black_elo)

    board = game.board()
    moves = {}

    for move in game.mainline_moves():
        # Determine which player is making this move
        is_white = board.turn == chess.WHITE
        bracket = white_bracket if is_white else black_bracket

        # Skip if this player is 2400+ (covered by Masters)
        if bracket is not None:
            from_fen = normalize_fen(board.fen())
            san = board.san(move)
            board.push(move)
            to_fen = normalize_fen(board.fen())

            key = (from_fen, san, bracket)
            if key not in moves:
                moves[key] = {"to_fen": to_fen, "w": 0, "d": 0, "b": 0}
            moves[key][result_key] += 1
        else:
            board.push(move)

    return moves


# ── Checkpoint management ────────────────────────────────────────────────────

def ensure_progress_table(conn):
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS lichess_import_progress (
                id INTEGER PRIMARY KEY,
                games_processed INTEGER NOT NULL DEFAULT 0,
                updated_at TIMESTAMP NOT NULL DEFAULT NOW()
            )
        """)
    conn.commit()


def load_checkpoint(conn) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT games_processed FROM lichess_import_progress WHERE id = 1"
        )
        row = cur.fetchone()
        return row[0] if row else 0


def save_checkpoint(conn, games_processed: int):
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO lichess_import_progress (id, games_processed, updated_at)
            VALUES (1, %s, NOW())
            ON CONFLICT (id) DO UPDATE SET
                games_processed = EXCLUDED.games_processed,
                updated_at = NOW()
        """, (games_processed,))
    conn.commit()


def drop_progress_table(conn):
    with conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS lichess_import_progress")
    conn.commit()


# ── Raw staging table ────────────────────────────────────────────────────────

def ensure_raw_table(conn):
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS lichess_moves_raw (
                position_fen    TEXT    NOT NULL,
                move_san        TEXT    NOT NULL,
                rating_bracket  INTEGER NOT NULL,
                resulting_fen   TEXT    NOT NULL,
                games_played    INTEGER NOT NULL,
                white_wins      INTEGER NOT NULL,
                black_wins      INTEGER NOT NULL,
                draws           INTEGER NOT NULL
            )
        """)
    conn.commit()


# ── Batch processing — COPY-based append ─────────────────────────────────────

def merge_results(all_results: list) -> dict:
    aggregated = defaultdict(lambda: {"to_fen": "", "w": 0, "d": 0, "b": 0})
    for game_moves in all_results:
        for (pos_fen, san, bracket), data in game_moves.items():
            agg = aggregated[(pos_fen, san, bracket)]
            agg["to_fen"] = data["to_fen"]
            agg["w"] += data["w"]
            agg["d"] += data["d"]
            agg["b"] += data["b"]
    return aggregated


def copy_batch(conn, aggregated: dict):
    if not aggregated:
        return

    buf = io.StringIO()
    for (position_fen, move_san, bracket), data in aggregated.items():
        total = data["w"] + data["d"] + data["b"]
        buf.write(
            f"{position_fen}\t{move_san}\t{bracket}\t{data['to_fen']}\t"
            f"{total}\t{data['w']}\t{data['b']}\t{data['d']}\n"
        )
    buf.seek(0)

    with conn.cursor() as cur:
        cur.copy_from(
            buf, "lichess_moves_raw",
            columns=("position_fen", "move_san", "rating_bracket", "resulting_fen",
                     "games_played", "white_wins", "black_wins", "draws")
        )
    conn.commit()


# ── PGN reader — streams from .pgn.zst ──────────────────────────────────────

def read_games_from_zst(pgn_path: str):
    """Yield PGN strings from a zstd-compressed PGN file.

    Uses zstandard for on-the-fly decompression — no need to decompress the
    full file to disk.
    """
    dctx = zstd.ZstdDecompressor()

    with open(pgn_path, "rb") as fh:
        reader = dctx.stream_reader(fh)
        text_stream = io.TextIOWrapper(reader, encoding="utf-8", errors="replace")

        current_lines = []

        for line in text_stream:
            if line.startswith("[Event ") and current_lines:
                pgn_str = "".join(current_lines).strip()
                if pgn_str:
                    yield pgn_str
                current_lines = []

            current_lines.append(line)

        # Yield the last game
        if current_lines:
            pgn_str = "".join(current_lines).strip()
            if pgn_str:
                yield pgn_str


# ── Post-import aggregation ──────────────────────────────────────────────────

def ensure_final_table(conn):
    """Create the final lichess_moves table with PK and index if it doesn't exist."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT EXISTS ("
            "  SELECT FROM information_schema.tables "
            "  WHERE table_name = 'lichess_moves'"
            ")"
        )
        if cur.fetchone()[0]:
            return  # already exists

    print("[lichess] Creating lichess_moves table (first run)...")
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE lichess_moves (
                position_fen    TEXT    NOT NULL,
                move_san        TEXT    NOT NULL,
                rating_bracket  INTEGER NOT NULL,
                resulting_fen   TEXT    NOT NULL,
                games_played    INTEGER NOT NULL DEFAULT 0,
                white_wins      INTEGER NOT NULL DEFAULT 0,
                black_wins      INTEGER NOT NULL DEFAULT 0,
                draws           INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (position_fen, move_san, rating_bracket)
            )
        """)
        cur.execute(
            "CREATE INDEX idx_lichess_position_bracket "
            "ON lichess_moves (position_fen, rating_bracket)"
        )
    conn.commit()


def aggregate_and_finalize(conn, min_games: int):
    """Aggregate raw staging data and merge into the final lichess_moves table.

    Incremental: new data is added to existing rows via ON CONFLICT upsert.
    The final table is never dropped — only --clean resets it.
    """
    print("[lichess] ── Post-import aggregation ──")

    with conn.cursor() as cur:
        cur.execute(
            "SELECT EXISTS ("
            "  SELECT FROM information_schema.tables "
            "  WHERE table_name = 'lichess_moves_raw'"
            ")"
        )
        if not cur.fetchone()[0]:
            print("[lichess] ERROR: No staging table (lichess_moves_raw) found.")
            print("[lichess]   Run the import with a PGN file first, or use --no-finalize to append data.")
            sys.exit(1)

    with conn.cursor() as cur:
        # Use pg_class estimate instead of COUNT(*) — instant on billion-row tables
        cur.execute(
            "SELECT reltuples::BIGINT FROM pg_class WHERE relname = 'lichess_moves_raw'"
        )
        raw_estimate = cur.fetchone()[0]
        if raw_estimate <= 0:
            # Estimate might be stale after COPY; fall back to EXISTS check
            cur.execute("SELECT EXISTS (SELECT 1 FROM lichess_moves_raw LIMIT 1)")
            if not cur.fetchone()[0]:
                print("[lichess] ERROR: Staging table is empty — nothing to aggregate.")
                sys.exit(1)
            raw_estimate = None
        cur.execute(
            "SELECT pg_size_pretty(pg_total_relation_size('lichess_moves_raw'))"
        )
        raw_size = cur.fetchone()[0]
        if raw_estimate:
            print(f"[lichess] Raw staging table: ~{raw_estimate:,} rows ({raw_size})")
        else:
            print(f"[lichess] Raw staging table: {raw_size}")

    # Ensure the final table exists (first run creates it with PK + index)
    ensure_final_table(conn)

    # Count existing rows before merge
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM lichess_moves")
        existing_count = cur.fetchone()[0]
    if existing_count > 0:
        print(f"[lichess] Existing final table: {existing_count:,} rows (will merge)")
    else:
        print("[lichess] Final table is empty (fresh import)")

    # No index on staging table — without it, PostgreSQL uses Parallel Seq Scan
    # which is much faster with many parallel workers than a single-threaded
    # index scan on a billion-row table.

    # Aggregate one rating bracket at a time to keep temp-file usage manageable.
    # Each bracket is ~1/8 of the data, independent since rating_bracket is part
    # of the GROUP BY and the primary key.
    print("[lichess] Aggregating raw data (chunked by rating bracket)...")
    agg_start = time.time()
    total_merged = 0

    if existing_count > 0:
        # Incremental merge — INSERT ... ON CONFLICT upsert into existing table.
        # PostgreSQL cannot parallelize INSERT INTO ... SELECT, but this path
        # only runs for smaller incremental updates, not the initial bulk load.
        for bracket in range(8):
            bracket_start = time.time()
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO lichess_moves
                        (position_fen, move_san, rating_bracket, resulting_fen,
                         games_played, white_wins, black_wins, draws)
                    SELECT
                        position_fen, move_san, rating_bracket, resulting_fen,
                        SUM(games_played)::INTEGER,
                        SUM(white_wins)::INTEGER,
                        SUM(black_wins)::INTEGER,
                        SUM(draws)::INTEGER
                    FROM lichess_moves_raw
                    WHERE rating_bracket = %s
                    GROUP BY position_fen, move_san, rating_bracket, resulting_fen
                    ON CONFLICT (position_fen, move_san, rating_bracket)
                    DO UPDATE SET
                        games_played = lichess_moves.games_played + EXCLUDED.games_played,
                        white_wins   = lichess_moves.white_wins   + EXCLUDED.white_wins,
                        black_wins   = lichess_moves.black_wins   + EXCLUDED.black_wins,
                        draws        = lichess_moves.draws         + EXCLUDED.draws
                """, (bracket,))
                rows = cur.rowcount
                total_merged += rows
            conn.commit()
            bracket_elapsed = time.time() - bracket_start
            elapsed_str = format_duration(bracket_elapsed)
            completed = bracket + 1
            avg_per_bracket = (time.time() - agg_start) / completed
            remaining = avg_per_bracket * (8 - completed)
            eta_str = format_duration(remaining) if completed < 8 else "done"
            print(
                f"[lichess]   Bracket {bracket}: {rows:,} rows ({elapsed_str}) "
                f"— {completed}/8 done, ~{eta_str} remaining"
            )
    else:
        # Fresh import — use CREATE TABLE AS to enable parallel query.
        # PostgreSQL can parallelize CREATE TABLE AS but not INSERT INTO ... SELECT.
        # Build each bracket into a temp table, then combine into the final table.
        temp_tables = []
        for bracket in range(8):
            bracket_start = time.time()
            temp_name = f"_lichess_bracket_{bracket}"
            with conn.cursor() as cur:
                cur.execute(f"DROP TABLE IF EXISTS {temp_name}")
                cur.execute(f"""
                    CREATE TABLE {temp_name} AS
                    SELECT
                        position_fen, move_san, rating_bracket, resulting_fen,
                        SUM(games_played)::INTEGER AS games_played,
                        SUM(white_wins)::INTEGER AS white_wins,
                        SUM(black_wins)::INTEGER AS black_wins,
                        SUM(draws)::INTEGER AS draws
                    FROM lichess_moves_raw
                    WHERE rating_bracket = %s
                    GROUP BY position_fen, move_san, rating_bracket, resulting_fen
                """, (bracket,))
                rows = cur.rowcount
                total_merged += rows
            conn.commit()
            temp_tables.append(temp_name)
            bracket_elapsed = time.time() - bracket_start
            elapsed_str = format_duration(bracket_elapsed)
            completed = bracket + 1
            avg_per_bracket = (time.time() - agg_start) / completed
            remaining = avg_per_bracket * (8 - completed)
            eta_str = format_duration(remaining) if completed < 8 else "done"
            print(
                f"[lichess]   Bracket {bracket}: {rows:,} rows ({elapsed_str}) "
                f"— {completed}/8 done, ~{eta_str} remaining"
            )

        # Combine bracket tables into the final table
        print("[lichess] Combining bracket tables into lichess_moves...")
        combine_start = time.time()
        with conn.cursor() as cur:
            # Drop and recreate the final table without constraints for fast loading
            cur.execute("DROP TABLE IF EXISTS lichess_moves")
            union_parts = " UNION ALL ".join(
                f"SELECT * FROM {t}" for t in temp_tables
            )
            cur.execute(f"CREATE TABLE lichess_moves AS {union_parts}")
            # Add primary key and index
            cur.execute(
                "ALTER TABLE lichess_moves "
                "ADD PRIMARY KEY (position_fen, move_san, rating_bracket)"
            )
            cur.execute(
                "CREATE INDEX idx_lichess_position_bracket "
                "ON lichess_moves (position_fen, rating_bracket)"
            )
            # Clean up temp tables
            for t in temp_tables:
                cur.execute(f"DROP TABLE {t}")
        conn.commit()
        print(
            f"[lichess]   Combined and indexed in "
            f"{format_duration(time.time() - combine_start)}"
        )

    agg_elapsed = time.time() - agg_start
    print(
        f"[lichess]   Aggregated {total_merged:,} total rows "
        f"in {format_duration(agg_elapsed)}"
    )

    # Drop raw staging table
    with conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS lichess_moves_raw")
    conn.commit()

    # Step 4: Filter rare moves (re-apply to full table after merge)
    print(f"[lichess] Removing moves with fewer than {min_games} games...")
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM lichess_moves WHERE games_played < %s", (min_games,)
        )
        deleted = cur.rowcount
        print(f"[lichess]   Deleted {deleted:,} rare move entries")
    conn.commit()

    # Step 5: Vacuum
    print("[lichess] Running VACUUM ANALYZE...")
    old_autocommit = conn.autocommit
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("VACUUM ANALYZE lichess_moves")
    conn.autocommit = old_autocommit

    # Final stats
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM lichess_moves")
        total_rows = cur.fetchone()[0]
        cur.execute("SELECT COUNT(DISTINCT position_fen) FROM lichess_moves")
        total_positions = cur.fetchone()[0]
        cur.execute(
            "SELECT pg_size_pretty(pg_total_relation_size('lichess_moves'))"
        )
        table_size = cur.fetchone()[0]

    print(
        f"[lichess] Final: {total_rows:,} move entries "
        f"across {total_positions:,} positions ({table_size} on disk)"
    )


# ── pg_dump export ───────────────────────────────────────────────────────────

def dump_table(db_url: str, output_path: str = "lichess-moves-dump.sql.gz"):
    """Export the lichess_moves table to a compressed SQL dump file."""
    print(f"[lichess] Dumping lichess_moves table to {output_path}...")
    start = time.time()

    cmd = f'pg_dump -t lichess_moves --no-owner --no-privileges "{db_url}" | gzip > "{output_path}"'
    result = subprocess.run(["sh", "-c", cmd], capture_output=True, text=True)

    if result.returncode != 0:
        print(f"[lichess] ERROR: pg_dump failed: {result.stderr.strip()}")
        sys.exit(1)

    elapsed = time.time() - start
    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"[lichess] Dump complete: {size_mb:.1f} MB in {format_duration(elapsed)}")


# ── Progress reporting ───────────────────────────────────────────────────────

def format_duration(seconds: float) -> str:
    if seconds < 60:
        return f"{seconds:.0f}s"
    if seconds < 3600:
        return f"{seconds / 60:.1f}m"
    return f"{seconds / 3600:.1f}h"


def report_progress(games_processed: int, start_time: float, total_estimate: int):
    elapsed = time.time() - start_time
    rate = games_processed / elapsed if elapsed > 0 else 0
    pct = (games_processed / total_estimate * 100) if total_estimate > 0 else 0
    eta = (total_estimate - games_processed) / rate if rate > 0 else 0

    print(
        f"[lichess] {games_processed:>12,} / ~{total_estimate:,} games "
        f"({pct:5.1f}%) -- {rate:,.0f} games/sec -- "
        f"elapsed {format_duration(elapsed)} -- ETA {format_duration(eta)}"
    )


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Import Lichess Open Database PGN into lichess_moves table."
    )
    parser.add_argument(
        "pgn", nargs="?", default=None,
        help="Path to .pgn.zst file (overrides PGN_PATH env var)"
    )
    parser.add_argument(
        "--workers", type=int, default=4,
        help="Number of parallel worker processes (default: 4)"
    )
    parser.add_argument(
        "--batch-size", type=int, default=5000,
        help="Number of games per batch (default: 5000)"
    )
    parser.add_argument(
        "--min-games", type=int, default=100,
        help="Minimum games for a move to be kept in final table (default: 100)"
    )
    parser.add_argument(
        "--resume", action="store_true",
        help="Resume from last checkpoint"
    )
    parser.add_argument(
        "--clean", action="store_true",
        help="Drop all data and re-import from scratch"
    )
    parser.add_argument(
        "--total-games", type=int, default=100_000_000,
        help="Estimated total games for progress display (default: 100000000)"
    )
    parser.add_argument(
        "--no-finalize", action="store_true",
        help="Parse PGN and append to staging table, but skip aggregation. "
             "Use this when loading multiple months before finalizing."
    )
    parser.add_argument(
        "--finalize-only", action="store_true",
        help="Skip PGN parsing. Aggregate all staging data into the final "
             "lichess_moves table. No PGN file needed."
    )
    parser.add_argument(
        "--dump", action="store_true",
        help="After finalization, export lichess_moves to "
             "lichess-moves-dump.sql.gz via pg_dump."
    )
    args = parser.parse_args()

    if args.no_finalize and args.finalize_only:
        print("[lichess] ERROR: --no-finalize and --finalize-only are mutually exclusive")
        sys.exit(1)

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("[lichess] ERROR: DATABASE_URL environment variable is required")
        sys.exit(1)

    conn = psycopg2.connect(db_url)

    # ── Finalize-only mode: aggregate existing raw data, then exit ────────
    if args.finalize_only:
        print("[lichess] Finalize-only mode — aggregating existing staging data")
        with conn.cursor() as cur:
            cur.execute("SET work_mem = '1GB'")
            cur.execute("SET max_parallel_workers_per_gather = 16")
            cur.execute("SET effective_cache_size = '24GB'")
        aggregate_and_finalize(conn, args.min_games)
        drop_progress_table(conn)
        if args.dump:
            dump_table(db_url)
        print("[lichess] Finalize complete.")
        conn.close()
        return

    # ── Clean mode: drop all data and exit ──────────────────────────────
    if args.clean:
        print("[lichess] Dropping all import data (--clean flag)...")
        ensure_progress_table(conn)
        with conn.cursor() as cur:
            cur.execute("DROP TABLE IF EXISTS lichess_moves_raw")
            cur.execute("DROP TABLE IF EXISTS lichess_moves")
            cur.execute(
                "DELETE FROM lichess_import_progress WHERE id = 1"
            )
        conn.commit()
        print("[lichess] Clean complete — all lichess data removed.")
        conn.close()
        return

    # ── Resolve PGN path ──────────────────────────────────────────────────
    pgn_path = args.pgn or os.environ.get("PGN_PATH")
    if not pgn_path:
        print("[lichess] ERROR: PGN file path required (positional arg or PGN_PATH env var)")
        sys.exit(1)
    if not os.path.exists(pgn_path):
        print(f"[lichess] ERROR: PGN file not found at {pgn_path}")
        sys.exit(1)

    print(f"[lichess] PGN file: {pgn_path}")
    print(f"[lichess] Workers: {args.workers}")
    print(f"[lichess] Batch size: {args.batch_size:,}")
    print(f"[lichess] Min games filter: {args.min_games}")
    if args.no_finalize:
        print(f"[lichess] Mode: parse only (--no-finalize) — will skip aggregation")
    else:
        print(f"[lichess] Mode: parse + finalize")
    print(f"[lichess] Strategy: zstd stream → header filter → COPY append → aggregate")

    # Tuning for bulk import
    with conn.cursor() as cur:
        cur.execute("SET synchronous_commit = OFF")
        cur.execute("SET work_mem = '1GB'")
        cur.execute("SET max_parallel_workers_per_gather = 16")
        cur.execute("SET effective_cache_size = '24GB'")

    ensure_progress_table(conn)

    if args.resume:
        resume_from = load_checkpoint(conn)
        if resume_from > 0:
            print(f"[lichess] Resuming from game {resume_from:,}")
        else:
            print("[lichess] No checkpoint found, starting from the beginning")
    else:
        resume_from = 0

    ensure_raw_table(conn)

    # Process games
    start_time = time.time()
    games_processed = 0
    games_yielded = 0
    batch = []
    pool = mp.Pool(args.workers)

    try:
        for pgn_str in read_games_from_zst(pgn_path):
            games_yielded += 1

            # Skip already-processed games when resuming
            if games_yielded <= resume_from:
                continue

            batch.append(pgn_str)

            if len(batch) >= args.batch_size:
                results = pool.map(process_game_pgn, batch)
                aggregated = merge_results(results)
                copy_batch(conn, aggregated)

                games_processed += len(batch)
                total_so_far = resume_from + games_processed
                save_checkpoint(conn, total_so_far)

                if total_so_far % 10_000 < args.batch_size:
                    report_progress(
                        total_so_far, start_time, args.total_games
                    )

                batch = []

        # Process remaining games
        if batch:
            results = pool.map(process_game_pgn, batch)
            aggregated = merge_results(results)
            copy_batch(conn, aggregated)
            games_processed += len(batch)
            total_so_far = resume_from + games_processed
            save_checkpoint(conn, total_so_far)

    except KeyboardInterrupt:
        total_so_far = resume_from + games_processed
        save_checkpoint(conn, total_so_far)
        print(
            f"\n[lichess] Interrupted. Checkpoint saved at game {total_so_far:,}. "
            f"Use --resume to continue."
        )
        pool.terminate()
        pool.join()
        conn.close()
        sys.exit(1)
    finally:
        pool.close()
        pool.join()

    elapsed = time.time() - start_time
    total_so_far = resume_from + games_processed
    print(
        f"[lichess] Parsing complete: {total_so_far:,} games "
        f"in {format_duration(elapsed)}"
    )

    # Aggregate raw data into final table (unless --no-finalize)
    if args.no_finalize:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM lichess_moves_raw")
            raw_count = cur.fetchone()[0]
        print(
            f"[lichess] Skipping aggregation (--no-finalize). "
            f"Raw staging table has {raw_count:,} rows."
        )
        print("[lichess] Run again with --finalize-only when ready to aggregate.")
    else:
        aggregate_and_finalize(conn, args.min_games)
        drop_progress_table(conn)
        if args.dump:
            dump_table(db_url)
        print("[lichess] Import complete.")

    conn.close()


if __name__ == "__main__":
    main()
