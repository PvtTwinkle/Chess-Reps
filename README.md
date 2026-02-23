# Chess Reps

A self-hosted web application for learning and drilling chess openings using spaced
repetition. Build your own opening repertoire on an interactive board, then let the
app quiz you on it — surfacing the positions you are most likely to forget.

No subscription. No data leaving your machine. Fully offline after the initial pull.

---

## What It Does

- **Build Mode** — Play out moves to construct your repertoire. The app suggests
  known book moves and shows Stockfish evaluations for any position.
- **Drill Mode** — Spaced repetition (FSRS algorithm) surfaces positions due for
  review. Grade yourself and the algorithm schedules the next session.
- **Explorer** — Browse your full repertoire tree on an interactive board.
- **Game Review** — Paste a PGN or import from Lichess to find where you deviated
  from your prep. Add punishment lines to drill opponent blunders.
- **Dashboard** — Track your repertoire health: due cards, mastered positions,
  gaps, streaks, and review history.

---

## Quick Start

### Requirements

- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/) (included with Docker Desktop)

### Run in Under 5 Minutes

**1. Copy this file and save it as `docker-compose.yml`:**

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    image: chess-reps:latest
    container_name: chess-reps-app
    restart: unless-stopped
    ports:
      - '3000:3000'
    environment:
      - DATABASE_URL=/app/data/db.sqlite
      - ORIGIN=http://localhost:3000
      - DEFAULT_USERNAME=admin
      - DEFAULT_PASSWORD=changeme
      - STOCKFISH_HOST=stockfish
      - STOCKFISH_PORT=3001
    volumes:
      - ./data:/app/data
    depends_on:
      - stockfish
    healthcheck:
      test: ['CMD', 'wget', '-qO-', 'http://localhost:3000/api/health']
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s

  stockfish:
    build:
      context: .
      dockerfile: Dockerfile.stockfish
    image: chess-reps-stockfish:latest
    container_name: chess-reps-stockfish
    restart: unless-stopped
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 512M
```

**2. Change your password before starting:**

Edit the `DEFAULT_PASSWORD` line. This password is only used on the very first run
to create your account. After that, change it in Settings.

**3. Start the app:**

```bash
docker compose up -d
```

**4. Open your browser:**

```
http://localhost:3000
```

Log in with the username and password you set above.

---

## Environment Variables

| Variable           | Required  | Description                                                                                                                           |
| ------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`     | Yes       | Path to the SQLite file inside the container. Do not change unless you also change the volume mount.                                  |
| `ORIGIN`           | Yes       | The URL you use to access the app. Change this if using a reverse proxy (e.g. `https://chess.yourdomain.com`). Required for security. |
| `DEFAULT_USERNAME` | First run | Username created when the database is empty. Ignored after first run.                                                                 |
| `DEFAULT_PASSWORD` | First run | Password created when the database is empty. **Change this before first run.** Ignored after first run.                               |
| `STOCKFISH_HOST`   | Yes       | Hostname of the Stockfish sidecar. Leave as `stockfish` unless you rename the service.                                                |
| `STOCKFISH_PORT`   | Yes       | Port Stockfish listens on. Leave as `3001` unless you change the sidecar config.                                                      |

---

## Updating

```bash
docker compose pull && docker compose up -d
```

New releases may include additional opening theory in the shared book database.
Migrations run automatically on startup — your personal data is never touched.

---

## Backup

Your data lives in a single SQLite file on the host machine:

```
./data/db.sqlite
```

To back up, copy that file anywhere. To restore, stop the container, replace the
file, and start again.

```bash
# Back up
cp ./data/db.sqlite ./data/db.sqlite.backup

# Restore
docker compose down
cp ./data/db.sqlite.backup ./data/db.sqlite
docker compose up -d
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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to set up a dev environment and
how to contribute opening book moves.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## License

MIT
