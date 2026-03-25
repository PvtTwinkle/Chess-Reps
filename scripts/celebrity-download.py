#!/usr/bin/env python3
from __future__ import annotations
"""
Celebrity Download — Fetches player games from Lichess/Chess.com APIs.

Reads the star_players table to find players with platform accounts, then
downloads their games as PGN files. Tracks a watermark per player so future
runs only fetch new games.

Downloaded PGNs are saved to data/celebrities/<slug>.pgn (append mode).
Use --import to automatically run celebrity-import.py after downloading.

Dependencies:
  pip install psycopg2-binary requests

Usage:
  # Download games for all registered players:
  python celebrity-download.py

  # Download for one player only:
  python celebrity-download.py --player hikaru-nakamura

  # Download and immediately import:
  python celebrity-download.py --import

  # Re-download everything (ignore watermarks):
  python celebrity-download.py --full

  # List registered players and their download status:
  python celebrity-download.py --status

Environment:
  DATABASE_URL  PostgreSQL connection string (required)
"""

import argparse
import os
import subprocess
import sys
import time
from datetime import datetime, timezone

import psycopg2
import requests

# Where downloaded PGN files are saved.
DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "celebrities")

# Lichess API: streams PGN for a user's games.
LICHESS_GAMES_URL = "https://lichess.org/api/games/user/{username}"

# Chess.com API: monthly archive list + per-month PGN.
CHESSCOM_ARCHIVES_URL = "https://api.chess.com/pub/player/{username}/games/archives"

# Polite request headers.
HEADERS = {
    "User-Agent": "Chessstack/1.0 (celebrity-download script)",
    "Accept": "application/x-chess-pgn",
}


# ── Watermark tracking ──────────────────────────────────────────────────────

def ensure_progress_table(conn):
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS star_download_progress (
                slug            TEXT PRIMARY KEY,
                last_fetched_at TIMESTAMP NOT NULL,
                games_fetched   INTEGER NOT NULL DEFAULT 0
            )
        """)
    conn.commit()


def load_watermark(conn, slug: str) -> datetime | None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT last_fetched_at FROM star_download_progress WHERE slug = %s",
            (slug,)
        )
        row = cur.fetchone()
        return row[0].replace(tzinfo=timezone.utc) if row else None


def save_watermark(conn, slug: str, last_fetched: datetime, games: int):
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO star_download_progress (slug, last_fetched_at, games_fetched)
            VALUES (%s, %s, %s)
            ON CONFLICT (slug) DO UPDATE SET
                last_fetched_at = EXCLUDED.last_fetched_at,
                games_fetched = star_download_progress.games_fetched + EXCLUDED.games_fetched
        """, (slug, last_fetched, games))
    conn.commit()


# ── Lichess download ────────────────────────────────────────────────────────

def download_lichess(username: str, since: datetime | None = None) -> tuple[str, int]:
    """Download all games for a Lichess user as PGN.

    Returns (pgn_text, game_count).
    """
    params = {"moves": "true", "tags": "true", "sort": "dateAsc"}
    if since:
        # Lichess expects millisecond Unix timestamp
        params["since"] = str(int(since.timestamp() * 1000))

    print(f"  Fetching from Lichess: {username}...")
    resp = requests.get(
        LICHESS_GAMES_URL.format(username=username),
        headers=HEADERS,
        params=params,
        stream=True,
        timeout=300,
    )

    if resp.status_code == 429:
        print(f"  WARNING: Rate limited by Lichess. Try again later.")
        return "", 0
    resp.raise_for_status()

    pgn_text = resp.text
    # Count games by counting [Event lines
    game_count = pgn_text.count("[Event ")
    print(f"  Downloaded {game_count:,} games from Lichess")
    return pgn_text, game_count


# ── Chess.com download ──────────────────────────────────────────────────────

def download_chesscom(username: str, since: datetime | None = None) -> tuple[str, int]:
    """Download all games for a Chess.com user as PGN.

    Iterates monthly archives. If `since` is provided, only fetches months
    from that date onward.

    Returns (pgn_text, game_count).
    """
    print(f"  Fetching archive list from Chess.com: {username}...")
    resp = requests.get(
        CHESSCOM_ARCHIVES_URL.format(username=username),
        headers={"User-Agent": HEADERS["User-Agent"]},
        timeout=30,
    )

    if resp.status_code == 404:
        print(f"  WARNING: Chess.com user '{username}' not found.")
        return "", 0
    if resp.status_code == 429:
        print(f"  WARNING: Rate limited by Chess.com. Try again later.")
        return "", 0
    resp.raise_for_status()

    archives = resp.json().get("archives", [])
    if not archives:
        print(f"  No archives found for {username}")
        return "", 0

    # Filter archives by date if watermark exists
    if since:
        since_str = since.strftime("%Y/%m")
        archives = [a for a in archives if a.split("/games/")[1] >= since_str]

    print(f"  Fetching {len(archives)} monthly archive(s)...")
    all_pgn = []
    total_games = 0

    for i, archive_url in enumerate(archives):
        pgn_url = archive_url + "/pgn"
        try:
            resp = requests.get(
                pgn_url,
                headers={"User-Agent": HEADERS["User-Agent"]},
                timeout=60,
            )
            if resp.status_code == 429:
                print(f"  Rate limited at archive {i+1}/{len(archives)}. Stopping.")
                break
            resp.raise_for_status()

            pgn_text = resp.text
            month_games = pgn_text.count("[Event ")
            all_pgn.append(pgn_text)
            total_games += month_games

            if (i + 1) % 10 == 0 or i == len(archives) - 1:
                print(f"  Archive {i+1}/{len(archives)}: {total_games:,} games so far")

        except requests.RequestException as e:
            print(f"  WARNING: Failed to fetch {pgn_url}: {e}")

        # Be polite: 1 second between requests
        if i < len(archives) - 1:
            time.sleep(1)

    print(f"  Downloaded {total_games:,} games from Chess.com")
    return "\n\n".join(all_pgn), total_games


# ── Progress reporting ───────────────────────────────────────────────────────

def show_status(conn):
    """Print download status for all registered players."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT sp.slug, sp.display_name, sp.platform, sp.platform_username,
                   sdp.last_fetched_at, sdp.games_fetched
            FROM star_players sp
            LEFT JOIN star_download_progress sdp ON sp.slug = sdp.slug
            ORDER BY sp.display_name
        """)
        rows = cur.fetchall()

    if not rows:
        print("No players registered. Use celebrity-import.py --register to add players.")
        return

    print(f"\n{'Player':<30} {'Platform':<10} {'Username':<20} {'Games':<10} {'Last Fetch'}")
    print("-" * 100)
    for slug, name, platform, username, last_fetch, games in rows:
        platform = platform or "—"
        username = username or "—"
        games = f"{games:,}" if games else "—"
        last_fetch = last_fetch.strftime("%Y-%m-%d %H:%M") if last_fetch else "never"
        print(f"{name:<30} {platform:<10} {username:<20} {games:<10} {last_fetch}")
    print()


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Download celebrity player games from Lichess/Chess.com APIs."
    )
    parser.add_argument(
        "--player", type=str, default=None,
        help="Download only this player (by slug)"
    )
    parser.add_argument(
        "--full", action="store_true",
        help="Ignore watermarks and re-download all games"
    )
    parser.add_argument(
        "--import", dest="run_import", action="store_true",
        help="Run celebrity-import.py after downloading"
    )
    parser.add_argument(
        "--status", action="store_true",
        help="Show download status for all players and exit"
    )
    args = parser.parse_args()

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("[download] ERROR: DATABASE_URL environment variable is required")
        sys.exit(1)

    conn = psycopg2.connect(db_url)
    ensure_progress_table(conn)

    if args.status:
        show_status(conn)
        conn.close()
        return

    # Fetch players to download
    with conn.cursor() as cur:
        query = """
            SELECT slug, display_name, platform, platform_username
            FROM star_players
            WHERE platform IN ('lichess', 'chesscom')
        """
        params = []
        if args.player:
            query += " AND slug = %s"
            params.append(args.player)
        query += " ORDER BY display_name"
        cur.execute(query, params)
        players = cur.fetchall()

    if not players:
        if args.player:
            print(f"[download] No player found with slug '{args.player}' and a platform account.")
        else:
            print("[download] No players with platform accounts found.")
            print("[download] Register players first: celebrity-import.py --register ...")
        conn.close()
        return

    # Create data directory
    os.makedirs(DATA_DIR, exist_ok=True)

    print(f"[download] Downloading games for {len(players)} player(s)...\n")
    updated_players = []

    for slug, display_name, platform, username in players:
        print(f"[{slug}] {display_name} ({platform}: {username})")

        watermark = None if args.full else load_watermark(conn, slug)
        if watermark:
            print(f"  Watermark: {watermark.strftime('%Y-%m-%d %H:%M')} — fetching newer games only")

        pgn_text = ""
        game_count = 0

        try:
            if platform == "lichess":
                pgn_text, game_count = download_lichess(username, since=watermark)
            elif platform == "chesscom":
                pgn_text, game_count = download_chesscom(username, since=watermark)
        except requests.RequestException as e:
            print(f"  ERROR: {e}")
            print()
            continue

        if game_count == 0:
            print(f"  No new games.\n")
            continue

        # Save PGN to file
        pgn_path = os.path.join(DATA_DIR, f"{slug}.pgn")
        mode = "w" if args.full else "a"
        with open(pgn_path, mode, encoding="utf-8") as f:
            f.write(pgn_text)
            if not pgn_text.endswith("\n"):
                f.write("\n")

        print(f"  Saved to {pgn_path}")

        # Update watermark
        now = datetime.now(timezone.utc)
        save_watermark(conn, slug, now, game_count)
        updated_players.append((slug, display_name, pgn_path))
        print()

    print(f"[download] Done. {len(updated_players)} player(s) updated.\n")

    # Run import if requested
    if args.run_import and updated_players:
        script_dir = os.path.dirname(__file__)
        import_script = os.path.join(script_dir, "celebrity-import.py")

        for slug, display_name, pgn_path in updated_players:
            print(f"[import] Importing {display_name}...")
            cmd = [
                sys.executable, import_script,
                pgn_path,
                "--player", slug,
                "--display-name", display_name,
            ]
            result = subprocess.run(cmd, env={**os.environ, "DATABASE_URL": db_url})
            if result.returncode != 0:
                print(f"[import] WARNING: Import failed for {slug}")
            print()

    conn.close()


if __name__ == "__main__":
    main()
