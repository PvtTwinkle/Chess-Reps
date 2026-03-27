#!/usr/bin/env python3
"""Recovery script: combine existing _lichess_bracket_* tables into lichess_moves.

Run this after the main import script crashed during the combine step.
The 8 bracket tables must already exist from a successful aggregation run.
"""

import os
import sys
import time

import psycopg2


def format_duration(seconds):
    if seconds < 60:
        return f"{seconds:.1f}s"
    minutes = seconds / 60
    if minutes < 60:
        return f"{minutes:.1f}m"
    hours = minutes / 60
    return f"{hours:.1f}h"


def main():
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("[recover] ERROR: DATABASE_URL environment variable is required")
        sys.exit(1)

    conn = psycopg2.connect(db_url)

    with conn.cursor() as cur:
        cur.execute("SET work_mem = '1GB'")

    # Verify bracket tables exist
    tables = []
    with conn.cursor() as cur:
        for i in range(8):
            name = f"_lichess_bracket_{i}"
            cur.execute(
                "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = %s)",
                (name,)
            )
            if cur.fetchone()[0]:
                tables.append(name)
            else:
                print(f"[recover] ERROR: Missing table {name}")
                sys.exit(1)

    print(f"[recover] Found all 8 bracket tables")

    # Rename bracket 0 to lichess_moves, then INSERT + DROP the rest
    print("[recover] Moving bracket tables into lichess_moves...")
    start = time.time()
    with conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS lichess_moves")
        cur.execute(f"ALTER TABLE {tables[0]} RENAME TO lichess_moves")
        print(f"[recover]   Bracket 0 renamed to lichess_moves")
    conn.commit()

    for i, t in enumerate(tables[1:], start=1):
        step_start = time.time()
        with conn.cursor() as cur:
            cur.execute(f"INSERT INTO lichess_moves SELECT * FROM {t}")
            rows = cur.rowcount
            cur.execute(f"DROP TABLE {t}")
        conn.commit()
        elapsed = format_duration(time.time() - step_start)
        print(f"[recover]   Bracket {i} merged ({rows:,} rows, {elapsed}) and dropped")

    # Add primary key and index
    print("[recover] Building primary key...")
    pk_start = time.time()
    with conn.cursor() as cur:
        cur.execute(
            "ALTER TABLE lichess_moves "
            "ADD PRIMARY KEY (position_fen, move_san, rating_bracket)"
        )
    conn.commit()
    print(f"[recover]   Primary key created in {format_duration(time.time() - pk_start)}")

    print("[recover] Building index...")
    idx_start = time.time()
    with conn.cursor() as cur:
        cur.execute(
            "CREATE INDEX idx_lichess_position_bracket "
            "ON lichess_moves (position_fen, rating_bracket)"
        )
    conn.commit()
    print(f"[recover]   Index created in {format_duration(time.time() - idx_start)}")

    # Filter rare moves
    print("[recover] Removing moves with fewer than 100 games...")
    with conn.cursor() as cur:
        cur.execute("DELETE FROM lichess_moves WHERE games_played < 100")
        deleted = cur.rowcount
        print(f"[recover]   Deleted {deleted:,} rare move entries")
    conn.commit()

    # Vacuum
    print("[recover] Running VACUUM ANALYZE...")
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("VACUUM ANALYZE lichess_moves")
    conn.autocommit = False

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
        f"[recover] Final: {total_rows:,} move entries "
        f"across {total_positions:,} positions ({table_size} on disk)"
    )
    print(f"[recover] Total time: {format_duration(time.time() - start)}")
    conn.close()


if __name__ == "__main__":
    main()
