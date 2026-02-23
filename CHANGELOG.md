# Changelog

All notable changes to Chess Reps are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project uses [semantic versioning](https://semver.org/): `major.minor.patch`.

Docker images are tagged per version. To stay on stable releases, pin your
`docker-compose.yml` to a specific tag (e.g. `chess-reps:0.1.0`) rather than
`latest`.

---

## [Unreleased]

Nothing yet.

---

## [0.1.0] — 2026-02-23

Initial project foundation. The app runs end-to-end in Docker but no chess
functionality has been built yet. This release establishes the full technical
foundation that all future features are built on top of.

### Added

- **SvelteKit project scaffold** with TypeScript, ESLint, and Prettier configured
- **Database schema** using Drizzle ORM with SQLite (`better-sqlite3`):
  - `user` — account credentials
  - `user_settings` — per-user preferences
  - `repertoire` — named opening repertoires (white or black)
  - `user_move` — moves added by the user to a repertoire
  - `user_repertoire_move` — moves with full FSRS spaced repetition state
  - `reviewed_game` — game review history
  - `drill_session` — drill session records
  - `book_position`, `book_move`, `eco_opening` — shared book tables (read-only at runtime)
  - All user tables include `user_id` from day one to support multi-user later
- **Database migrations** run automatically on container startup via Drizzle Kit
- **Default user creation** on first run using `DEFAULT_USERNAME` and
  `DEFAULT_PASSWORD` environment variables
- **Session-based authentication**:
  - Login screen shown to any unauthenticated visitor
  - All routes except `/login` and `/api/health` are protected
  - Session cookie stored in browser
- **Docker Compose** setup with two services:
  - `app` — SvelteKit application (Node.js, port 3000)
  - `stockfish` — Stockfish chess engine sidecar (internal network only, port 3001)
  - SQLite database mounted from host at `./data/db.sqlite` for easy backup
  - Resource limits on the Stockfish container (2 CPUs, 512 MB)
- **Dockerfile** for the SvelteKit app using `@sveltejs/adapter-node`
- **Health check endpoint** at `/api/health`:
  - Returns `{ "status": "ok", "db": "ok" }` when running correctly
  - No authentication required (for monitoring tools)
  - Docker health check configured in `docker-compose.yml`
  - Compatible with Uptime Kuma

### Project Infrastructure

- `CLAUDE.md` — project context and session instructions for Claude Code
- `README.md` — one-command Docker setup, environment variable reference,
  backup instructions, and reverse proxy guidance
- `CONTRIBUTING.md` — dev environment setup, code style, and guide for
  contributing opening book moves
- `CHANGELOG.md` — this file

---

[Unreleased]: https://github.com/your-org/chess-reps/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/your-org/chess-reps/releases/tag/v0.1.0
