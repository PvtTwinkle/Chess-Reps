# Changelog

All notable changes to Chess Reps are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project uses [semantic versioning](https://semver.org/): `major.minor.patch`.

Docker images are tagged per version. To stay on stable releases, pin your
`docker-compose.yml` to a specific tag (e.g. `chess-reps:0.1.0`) rather than
`latest`.

---

## [Unreleased]

### Added

- **Build mode** (`src/routes/build/`) — interactive repertoire builder:
  - Two-panel layout: 520 px board on the left, move tree sidebar on the right
  - Auto-saves every move immediately; no manual save button needed
  - Turn indicator shows whose move it is (yellow = your turn, blue = opponent's turn)
  - One-move-per-position rule on your turn with conflict warning and board snap-back
  - Opponent positions accept multiple moves (all deviations you want to prepare for)
  - Undo navigates backwards through the current line without deleting saved moves
  - Delete (✕) button removes a move and its entire downstream subtree from the DB
  - Current line breadcrumb is clickable for fast navigation to any prior position
  - Moves-from-position panel shows all saved continuations from the current square
  - FSRS spaced-repetition card created automatically for every user-turn move saved
  - Redirects to dashboard if no repertoire is active
- **Stockfish integration** — engine sidecar + UCI wrapper + candidate move display:
  - `src/lib/stockfish/index.ts` — TCP client that speaks the UCI protocol to the
    Stockfish sidecar; uses MultiPV to fetch top N moves in one analysis pass
  - `POST /api/stockfish` — merges book moves and engine analysis into a single ranked
    candidate list; scores normalised to white's perspective
  - `CandidateMoves` component shows suggested moves in the Build mode sidebar with
    evaluation scores (`+0.45`, `-1.20`, `#3`) and `BOOK` badges for book moves
  - Clicking any candidate plays that move on the board (same path as drag-and-drop)
  - Book/Engine toggle checkboxes let you show or hide each source independently
  - Gracefully degrades when the engine sidecar is not running (book-only mode)
- **ECO opening name display** — shows the recognised opening name as moves are played
  in Build mode:
  - `drizzle/migrations/0003_seed_eco_codes.sql` seeds the `eco_opening` table with
    90 positions covering all major opening families (A00–E97)
  - `src/lib/eco.ts` — server-side helper; queries all FENs in move history in a
    single round-trip and returns the most specific match
  - `POST /api/eco` — authenticated endpoint accepting up to 50 FENs, returns
    `{ code, name }` or `null`
  - `OpeningName` component displays the result as `"B90 · Sicilian Defence, Najdorf
    Variation"` with the ECO code highlighted in gold; renders nothing if no match
- **Opening book seed** (`drizzle/migrations/0002_seed_book_moves.sql`) — Alapin
  Sicilian mainline (1.e4 c5 2.c3 d5) as a minimal test dataset; FEN strings
  generated from Chess.js to match runtime FEN output exactly

- **Move annotations** — free-text notes on any saved move in Build mode:
  - ✎ button on each move row in the sidebar opens an edit modal pre-filled with
    any existing note
  - ✎ button in the nav controls annotates the move that led to the current position
    without having to step back first
  - Notes are displayed in italic below the move SAN (truncated to 80 chars)
  - `PATCH /api/moves/[id]` — updates `notes` with auth and ownership checks;
    empty string coerced to `null`; max 500 characters

- **Moves API** (`src/routes/api/moves/`):
  - `GET /api/moves?repertoireId=X` — load all saved moves for a repertoire
  - `POST /api/moves` — save a move; enforces turn rules and creates SR cards
  - `DELETE /api/moves/[id]` — delete a move and cascade-delete its subtree
  - `PATCH /api/moves/[id]` — update the notes annotation on a move

- **ChessBoard component** (`src/lib/components/ChessBoard.svelte`) — interactive
  board powered by Chessground with props for FEN, orientation, movable squares,
  last-move highlight, and check highlight
- **Multiple repertoire management** (`src/lib/components/RepertoireSelector.svelte`):
  - Selector button in the nav bar showing the active repertoire
  - Dropdown to switch between repertoires
  - Modal for create, rename, and delete with inline confirmation
  - Active repertoire persisted in a cookie and validated against the database on
    every request
  - API endpoints: `GET/POST /api/repertoires`, `PATCH/DELETE /api/repertoires/[id]`,
    `POST /api/repertoires/active`
- **Onboarding / empty state screen** (`src/lib/components/OnboardingWelcome.svelte`):
  - Shown on the dashboard when the user has no repertoires
  - Welcomes the user and explains Build mode and Drill mode
  - Inline "Create your first repertoire" form (name + color)
  - Disappears automatically once the first repertoire is created

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
