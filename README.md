# Chess Reps

A self-hosted web application for learning and drilling chess openings using spaced
repetition. Build your own opening repertoire on an interactive board, then let the
app quiz you on it.

---

## What It Does

- **Build Mode** — Play out moves to construct your repertoire. The app suggests
  known book moves, moves played by Masters (2500+) extracted from 21 million+ games, and Stockfish suggestions.
- **Drill Mode** — Spaced repetition (FSRS algorithm) surfaces positions due for
  review. Grade yourself and the algorithm schedules the next session.
- **Puzzles** — Test your tactics derived from the openings you play.
- **Game Review** — Paste a PGN or import from Lichess & Chess.com to find where you or your opponent deviated from your prep.
- **Dashboard** — Track your repertoire health: due cards, mastered positions,
  gaps, streaks, and review history.

---

## Quick Start

### Requirements

- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/) (included with Docker Desktop)

### Docker Setup

**1. Create a docker-compose.yml file**

```yaml
services:
  app:
    image: ghcr.io/pvttwinkle/chess-reps:latest
    container_name: chess-reps-app
    restart: unless-stopped
    ports:
      - '3000:3000'
    environment:
      - DATABASE_URL=postgresql://chess_reps:chess_reps_secret@postgres:5432/chess_reps
      - ORIGIN=http://localhost:3000
      - DEFAULT_USERNAME=admin
      - DEFAULT_PASSWORD=changeme
      - REGISTRATION_MODE=invite
      - GAME_IMPORT_INTERVAL_MINUTES=0
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ['CMD', 'wget', '-qO-', 'http://localhost:3000/api/health']
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
  postgres:
    image: postgres:17-alpine
    container_name: chess-reps-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: chess_reps
      POSTGRES_USER: chess_reps
      POSTGRES_PASSWORD: chess_reps_secret
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U chess_reps']
      interval: 10s
      timeout: 5s
      retries: 5
volumes:
  pgdata:
```

**2. Start the app:**

```bash
docker compose up -d
```

**3. Open your browser:**

```
http://localhost:3000
```

Log in with the username and password you set above.

---

## Optional Data

Chess Reps ships with ECO opening names and a small starter book, but two larger
datasets are available as separate downloads:

| Dataset              | Description                                                                                           | Approx. Size |
| -------------------- | ----------------------------------------------------------------------------------------------------- | ------------ |
| **Masters Database** | ~8.8M moves from master-level games (Chessmont, ELO >= 2500). Powers the "Masters" tab in Build Mode. | ~131 MB      |
| **Lichess Puzzles**  | Opening-tagged tactical puzzles. Powers the Puzzles page.                                             | ~69 MB       |

Without these datasets, the Masters tab falls back to Stockfish
engine analysis, and the Puzzles page shows setup instructions.

### One-Command Install

After starting the app (`docker compose up -d`), run:

```bash
curl -sL https://raw.githubusercontent.com/PvtTwinkle/Chess-Reps/main/scripts/data-restore.sh | bash
```

This downloads the latest data from GitHub Releases and loads it into your database.

### Manual Install

1. Download `chessmont-moves-dump.sql.gz` and `puzzles-dump.sql.gz` from the
   [latest data release](https://github.com/PvtTwinkle/Chess-Reps/releases?q=data).
2. Restore each file:

```bash
gunzip -c chessmont-moves-dump.sql.gz | \
  docker exec -i chess-reps-postgres psql -U chess_reps chess_reps

gunzip -c puzzles-dump.sql.gz | \
  docker exec -i chess-reps-postgres psql -U chess_reps chess_reps
```

---

## Environment Variables

| Variable                       | Required  | Description                                                                                                                           |
| ------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                 | Yes       | PostgreSQL connection string. Default points to the `postgres` container on the internal Docker network.                              |
| `ORIGIN`                       | Yes       | The URL you use to access the app. Change this if using a reverse proxy (e.g. `https://chess.yourdomain.com`). Required for security. |
| `DEFAULT_USERNAME`             | First run | Username created when the database is empty. Ignored after first run.                                                                 |
| `DEFAULT_PASSWORD`             | First run | Password created when the database is empty. **Change this before first run.** Ignored after first run.                               |
| `REGISTRATION_MODE`            | No        | `invite` (admin creates users) or `open` (login page includes registration). Default: `invite`.                                       |
| `GAME_IMPORT_INTERVAL_MINUTES` | No        | How often (in minutes) the app syncs user Chess.com & Lichess public games for review. `0` = manual only. Default: `0`.               |

---

## Updating

```bash
docker compose pull && docker compose up -d
```

---

## Backup

Your data lives in the PostgreSQL container's named volume (`pgdata`).

```bash
# Back up
docker exec chess-reps-postgres pg_dump -U chess_reps chess_reps > backup.sql

# Restore
docker compose down
docker volume rm chess-reps_pgdata
docker compose up -d
docker exec -i chess-reps-postgres psql -U chess_reps chess_reps < backup.sql
```

---

## Reverse Proxy

If you expose this to the internet via Nginx Proxy Manager, Caddy, or Traefik,
set `ORIGIN` to your full domain:

```yaml
- ORIGIN=https://chess.yourdomain.com
```

The login screen protects the instance from unauthorized access. SvelteKit uses
the `ORIGIN` value to validate requests and prevent cross-site attacks.

---

## Health Check

```
GET /api/health
```

Returns `{ "status": "ok", "db": "ok" }` when the app and database are running.
No authentication required. Compatible with [Uptime Kuma](https://github.com/louislam/uptime-kuma)
and any other monitoring tool.

---

## Acknowledgments

Chess Reps uses data from the following open-source projects:

- **[Chessmont](https://www.kaggle.com/datasets/chessmontdb/chessmont-big-dataset)** — Master game database (CC BY-SA 4.0)
- **[Lichess Puzzle Database](https://database.lichess.org/#puzzles)** — Tactical puzzles (CC0)
- **[Lichess Chess Openings](https://github.com/lichess-org/chess-openings)** — ECO opening names (CC0)
- **[Lichess](https://github.com/lichess-org/lila)** — Sound assets (AGPL v3+)

See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for full attribution and license details.

## License

MIT
