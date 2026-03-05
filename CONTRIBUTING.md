# Contributing to Chess Reps

Thank you for your interest in contributing. This document covers how to set up
a development environment, the code style expected, and — most importantly — how
to contribute opening book moves, which is the most valuable thing this project
needs from the chess community.

---

## Table of Contents

- [Setting Up a Dev Environment](#setting-up-a-dev-environment)
- [Running the App Locally](#running-the-app-locally)
- [Code Style](#code-style)
- [How to Contribute Opening Book Moves](#how-to-contribute-opening-book-moves)
- [Submitting a Pull Request](#submitting-a-pull-request)

---

## Setting Up a Dev Environment

### Requirements

- [Node.js](https://nodejs.org/) 20 or later
- [Docker](https://docs.docker.com/get-docker/) and Docker Compose (for PostgreSQL)
- A code editor — [VS Code](https://code.visualstudio.com/) is recommended

### Steps

```bash
# Clone the repository
git clone https://github.com/your-org/chess-reps.git
cd chess-reps

# Install dependencies
npm install
```

---

## Running the App Locally

There are two ways to run the app during development.

### Option A — Dev server only (no Stockfish)

This is the fastest way to work on the UI. Stockfish analysis will not be available
unless you install Stockfish on your machine (`apt install stockfish` or
`brew install stockfish`), but everything else works.

```bash
npm run dev
```

The app starts at `http://localhost:5173`.

You will need a `.env` file in the project root for local environment variables:

```env
DATABASE_URL=postgresql://chess_reps:chess_reps_secret@localhost:5432/chess_reps
ORIGIN=http://localhost:5173
DEFAULT_USERNAME=admin
DEFAULT_PASSWORD=changeme
# Only needed if Stockfish is not at /usr/games/stockfish
# STOCKFISH_BIN=stockfish
```

### Option B — Full stack with Docker (includes Stockfish)

This runs the complete stack exactly as it runs in production.

```bash
docker compose up -d --build
```

The app starts at `http://localhost:3000`.

To see live logs:

```bash
docker compose logs -f app
```

### Useful Dev Commands

```bash
npm run check      # TypeScript type check
npm run lint       # Check formatting and linting
npm run format     # Auto-format all files
npm run build      # Production build
```

---

## Code Style

- **TypeScript everywhere** — no plain `.js` files in `src/`
- **Explicit over clever** — readable code is better than clever code
- **Small, focused components** — one job per Svelte component
- **Comment the why** — add comments when the reasoning is not obvious from
  reading the code
- **No raw SQL in application code** — use Drizzle ORM queries; raw SQL belongs
  only in migration files
- **Consistent JSON responses** — all API endpoints return the same shape of
  response object for success and error cases

Prettier and ESLint are configured in the repo. Run `npm run format` before
committing. The CI check will fail if formatting is off.

---

## How to Contribute Opening Book Moves

This is the most impactful way to contribute. The shared book database ships with
the app and provides move suggestions to all users. Better coverage means better
suggestions for everyone.

### What the Book Is

The shared book is a set of curated opening moves stored in SQL migration files.
It lives in `drizzle/migrations/` and is bundled into the Docker image on every
release. Users never write to it — it is read-only at runtime.

When a user is building their repertoire and plays into a position that exists in
the book, the app shows them the known responses with annotations. This is what
makes the app useful without requiring the user to know every line from memory.

### What Belongs in the Book

- Well-established mainline theory across common openings
- Clearly annotated moves (e.g. "main line", "sharp", "positional", "gambit")
- Both White and Black responses at each position
- Accurate FEN strings (see format below)

What does **not** belong:

- Personal preferences or engine-only moves with no human following
- Deeply obscure sidelines with no practical value
- Moves without a clear annotation

### Book Move Format

Book moves are stored in the `book_move` table. Each row represents one move from
one position to another:

```sql
-- from_fen: the position before the move
-- to_fen:   the position after the move
-- san:      the move in Standard Algebraic Notation (e.g. "e4", "Nf3", "O-O")
-- annotation: a short label describing the move (keep it brief)
-- contributor: your name or GitHub username for attribution

INSERT INTO book_move (from_fen, to_fen, san, annotation, contributor) VALUES
  (
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
    'e5',
    'open game',
    'your-github-username'
  );
```

### How to Generate FEN Strings

Use any of these tools to get the FEN for a position:

- [Lichess board editor](https://lichess.org/editor) — set up the position and
  copy the FEN from the URL
- [Chess.com analysis board](https://www.chess.com/analysis) — FEN shown below
  the board
- Any chess GUI (Arena, Scid, ChessBase) — all support FEN export

**Important:** FEN strings must be accurate. An incorrect FEN means the book move
will never match a real game position.

### Submitting Book Moves

1. Fork the repository on GitHub
2. Create a new migration file in `drizzle/migrations/` — name it with the next
   available number and a short description, e.g.:
   ```
   drizzle/migrations/0003_book_sicilian_najdorf.sql
   ```
3. Write your `INSERT INTO book_move` statements in that file
4. Test locally — start the dev server and verify the moves appear as suggestions
   at the correct positions
5. Open a pull request with a description of what openings you have added

### Migration File Template

```sql
-- Book moves: [Opening Name] ([ECO code range])
-- Contributor: [your name or GitHub username]
-- Added: [date]

INSERT INTO book_move (from_fen, to_fen, san, annotation, contributor) VALUES
  -- [position description]
  ('[from_fen]', '[to_fen]', '[san]', '[annotation]', '[contributor]'),
  -- add more moves...
  ;
```

Keep each migration file focused on one opening family. Smaller, focused PRs are
easier to review and merge.

---

## Submitting a Pull Request

1. Fork the repo and create a feature branch:

   ```bash
   git checkout -b feat/my-contribution
   ```

2. Make your changes, following the code style above.

3. Run checks before pushing:

   ```bash
   npm run check
   npm run lint
   ```

4. Push and open a pull request against the `main` branch.

5. In the PR description, explain:
   - What you changed and why
   - For book moves: which openings you added and where the moves come from
   - Any testing you did

The CI will run a build check, TypeScript type check, and migration smoke test
automatically. PRs that fail CI will not be merged.

---

## Questions

Open a [GitHub Issue](https://github.com/your-org/chess-reps/issues) for questions,
bug reports, or feature requests.
