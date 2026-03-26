#!/usr/bin/env python3
from __future__ import annotations
"""
Celebrity PGN Import — Parses PGN files into the celebrity_moves table.

Takes a PGN file (plain or zstd-compressed) and a player slug, replays every
game move-by-move to compute 4-field normalized FENs, and bulk-loads
(position_fen, move_san, player_slug) rows with W/D/L counts into PostgreSQL.

Unlike the Lichess import script, this does NOT filter by rating bracket —
the dimension is player_slug instead. There is also no minimum-games filter
since every game from a notable player matters.

Caps parsing at move 30 (60 half-moves) to focus on opening/early middlegame
positions relevant to repertoire building.

Strategy: COPY (append-only) into an unindexed staging table during import,
then one GROUP BY aggregation pass at the end to consolidate duplicates.

Dependencies:
  pip install python-chess psycopg2-binary zstandard

Usage:
  # Import a PGN file for a specific player:
  python celebrity-import.py Carlsen.pgn --player magnus-carlsen --display-name "Magnus Carlsen"

  # Import with platform info (for download script integration):
  python celebrity-import.py Carlsen.pgn --player magnus-carlsen --display-name "Magnus Carlsen" --platform pgn

  # Import a zstd-compressed PGN:
  python celebrity-import.py games.pgn.zst --player hikaru --display-name "Hikaru Nakamura"

  # Register a player without importing any games:
  python celebrity-import.py --register --player magnus-carlsen --display-name "Magnus Carlsen" --platform lichess --platform-username DrNykterstein

  # Finalize (aggregate staging data into final table):
  python celebrity-import.py --finalize-only

  # Remove one player's data:
  python celebrity-import.py --clean --player magnus-carlsen

  # Remove all celebrity data:
  python celebrity-import.py --clean-all

Environment:
  DATABASE_URL  PostgreSQL connection string (required)
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

# Max half-moves to parse per game (30 full moves = 60 half-moves).
MAX_HALF_MOVES = 60


# ── FEN normalization ────────────────────────────────────────────────────────

def normalize_fen(fen: str) -> str:
    parts = fen.split(" ")
    return " ".join(parts[:4])


# ── Single-game processing (runs in worker processes) ────────────────────────

def process_game_pgn(pgn_str: str) -> dict:
    """Parse a PGN string, replay moves (up to move 30), return aggregated data.

    Returns a dict mapping (position_fen, move_san) -> {
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
        return {}

    board = game.board()
    moves = {}
    half_move_count = 0

    for move in game.mainline_moves():
        if half_move_count >= MAX_HALF_MOVES:
            break

        from_fen = normalize_fen(board.fen())
        san = board.san(move)
        board.push(move)

        key = (from_fen, san)
        if key not in moves:
            moves[key] = {"w": 0, "d": 0, "b": 0}
        moves[key][result_key] += 1

        half_move_count += 1

    return moves


# ── Raw staging table ────────────────────────────────────────────────────────

def ensure_raw_table(conn):
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS celebrity_moves_raw (
                position_fen    TEXT    NOT NULL,
                move_san        TEXT    NOT NULL,
                player_slug     TEXT    NOT NULL,
                games_played    INTEGER NOT NULL,
                white_wins      INTEGER NOT NULL,
                black_wins      INTEGER NOT NULL,
                draws           INTEGER NOT NULL
            )
        """)
    conn.commit()


# ── Batch processing — COPY-based append ─────────────────────────────────────

def merge_results(all_results: list) -> dict:
    aggregated = defaultdict(lambda: {"w": 0, "d": 0, "b": 0})
    for game_moves in all_results:
        for (pos_fen, san), data in game_moves.items():
            agg = aggregated[(pos_fen, san)]
            agg["w"] += data["w"]
            agg["d"] += data["d"]
            agg["b"] += data["b"]
    return aggregated


def copy_batch(conn, aggregated: dict, player_slug: str):
    if not aggregated:
        return

    buf = io.StringIO()
    for (position_fen, move_san), data in aggregated.items():
        total = data["w"] + data["d"] + data["b"]
        buf.write(
            f"{position_fen}\t{move_san}\t{player_slug}\t"
            f"{total}\t{data['w']}\t{data['b']}\t{data['d']}\n"
        )
    buf.seek(0)

    with conn.cursor() as cur:
        cur.copy_from(
            buf, "celebrity_moves_raw",
            columns=("position_fen", "move_san", "player_slug",
                     "games_played", "white_wins", "black_wins", "draws")
        )
    conn.commit()


# ── PGN reader — handles both plain .pgn and .pgn.zst ───────────────────────

def read_games(pgn_path: str):
    """Yield PGN strings from a plain or zstd-compressed PGN file."""
    if pgn_path.endswith(".zst"):
        import zstandard as zstd
        dctx = zstd.ZstdDecompressor()
        fh = open(pgn_path, "rb")
        reader = dctx.stream_reader(fh)
        text_stream = io.TextIOWrapper(reader, encoding="utf-8", errors="replace")
    else:
        fh = open(pgn_path, "r", encoding="utf-8", errors="replace")
        text_stream = fh

    try:
        current_lines = []
        for line in text_stream:
            if line.startswith("[Event ") and current_lines:
                pgn_str = "".join(current_lines).strip()
                if pgn_str:
                    yield pgn_str
                current_lines = []
            current_lines.append(line)

        if current_lines:
            pgn_str = "".join(current_lines).strip()
            if pgn_str:
                yield pgn_str
    finally:
        fh.close()


# ── Player registration ─────────────────────────────────────────────────────

def register_player(conn, slug: str, display_name: str,
                    platform: str | None = None,
                    platform_username: str | None = None,
                    category: str | None = None):
    """Upsert a player into the star_players table."""
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO star_players (slug, display_name, platform, platform_username, category)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (slug) DO UPDATE SET
                display_name = EXCLUDED.display_name,
                platform = COALESCE(EXCLUDED.platform, star_players.platform),
                platform_username = COALESCE(EXCLUDED.platform_username, star_players.platform_username),
                category = COALESCE(EXCLUDED.category, star_players.category)
        """, (slug, display_name, platform, platform_username, category))
    conn.commit()
    print(f"[celebrity] Registered player: {display_name} ({slug})")


# ── Post-import aggregation ──────────────────────────────────────────────────

def aggregate_and_finalize(conn, min_games: int = 2):
    """Aggregate raw staging data and merge into the final celebrity_moves table."""
    print("[celebrity] ── Post-import aggregation ──")

    with conn.cursor() as cur:
        cur.execute(
            "SELECT EXISTS ("
            "  SELECT FROM information_schema.tables "
            "  WHERE table_name = 'celebrity_moves_raw'"
            ")"
        )
        if not cur.fetchone()[0]:
            print("[celebrity] ERROR: No staging table (celebrity_moves_raw) found.")
            sys.exit(1)

    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM celebrity_moves_raw")
        raw_count = cur.fetchone()[0]
        if raw_count == 0:
            print("[celebrity] ERROR: Staging table is empty — nothing to aggregate.")
            sys.exit(1)
        print(f"[celebrity] Raw staging table: {raw_count:,} rows")

    # Step 1: Aggregate raw data into a temp table
    print("[celebrity] Aggregating raw data (GROUP BY + SUM)...")
    agg_start = time.time()

    with conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS celebrity_agg_temp")
        cur.execute("""
            CREATE TEMP TABLE celebrity_agg_temp AS
            SELECT
                position_fen,
                move_san,
                player_slug,
                SUM(games_played)::INTEGER AS games_played,
                SUM(white_wins)::INTEGER AS white_wins,
                SUM(black_wins)::INTEGER AS black_wins,
                SUM(draws)::INTEGER AS draws
            FROM celebrity_moves_raw
            GROUP BY position_fen, move_san, player_slug
        """)
    conn.commit()

    agg_elapsed = time.time() - agg_start
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM celebrity_agg_temp")
        agg_count = cur.fetchone()[0]
    print(
        f"[celebrity]   Aggregated to {agg_count:,} unique entries "
        f"in {format_duration(agg_elapsed)}"
    )

    # Step 2: Merge into final table via ON CONFLICT upsert
    print("[celebrity] Merging into final table (INSERT ... ON CONFLICT DO UPDATE)...")
    merge_start = time.time()

    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO celebrity_moves
                (position_fen, move_san, player_slug,
                 games_played, white_wins, black_wins, draws)
            SELECT * FROM celebrity_agg_temp
            ON CONFLICT (position_fen, move_san, player_slug)
            DO UPDATE SET
                games_played = celebrity_moves.games_played + EXCLUDED.games_played,
                white_wins   = celebrity_moves.white_wins   + EXCLUDED.white_wins,
                black_wins   = celebrity_moves.black_wins   + EXCLUDED.black_wins,
                draws        = celebrity_moves.draws         + EXCLUDED.draws
        """)
        merged = cur.rowcount
    conn.commit()

    merge_elapsed = time.time() - merge_start
    print(f"[celebrity]   Merged {merged:,} rows in {format_duration(merge_elapsed)}")

    # Step 3: Drop temp + raw tables
    with conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS celebrity_agg_temp")
        cur.execute("DROP TABLE IF EXISTS celebrity_moves_raw")
    conn.commit()

    # Step 4: Filter rare moves
    if min_games > 1:
        print(f"[celebrity] Removing moves with fewer than {min_games} games...")
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM celebrity_moves WHERE games_played < %s", (min_games,)
            )
            deleted = cur.rowcount
            print(f"[celebrity]   Deleted {deleted:,} rare move entries")
        conn.commit()

    # Step 5: Vacuum
    print("[celebrity] Running VACUUM ANALYZE...")
    old_autocommit = conn.autocommit
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("VACUUM ANALYZE celebrity_moves")
    conn.autocommit = old_autocommit

    # Final stats
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM celebrity_moves")
        total_rows = cur.fetchone()[0]
        cur.execute("SELECT COUNT(DISTINCT player_slug) FROM celebrity_moves")
        total_players = cur.fetchone()[0]
        cur.execute("SELECT COUNT(DISTINCT position_fen) FROM celebrity_moves")
        total_positions = cur.fetchone()[0]
        cur.execute(
            "SELECT pg_size_pretty(pg_total_relation_size('celebrity_moves'))"
        )
        table_size = cur.fetchone()[0]

    print(
        f"[celebrity] Final: {total_rows:,} entries across "
        f"{total_players} players, {total_positions:,} positions ({table_size})"
    )


# ── Progress reporting ───────────────────────────────────────────────────────

def format_duration(seconds: float) -> str:
    if seconds < 60:
        return f"{seconds:.0f}s"
    if seconds < 3600:
        return f"{seconds / 60:.1f}m"
    return f"{seconds / 3600:.1f}h"


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Import celebrity PGN games into the celebrity_moves table."
    )
    parser.add_argument(
        "pgn", nargs="?", default=None,
        help="Path to .pgn or .pgn.zst file"
    )
    parser.add_argument(
        "--player", type=str, default=None,
        help="Player slug, e.g. magnus-carlsen"
    )
    parser.add_argument(
        "--display-name", type=str, default=None,
        help="Player display name, e.g. 'Magnus Carlsen'"
    )
    parser.add_argument(
        "--platform", type=str, default=None,
        choices=["lichess", "chesscom", "pgn"],
        help="Platform for download script integration"
    )
    parser.add_argument(
        "--platform-username", type=str, default=None,
        help="Username on the platform, e.g. DrNykterstein"
    )
    parser.add_argument(
        "--category", type=str, default=None,
        choices=["legend", "gm", "streamer", "meme"],
        help="Player category for dropdown grouping"
    )
    parser.add_argument(
        "--workers", type=int, default=4,
        help="Number of parallel worker processes (default: 4)"
    )
    parser.add_argument(
        "--batch-size", type=int, default=2000,
        help="Number of games per batch (default: 2000)"
    )
    parser.add_argument(
        "--min-games", type=int, default=2,
        help="Minimum games for a move to be kept after aggregation (default: 2)"
    )
    parser.add_argument(
        "--register", action="store_true",
        help="Register the player in star_players without importing games"
    )
    parser.add_argument(
        "--finalize-only", action="store_true",
        help="Aggregate staging data into final table (no PGN needed)"
    )
    parser.add_argument(
        "--clean", action="store_true",
        help="Remove one player's data (requires --player)"
    )
    parser.add_argument(
        "--clean-all", action="store_true",
        help="Remove ALL celebrity data (all players)"
    )
    args = parser.parse_args()

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("[celebrity] ERROR: DATABASE_URL environment variable is required")
        sys.exit(1)

    conn = psycopg2.connect(db_url)

    # ── Register-only mode ────────────────────────────────────────────────
    if args.register:
        if not args.player or not args.display_name:
            print("[celebrity] ERROR: --register requires --player and --display-name")
            sys.exit(1)
        register_player(conn, args.player, args.display_name,
                       args.platform, args.platform_username, args.category)
        conn.close()
        return

    # ── Finalize-only mode ────────────────────────────────────────────────
    if args.finalize_only:
        print("[celebrity] Finalize-only mode — aggregating existing staging data")
        with conn.cursor() as cur:
            cur.execute("SET work_mem = '256MB'")
        aggregate_and_finalize(conn, args.min_games)
        print("[celebrity] Finalize complete.")
        conn.close()
        return

    # ── Clean mode (single player) ───────────────────────────────────────
    if args.clean:
        if not args.player:
            print("[celebrity] ERROR: --clean requires --player")
            sys.exit(1)
        print(f"[celebrity] Removing data for player: {args.player}")
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM celebrity_moves WHERE player_slug = %s",
                (args.player,)
            )
            deleted = cur.rowcount
            cur.execute(
                "DELETE FROM star_players WHERE slug = %s",
                (args.player,)
            )
        conn.commit()
        print(f"[celebrity] Removed {deleted:,} move entries for {args.player}")
        conn.close()
        return

    # ── Clean-all mode ────────────────────────────────────────────────────
    if args.clean_all:
        print("[celebrity] Removing ALL celebrity data (--clean-all)...")
        with conn.cursor() as cur:
            cur.execute("DELETE FROM celebrity_moves")
            deleted = cur.rowcount
            cur.execute("DELETE FROM star_players")
            cur.execute("DROP TABLE IF EXISTS celebrity_moves_raw")
        conn.commit()
        print(f"[celebrity] Removed {deleted:,} move entries and all player records")
        conn.close()
        return

    # ── Import mode ──────────────────────────────────────────────────────
    if not args.pgn:
        print("[celebrity] ERROR: PGN file path required")
        sys.exit(1)
    if not args.player:
        print("[celebrity] ERROR: --player is required for import")
        sys.exit(1)
    if not os.path.exists(args.pgn):
        print(f"[celebrity] ERROR: PGN file not found at {args.pgn}")
        sys.exit(1)

    # Register the player if display name provided
    if args.display_name:
        register_player(conn, args.player, args.display_name,
                       args.platform, args.platform_username, args.category)

    print(f"[celebrity] PGN file: {args.pgn}")
    print(f"[celebrity] Player: {args.player}")
    print(f"[celebrity] Workers: {args.workers}")
    print(f"[celebrity] Max depth: move {MAX_HALF_MOVES // 2}")

    # Tuning for bulk import
    with conn.cursor() as cur:
        cur.execute("SET synchronous_commit = OFF")
        cur.execute("SET work_mem = '256MB'")

    ensure_raw_table(conn)

    # Count games for progress display
    start_time = time.time()
    games_processed = 0
    batch = []
    pool = mp.Pool(args.workers)

    try:
        for pgn_str in read_games(args.pgn):
            batch.append(pgn_str)

            if len(batch) >= args.batch_size:
                results = pool.map(process_game_pgn, batch)
                aggregated = merge_results(results)
                copy_batch(conn, aggregated, args.player)

                games_processed += len(batch)
                elapsed = time.time() - start_time
                rate = games_processed / elapsed if elapsed > 0 else 0
                print(
                    f"[celebrity] {games_processed:>8,} games -- "
                    f"{rate:,.0f} games/sec -- "
                    f"elapsed {format_duration(elapsed)}"
                )
                batch = []

        # Process remaining games
        if batch:
            results = pool.map(process_game_pgn, batch)
            aggregated = merge_results(results)
            copy_batch(conn, aggregated, args.player)
            games_processed += len(batch)

    except KeyboardInterrupt:
        print(f"\n[celebrity] Interrupted at game {games_processed:,}.")
        pool.terminate()
        pool.join()
        conn.close()
        sys.exit(1)
    finally:
        pool.close()
        pool.join()

    elapsed = time.time() - start_time
    print(
        f"[celebrity] Parsing complete: {games_processed:,} games "
        f"in {format_duration(elapsed)}"
    )

    # Aggregate into final table
    aggregate_and_finalize(conn)
    print("[celebrity] Import complete.")
    conn.close()


if __name__ == "__main__":
    main()
