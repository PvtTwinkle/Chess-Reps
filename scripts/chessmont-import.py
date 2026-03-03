#!/usr/bin/env python3
"""
Chessmont PGN Import — Parses master games into the chessmont_moves table.

Streams chessmont.pgn game by game, replays every move with python-chess to
compute 4-field normalized FENs, and upserts (position_fen, move_san) pairs
with per-move W/D/L counts into PostgreSQL.

Usage:
  python chessmont-import.py                        # 4 workers, batch 5000
  python chessmont-import.py --workers 8            # more parallelism
  python chessmont-import.py --resume               # continue from checkpoint
  python chessmont-import.py --clean                # truncate and re-import
  python chessmont-import.py --min-games 5          # custom filter (default 2)
  python chessmont-import.py --batch-size 10000     # larger batches

Environment:
  DATABASE_URL  PostgreSQL connection string (required)
  PGN_PATH      Path to chessmont.pgn (default: /data/chessmont.pgn)
"""

import argparse
import io
import multiprocessing as mp
import os
import sys
import time
from collections import defaultdict

import chess
import chess.pgn
import psycopg2
from psycopg2.extras import execute_values


# ── FEN normalization ────────────────────────────────────────────────────────
# Strip halfmove clock and fullmove number, keeping only the 4 fields that
# define a unique position: piece placement, side to move, castling rights,
# and en-passant target square. This matches the fenKey() convention used
# throughout the Chess Reps app and handles transpositions correctly.

def normalize_fen(fen: str) -> str:
    parts = fen.split(" ")
    return " ".join(parts[:4])


# ── Single-game processing (runs in worker processes) ────────────────────────

def process_game_pgn(pgn_str: str) -> dict:
    """Parse a PGN string, replay all moves, return aggregated move data.

    Returns a dict mapping (position_fen, move_san) -> {
        'to_fen': str,
        'w': int,   # white wins
        'b': int,   # black wins
        'd': int,   # draws
    }
    """
    game = chess.pgn.read_game(io.StringIO(pgn_str))
    if game is None:
        return {}

    result_str = game.headers.get("Result", "*")
    if result_str == "1-0":
        result_key = "w"
    elif result_str == "0-1":
        result_key = "b"
    elif result_str == "1/2-1/2":
        result_key = "d"
    else:
        return {}  # unfinished/unknown result, skip

    board = game.board()
    moves = {}

    for move in game.mainline_moves():
        from_fen = normalize_fen(board.fen())
        san = board.san(move)
        board.push(move)
        to_fen = normalize_fen(board.fen())

        key = (from_fen, san)
        if key not in moves:
            moves[key] = {"to_fen": to_fen, "w": 0, "d": 0, "b": 0}
        moves[key][result_key] += 1

    return moves


# ── Checkpoint management (stored in PostgreSQL) ─────────────────────────────

def ensure_progress_table(conn):
    """Create the import progress tracking table if it doesn't exist."""
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS chessmont_import_progress (
                id INTEGER PRIMARY KEY,
                games_processed INTEGER NOT NULL DEFAULT 0,
                updated_at TIMESTAMP NOT NULL DEFAULT NOW()
            )
        """)
    conn.commit()


def load_checkpoint(conn) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT games_processed FROM chessmont_import_progress WHERE id = 1"
        )
        row = cur.fetchone()
        return row[0] if row else 0


def save_checkpoint(conn, games_processed: int):
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO chessmont_import_progress (id, games_processed, updated_at)
            VALUES (1, %s, NOW())
            ON CONFLICT (id) DO UPDATE SET
                games_processed = EXCLUDED.games_processed,
                updated_at = NOW()
        """, (games_processed,))
    conn.commit()


def drop_progress_table(conn):
    """Clean up the progress table after a successful import."""
    with conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS chessmont_import_progress")
    conn.commit()


# ── Batch processing and upsert ──────────────────────────────────────────────

def merge_results(all_results: list) -> dict:
    """Merge per-game move dicts into one aggregated dict."""
    aggregated = defaultdict(lambda: {"to_fen": "", "w": 0, "d": 0, "b": 0})
    for game_moves in all_results:
        for (pos_fen, san), data in game_moves.items():
            agg = aggregated[(pos_fen, san)]
            agg["to_fen"] = data["to_fen"]
            agg["w"] += data["w"]
            agg["d"] += data["d"]
            agg["b"] += data["b"]
    return aggregated


def upsert_batch(conn, aggregated: dict):
    """Upsert aggregated move data into chessmont_moves."""
    if not aggregated:
        return

    rows = []
    for (position_fen, move_san), data in aggregated.items():
        total = data["w"] + data["d"] + data["b"]
        rows.append((
            position_fen, move_san, data["to_fen"],
            total, data["w"], data["b"], data["d"],
        ))

    sql = """
        INSERT INTO chessmont_moves
            (position_fen, move_san, resulting_fen,
             games_played, white_wins, black_wins, draws)
        VALUES %s
        ON CONFLICT (position_fen, move_san) DO UPDATE SET
            games_played = chessmont_moves.games_played + EXCLUDED.games_played,
            white_wins   = chessmont_moves.white_wins   + EXCLUDED.white_wins,
            black_wins   = chessmont_moves.black_wins   + EXCLUDED.black_wins,
            draws        = chessmont_moves.draws         + EXCLUDED.draws
    """
    with conn.cursor() as cur:
        execute_values(cur, sql, rows, page_size=2000)
    conn.commit()


# ── PGN reader (produces complete PGN strings for each game) ─────────────────

def read_games_as_pgn_strings(pgn_path: str):
    """Yield one PGN string per game from a multi-game PGN file.

    Uses a simple line-by-line approach: accumulate lines until we hit a new
    game header (a line starting with '[Event ') after we already have content.
    This avoids loading the entire file into memory.
    """
    current_lines = []

    with open(pgn_path, "r", errors="replace") as f:
        for line in f:
            # Detect start of a new game
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


# ── Post-import cleanup ──────────────────────────────────────────────────────

def post_import_cleanup(conn, min_games: int):
    """Remove rare moves, create index, vacuum."""
    print(f"[chessmont] Removing moves with fewer than {min_games} games...")
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM chessmont_moves WHERE games_played < %s", (min_games,)
        )
        deleted = cur.rowcount
        print(f"[chessmont] Deleted {deleted:,} rare move entries")
    conn.commit()

    print("[chessmont] Creating index on position_fen...")
    with conn.cursor() as cur:
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_chessmont_position_fen "
            "ON chessmont_moves (position_fen)"
        )
    conn.commit()

    print("[chessmont] Running VACUUM ANALYZE...")
    old_autocommit = conn.autocommit
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("VACUUM ANALYZE chessmont_moves")
    conn.autocommit = old_autocommit

    # Final stats
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM chessmont_moves")
        total_rows = cur.fetchone()[0]
        cur.execute("SELECT COUNT(DISTINCT position_fen) FROM chessmont_moves")
        total_positions = cur.fetchone()[0]
        cur.execute(
            "SELECT pg_size_pretty(pg_total_relation_size('chessmont_moves'))"
        )
        table_size = cur.fetchone()[0]

    print(f"[chessmont] Final: {total_rows:,} move entries "
          f"across {total_positions:,} positions ({table_size} on disk)")


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
        f"[chessmont] {games_processed:>12,} / ~{total_estimate:,} games "
        f"({pct:5.1f}%) -- {rate:,.0f} games/sec -- "
        f"elapsed {format_duration(elapsed)} -- ETA {format_duration(eta)}"
    )


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Import Chessmont PGN into chessmont_moves table."
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
        "--min-games", type=int, default=2,
        help="Minimum games for a move to be kept (default: 2)"
    )
    parser.add_argument(
        "--resume", action="store_true",
        help="Resume from last checkpoint"
    )
    parser.add_argument(
        "--clean", action="store_true",
        help="Truncate chessmont_moves before importing"
    )
    parser.add_argument(
        "--total-games", type=int, default=21_500_000,
        help="Estimated total games for progress display (default: 21500000)"
    )
    args = parser.parse_args()

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("[chessmont] ERROR: DATABASE_URL environment variable is required")
        sys.exit(1)

    pgn_path = os.environ.get("PGN_PATH", "/data/chessmont.pgn")
    if not os.path.exists(pgn_path):
        print(f"[chessmont] ERROR: PGN file not found at {pgn_path}")
        sys.exit(1)

    print(f"[chessmont] PGN file: {pgn_path}")
    print(f"[chessmont] Workers: {args.workers}")
    print(f"[chessmont] Batch size: {args.batch_size}")
    print(f"[chessmont] Min games filter: {args.min_games}")

    conn = psycopg2.connect(db_url)

    # Tuning for bulk import
    with conn.cursor() as cur:
        cur.execute("SET synchronous_commit = OFF")
        cur.execute("SET work_mem = '256MB'")

    ensure_progress_table(conn)

    if args.clean:
        print("[chessmont] Truncating chessmont_moves (--clean flag)...")
        with conn.cursor() as cur:
            cur.execute("TRUNCATE chessmont_moves")
            cur.execute(
                "DELETE FROM chessmont_import_progress WHERE id = 1"
            )
        conn.commit()
        resume_from = 0
    elif args.resume:
        resume_from = load_checkpoint(conn)
        if resume_from > 0:
            print(f"[chessmont] Resuming from game {resume_from:,}")
        else:
            print("[chessmont] No checkpoint found, starting from the beginning")
    else:
        resume_from = 0
        # Safety check: warn if table already has data
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM chessmont_moves")
            existing = cur.fetchone()[0]
        if existing > 0:
            print(
                f"[chessmont] WARNING: chessmont_moves already has {existing:,} rows. "
                f"Re-importing without --clean will ADD to existing counts. "
                f"Use --clean to start fresh or --resume to continue."
            )

    # Process games
    start_time = time.time()
    games_processed = 0
    games_yielded = 0
    batch = []
    pool = mp.Pool(args.workers)

    try:
        for pgn_str in read_games_as_pgn_strings(pgn_path):
            games_yielded += 1

            # Skip already-processed games when resuming
            if games_yielded <= resume_from:
                continue

            batch.append(pgn_str)

            if len(batch) >= args.batch_size:
                # Process batch in parallel
                results = pool.map(process_game_pgn, batch)
                aggregated = merge_results(results)
                upsert_batch(conn, aggregated)

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
            upsert_batch(conn, aggregated)
            games_processed += len(batch)
            total_so_far = resume_from + games_processed
            save_checkpoint(conn, total_so_far)

    except KeyboardInterrupt:
        total_so_far = resume_from + games_processed
        save_checkpoint(conn, total_so_far)
        print(
            f"\n[chessmont] Interrupted. Checkpoint saved at game {total_so_far:,}. "
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
        f"[chessmont] Parsing complete: {total_so_far:,} games in "
        f"{format_duration(elapsed)}"
    )

    # Post-import cleanup
    post_import_cleanup(conn, args.min_games)
    drop_progress_table(conn)

    print("[chessmont] Import complete.")
    conn.close()


if __name__ == "__main__":
    main()
