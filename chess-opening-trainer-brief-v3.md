# Chess Opening Trainer — Project Brief for Claude Code (v3)

## Context

I am building this project with no prior coding experience but strong IT and Docker
knowledge. I need you to explain what you are building as you go, in plain English,
as if explaining to someone who understands infrastructure but not code. Please narrate
your decisions before writing code, not after.

---

## What We Are Building

A self-hosted web application for learning and drilling chess openings using spaced
repetition. Users build their own opening repertoire directly on an interactive
chessboard, and the app drills them on it using a spaced repetition algorithm that
surfaces positions they are likely to forget.

The closest comparison is Chessbook (chessbook.com), but fully self-hosted, open
source, with no subscription, no data leaving the user's machine, and with an
additional feature no existing app has: punishment line training from real games.

The app has five core areas:

**Build Mode** — The user plays out moves on a board to construct their opening
repertoire. The internal shared book (bundled with the app) suggests known moves at
each position. When the user goes beyond the book, Stockfish provides engine
recommendations with evaluation scores. The user picks one move per position for their
own turns, and selects which opponent responses to prepare for (multiple allowed).

**Drill Mode** — The app uses spaced repetition (FSRS algorithm) to surface positions
the user needs to review. The user is shown a board position and must play the correct
move from their repertoire. They grade themselves and the algorithm schedules the next
review. Positions always play out from move 1 for context, not as isolated flash cards.

**Explorer** — A read-only view of the user's full repertoire tree. Navigate the board
freely, see all prepared moves and opponent responses visualized, understand coverage
at a glance. Separate from build mode (which adds moves) and drill mode (which tests).

**Game Review** — The user pastes a PGN from a real game or imports recent games from
their Lichess account. The app plays through it and highlights where they deviated from
their repertoire. At any point where the opponent blundered, the user can click
"Add Punishment Line" to train the correct response to that blunder.

**Dashboard** — Overview of the user's repertoire health: due cards today, mastered
positions, overall repertoire size, unresolved gaps, review history graph, streak, and
breakdown by main lines vs punishment lines.

---

## Key Design Decisions

### Single-User with Multi-User Architecture

The app is designed for a single user per self-hosted instance. However, all user data
tables include a `user_id` foreign key from day one. This costs nothing to build now
and means multi-user support (family, chess club, or cloud-hosted version) can be added
later without restructuring the database. A single default user is created on first run.

### Authentication

The app requires a password to access. A simple username/password login screen protects
the instance from anyone who finds the URL. Session-based authentication. This is
required because most users will expose their instance through a reverse proxy like
Nginx Proxy Manager.

### Multiple Repertoires

Users can create multiple named repertoires (e.g. "White - e4 lines", "Black vs d4").
Each repertoire has a name and color (white or black). All moves, SR state, and
annotations belong to a specific repertoire. The user selects which repertoire they are
working in from the navigation.

### Two Separate Databases

**Shared Book Database** — Ships with the app as seed migration files. Contains
curated opening moves contributed to the open-source project. Read-only at runtime.
Updated via new releases (`docker compose pull`). Users never write to this.

**User Database** — Lives only on the user's own instance. Contains their personal
repertoires, punishment lines, spaced repetition state, annotations, settings, and any
moves added beyond the shared book. Never leaves their machine. Never shared.

### Repertoire Types

Each move in the user's repertoire is tagged as one of two types:

- `MAIN` — their preferred response to good opponent play. Standard opening prep.
- `PUNISHMENT` — their best response when an opponent plays a bad move. Built from
  real games the user has played.

### Move Ownership and Branching Logic

- **On the user's turn** — the user picks exactly one move per position. Only that
  move is drilled.
- **On the opponent's turn** — the user selects which opponent responses to include.
  Multiple opponent responses can be included. All are trained.

### Transposition Handling

FEN is the primary key for all positions. The same position reached via different move
orders is recognized as the same position. The UI surfaces this — if the user reaches
a position already in their repertoire via a different move order, it is flagged rather
than duplicated.

### Stockfish Role

Stockfish is a fallback and suggestion tool, not a gatekeeper:

- Suggests moves when the user is beyond the shared book in build mode
- Shows evaluation scores alongside all candidate moves in build mode
- Analyzes blunder positions in game review
- Configurable search depth in user settings

### Lichess Masters API

When online, build mode queries the Lichess Opening Explorer API for the current
position to show how often each move is played in master games and the win/draw/loss
breakdown. This gives the user practical context — not just what the engine prefers,
but what strong human players actually choose.

- Displayed alongside book moves and Stockfish evaluations in build mode
- Fetched on every position change; not cached to disk
- Graceful degradation — if the request fails or the app is offline, the column is
  simply omitted; no error is shown and no functionality is broken
- The Lichess API is public and does not require authentication

### Spaced Repetition

Uses the FSRS algorithm (via ts-fsrs). Each user-move node has its own SR state.
Drill mode queries nodes where `due <= now`. The full path from the starting position
is always played through for context.

Drill mode has three sub-modes:

- **Main lines only** — standard repertoire drilling
- **Punishment lines only** — practice responding to blunders
- **Mixed** — interleaved, most realistic

---

## Tech Stack

| Piece        | Technology     | Reason                                                          |
| ------------ | -------------- | --------------------------------------------------------------- |
| Framework    | SvelteKit      | Simpler syntax, beginner friendly, fast, scales well            |
| Board UI     | Chessground    | What Lichess uses, highly configurable, actively maintained     |
| Chess Logic  | Chess.js       | Move validation, FEN/PGN handling, well documented              |
| ORM          | Drizzle        | Lightweight, TypeScript-first, SQL-like syntax, good for SQLite |
| Database     | SQLite         | Single user self-hosted, simple backup, no extra container      |
| SR Algorithm | ts-fsrs        | State of the art spaced repetition, what modern Anki uses       |
| Chess Engine | Stockfish      | Industry standard, child process in app container               |
| Containers   | Docker Compose | Two services: app + postgres                                    |

---

## Database Schema

### Shared Book Tables (seed data, read-only at runtime)

```
book_position
  fen              TEXT PRIMARY KEY

book_move
  id               INTEGER PRIMARY KEY
  from_fen         TEXT
  to_fen           TEXT
  san              TEXT          -- e.g. "e4"
  annotation       TEXT          -- curator notes e.g. "main line", "aggressive"
  contributor      TEXT          -- contributor name for attribution

eco_opening
  code             TEXT PRIMARY KEY   -- e.g. "B90"
  name             TEXT               -- e.g. "Sicilian Defense, Najdorf Variation"
  fen              TEXT               -- position this name applies to
```

### User Tables (personal, never shared)

```
user
  id               INTEGER PRIMARY KEY
  username         TEXT UNIQUE
  password_hash    TEXT
  created_at       DATETIME

user_settings
  id               INTEGER PRIMARY KEY
  user_id          INTEGER       -- foreign key to user
  stockfish_depth  INTEGER       -- default 15
  default_drill_mode TEXT        -- "MAIN", "PUNISHMENT", or "MIXED"
  board_theme      TEXT          -- e.g. "blue", "green", "brown"
  piece_set        TEXT          -- e.g. "cburnett", "merida", "alpha"
  sound_enabled    BOOLEAN       -- default true
  updated_at       DATETIME

repertoire
  id               INTEGER PRIMARY KEY
  user_id          INTEGER       -- foreign key to user
  name             TEXT          -- e.g. "White - e4 lines"
  color            TEXT          -- "WHITE" or "BLACK"
  created_at       DATETIME

user_move
  id               INTEGER PRIMARY KEY
  user_id          INTEGER       -- foreign key to user
  repertoire_id    INTEGER       -- foreign key to repertoire
  from_fen         TEXT
  to_fen           TEXT
  san              TEXT
  type             TEXT          -- "MAIN" or "PUNISHMENT"
  source           TEXT          -- "BOOK", "PERSONAL", or "STOCKFISH"
  notes            TEXT          -- user annotations
  created_at       DATETIME

user_repertoire_move
  id               INTEGER PRIMARY KEY
  user_id          INTEGER       -- foreign key to user
  repertoire_id    INTEGER       -- foreign key to repertoire
  from_fen         TEXT
  san              TEXT
  type             TEXT          -- "MAIN" or "PUNISHMENT"
  -- FSRS spaced repetition fields
  due              DATETIME
  stability        REAL
  difficulty       REAL
  elapsed_days     INTEGER
  scheduled_days   INTEGER
  reps             INTEGER
  lapses           INTEGER
  state            INTEGER
  last_review      DATETIME

reviewed_game
  id               INTEGER PRIMARY KEY
  user_id          INTEGER       -- foreign key to user
  repertoire_id    INTEGER       -- foreign key to repertoire used for comparison
  pgn              TEXT          -- full PGN of the reviewed game
  source           TEXT          -- "MANUAL", "LICHESS"
  lichess_game_id  TEXT          -- Lichess game ID if imported from Lichess
  deviation_fen    TEXT          -- position where user went off repertoire
  played_at        DATETIME      -- date of the original game if available
  reviewed_at      DATETIME
  notes            TEXT

drill_session
  id               INTEGER PRIMARY KEY
  user_id          INTEGER       -- foreign key to user
  repertoire_id    INTEGER       -- foreign key to repertoire
  mode             TEXT          -- "MAIN", "PUNISHMENT", "MIXED"
  cards_reviewed   INTEGER
  cards_correct    INTEGER
  started_at       DATETIME
  completed_at     DATETIME
```

---

## Project Structure

```
chess-opening-trainer/
├── src/
│   ├── routes/
│   │   ├── +page.svelte                   -- dashboard / home
│   │   ├── +page.server.ts                -- load dashboard stats
│   │   ├── login/
│   │   │   └── +page.svelte               -- login screen
│   │   ├── build/
│   │   │   ├── +page.svelte               -- build mode UI
│   │   │   └── +page.server.ts            -- load book moves, save user moves
│   │   ├── drill/
│   │   │   ├── +page.svelte               -- drill mode UI
│   │   │   └── +page.server.ts            -- fetch due cards, update SR state
│   │   ├── explorer/
│   │   │   ├── +page.svelte               -- repertoire explorer UI
│   │   │   └── +page.server.ts            -- load full repertoire tree
│   │   ├── review/
│   │   │   ├── +page.svelte               -- game review UI
│   │   │   └── +page.server.ts            -- parse PGN, find deviation
│   │   ├── settings/
│   │   │   ├── +page.svelte               -- user settings UI
│   │   │   └── +page.server.ts            -- load/save settings
│   │   └── api/
│   │       ├── moves/
│   │       │   └── +server.ts             -- get/save moves
│   │       ├── stockfish/
│   │       │   └── +server.ts             -- query stockfish engine
│   │       ├── repertoire/
│   │       │   └── +server.ts             -- repertoire CRUD
│   │       ├── lichess/
│   │       │   └── +server.ts             -- Lichess game import
│   │       └── health/
│   │           └── +server.ts             -- health check endpoint
│   ├── lib/
│   │   ├── components/
│   │   │   ├── ChessBoard.svelte          -- chessground board wrapper
│   │   │   ├── MoveList.svelte            -- move history / tree display
│   │   │   ├── SRButtons.svelte           -- Again / Good / Easy buttons
│   │   │   ├── CandidateMoves.svelte      -- book/engine move suggestions
│   │   │   ├── GapFinder.svelte           -- unresolved branch indicator
│   │   │   ├── OpeningName.svelte         -- ECO name display
│   │   │   ├── StatsChart.svelte          -- review history bar chart
│   │   │   ├── RepertoireSelector.svelte  -- dropdown to switch repertoires
│   │   │   └── OnboardingWelcome.svelte   -- first-run empty state screen
│   │   ├── db/
│   │   │   ├── schema.ts                  -- drizzle schema
│   │   │   └── index.ts                   -- drizzle client
│   │   ├── auth.ts                        -- session handling
│   │   ├── stockfish.ts                   -- UCI wrapper
│   │   ├── fsrs.ts                        -- spaced repetition helpers
│   │   ├── pgn.ts                         -- PGN parsing utilities
│   │   ├── eco.ts                         -- ECO opening name lookup
│   │   └── lichess.ts                     -- Lichess API client
├── drizzle/
│   └── migrations/
│       ├── 0000_initial_schema.sql        -- all user tables + user_id structure
│       ├── 0001_seed_eco_codes.sql        -- bundled ECO opening names
│       └── 0002_seed_book_moves.sql       -- bundled opening book
├── CLAUDE.md                              -- project context for Claude Code
├── CONTRIBUTING.md                        -- how to contribute
├── CHANGELOG.md                           -- version history
├── docker-compose.yml
├── Dockerfile
└── package.json
```

---

## Docker Compose

Two services:

**app** — the SvelteKit application with Stockfish installed. The engine is spawned
as a child process per analysis request.

**postgres** — PostgreSQL database with a persistent named volume (`pgdata`).

A health check endpoint at `/api/health` returns 200 OK when the app and database are
running. Users can monitor this with Uptime Kuma or any other monitoring tool.

---

## Migrations Strategy

- Drizzle Kit for migration management
- Migrations run automatically on container startup
- Shared book moves and ECO codes added as migration files with each release
- User data migrations never touch book or ECO tables
- Users get new opening theory via `docker compose pull && docker compose up -d`
- Semantic versioning: major.minor.patch — Docker images tagged per version

---

## Feature Specifications

### Authentication

- Login screen shown to any unauthenticated visitor
- Single username/password (configured on first run via env variables or setup screen)
- Session-based — session cookie stored in browser
- All routes except `/login` and `/api/health` require authentication
- Protects the instance from unauthorized access when exposed via reverse proxy

### Onboarding / Empty State

- On first login with no repertoire built, show a welcome screen
- Clear call to action: "Create your first repertoire"
- Brief explanation of the two modes (build and drill)
- Disappears once the user has created at least one repertoire

### Multiple Repertoires

- User can create, rename, and delete repertoires
- Each has a name and color (white or black)
- Repertoire selector in the navigation — always visible
- All moves, SR state, and annotations are scoped to a repertoire
- Deleting a repertoire asks for confirmation and removes all associated data

### Build Mode

1. User selects a repertoire to work on
2. Board shows starting position, ECO name displayed if recognized
3. User makes their move (undo button available at all times)
4. App checks shared book for known responses, displays them with annotations
5. Stockfish evaluation score shown alongside each candidate move
6. If no book moves exist, Stockfish provides top 3 suggestions automatically
7. Positions already in the repertoire highlighted to surface transpositions
8. User selects which opponent responses to include (can select multiple)
9. Unresolved positions (no user response chosen yet) visually highlighted as gaps
10. User can add a text annotation to any move
11. User can flag any position as a punishment line entry point
12. Undo button takes back the last move at any time

### Drill Mode

1. User selects repertoire and sub-mode: Main Lines, Punishment Lines, or Mixed
2. App queries all `user_repertoire_move` records where `due <= now`
3. Picks one due position, reconstructs full move path from starting position
4. Plays through from move 1 — auto-playing opponent moves, pausing at user turns
5. Hint button available — reveals first letter of the correct move without spoiling it
6. User plays the correct move
7. If correct: show Again / Good / Easy grading buttons, update FSRS state
8. If incorrect: reveal correct move, auto-grade as Again, update FSRS state
9. Visual flash on board — green for correct, red for incorrect
10. Sound feedback — distinct sounds for correct and incorrect (can be disabled)
11. Keyboard shortcuts: 1 = Again, 2 = Good, 3 = Easy
12. ECO name shown throughout the drill
13. Progress bar showing remaining due cards in this session
14. End screen: cards reviewed, accuracy %, correct count, next session estimate
15. Session stats saved to drill_session table

### Explorer

1. User selects a repertoire to explore
2. Board starts at opening position
3. User can navigate forward and backward through moves freely
4. Their prepared moves shown as highlighted arrows on the board
5. Opponent responses shown in a different color
6. Positions with gaps (unresolved opponent moves) marked visually
7. Move tree shown as a collapsible list alongside the board _(future enhancement — initial implementation uses a "moves from current position" sidebar with a current-line breadcrumb, which gives full navigation without the full tree renderer)_
8. Clicking any move in the list jumps the board to that position
9. ECO name shown for current position
10. Read-only — no moves can be added here (that is build mode's job)

### Game Review

1. User pastes a PGN manually
2. App parses the PGN and plays through it move by move
3. Each move checked against user's chosen repertoire
4. First deviation highlighted — "You played Bc4 but your repertoire has Nf3 here"
5. User can browse through the full game freely after the deviation
6. At any position where the opponent played a suboptimal move, user can click
   "Add Punishment Line"
7. App runs Stockfish on that position and suggests the best response
8. User can accept the suggestion or play their own preferred response
9. Punishment line saved immediately and available in drill mode
10. Reviewed games saved to history with deviation point noted
11. User can add notes to a reviewed game

### Gap Finder (Dashboard Widget)

- Scans repertoire for positions where opponent has book moves with no user response
- Displays gap count prominently on dashboard
- Clicking opens build mode at the first unresolved position
- Also accessible as a button within build mode

### Opening Name Display

- Bundled static ECO database — ships with app, never fetched at runtime
- Shows ECO code and name for any recognized position
- Displayed in build mode, drill mode, and explorer
- Example: "B90 · Sicilian Defense, Najdorf Variation"

### Progress Dashboard

- Due today: cards needing review (click to go to drill mode)
- Mastered: positions with high FSRS stability score
- Total positions: full repertoire size
- Gaps: unresolved opponent responses
- Streak: consecutive days with at least one card reviewed
- Breakdown: main lines vs punishment lines
- Review history: bar chart of cards reviewed per day for last 30 days
- Per-repertoire breakdown available by selecting a repertoire

### Settings Page

- Username and password change
- Stockfish analysis depth (affects quality vs speed of suggestions)
- Default drill mode (Main / Punishment / Mixed)
- Board theme selector with preview
- Piece set selector with preview
- Sound on/off toggle
- Lichess username (saved for game import convenience)

### PGN Import (Secondary Build Path)

- User can upload or paste a PGN file to seed a repertoire
- App parses the full move tree including variations
- At positions with multiple candidate moves, user prompted to pick preferred move
- Useful for importing a coach's analysis or migrating from another app

### Health Check

- `/api/health` returns HTTP 200 with JSON `{ status: "ok", db: "ok" }`
- Checks that the app is running and the database is reachable
- Works without authentication so monitoring tools can poll it freely
- Compatible with Uptime Kuma out of the box

---

## Open Source Project Infrastructure

These files and systems should be set up from day one:

**CLAUDE.md** — lives in the repository root. Contains project context, tech stack,
dev commands, and code style notes. Any contributor using Claude Code gets the same
context automatically. Claude Code reads this at the start of every session.

**CONTRIBUTING.md** — explains how to set up the dev environment, code style
expectations, how to submit book move contributions, and how the PR process works.

**CHANGELOG.md** — documents what changed in each version. Self-hosted users need
to know what they are getting when they pull a new image.

**Semantic versioning** — version numbers in the format major.minor.patch. Docker
images tagged per version so users can pin to stable releases rather than always
pulling `latest`.

**GitHub Actions CI** — runs on every PR: build check, TypeScript type check,
migration smoke test. Keeps the main branch always in a working state.

**GitHub Container Registry** — automatically builds and pushes a Docker image on
every release. Users run `docker compose pull` to get updates, no build from source
required.

**README** — contains a copy-paste `docker-compose.yml` that gets someone running
in under 5 minutes. First impressions of a self-hosted project depend on setup ease.

---

## Future Features (Post-V1, Do Not Build Now)

These are noted so the architecture does not accidentally prevent them:

**Position search** — enter a FEN or play out moves to find that position in your
repertoire. Useful for jumping to a specific position without navigating the tree.

**Repertoire sharing / export** — export a full repertoire as a PGN file to share
with a friend or chess coach. Privacy-respecting: export only, no server involved.

**Board and piece customization** — already in settings, but additional piece sets
and board themes can be added over time as the community contributes them.

**Mobile optimization** — Chessground supports touch, but the surrounding UI should
be reviewed and optimized for mobile screen sizes once the desktop version is solid.

**Multi-user support** — the `user_id` foreign key on all user tables is already in
place. Adding a user management screen and multi-user auth is the remaining work.
Required before any cloud-hosted version is possible.

**Lichess game import** — user enters their Lichess username, app fetches recent games
via the Lichess API (no auth required for public games), games are displayed in a list
and loaded into game review one at a time. Lichess game ID saved to prevent duplicate
imports. This is the only external API call the app would make.

**Chess.com game import** — similar to Lichess import; requires researching the
Chess.com API before scoping.

---

## What to Build First (Ordered)

1. SvelteKit project scaffold with Drizzle and SQLite
2. Drizzle schema and initial migration (with user_id on all tables)
3. Default user created on first run
4. Authentication — login screen, session handling, route protection
5. Docker Compose file with app and postgres services
6. Dockerfile for the app
7. Health check endpoint `/api/health`
8. CLAUDE.md, CONTRIBUTING.md, CHANGELOG.md, README with docker-compose example
9. GitHub Actions CI workflow
10. ChessBoard Svelte component using Chessground
11. Multiple repertoire management (create, rename, delete, select)
12. Onboarding / empty state screen
13. Build mode — board, moves, save to database, undo
14. Book move lookup and candidate display with Stockfish evals
15. Stockfish integration (child process + UCI wrapper)
16. ECO opening name display (bundled static data)
17. Transposition detection in build mode
18. Move annotations in build mode
19. Explorer mode — read-only repertoire tree navigation
20. Drill mode — surface due cards, play through from move 1
21. FSRS grading and SR state updates
22. Drill sub-modes (main / punishment / mixed)
23. Keyboard shortcuts and sound feedback in drill mode
24. Hint button in drill mode
25. Drill session stats and end screen
26. Game review — manual PGN paste, deviation detection
27. Full ECO dataset import — expand from ~90 hand-picked positions to the full ~3,000 named positions using a generation script that replays Lichess's open-source ECO PGNs through Chess.js to produce correctly normalized FENs; the same source data also populates book_moves, making the gap finder meaningful
28. PGN import for repertoire seeding — paste or upload a PGN with variations to bootstrap a repertoire without clicking every move manually
29. Gap finder logic and dashboard widget
30. Progress dashboard with stats, chart, and streak
31. Settings page (board theme, piece set, Stockfish depth, sound)

---

## Notes for Development

- Explain each piece in plain English before writing it, as if explaining to someone
  with IT/Docker experience but no coding background
- Use TypeScript throughout
- Keep components small and focused — one job per file
- Add comments explaining what each section does
- Prefer explicit, readable code over clever abstractions
- The app must work fully offline after the Docker image is pulled
- ECO codes and opening book ship as static seed data in migrations
- Stockfish runs as a child process inside the app container
- All user data tables include user_id from the start even though only one user
  exists initially — this enables multi-user support later without schema changes
