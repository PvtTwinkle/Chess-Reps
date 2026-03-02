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

- **Settings page** — full settings page at `/settings` with four sections:
  - **Board Theme** — choose from 5 board color themes (brown, blue, green,
    purple, grey) with a live preview. Theme applies instantly across all pages.
  - **Sound Effects** — on/off toggle (previously only accessible from the drill
    page mute button)
  - **Stockfish Depth** — slider (15–30) to control engine analysis strength
  - **Analysis Timeout** — slider (3–30 seconds) to control how long to wait for
    engine results before returning partial analysis
  - **Change Password** — secure password change form (verifies current password,
    invalidates other sessions on success)
- User settings are now loaded globally from the layout, so board theme and sound
  preferences apply consistently across Build, Drill, Explorer, and Review pages
- Stockfish API reads depth and timeout from user settings when not explicitly
  provided in the request

### Changed

- **Progress dashboard** — the dashboard now shows 8 widgets for the active
  repertoire:
  - **Due Now** — count of in-scope cards due for review, links to Drill mode
  - **Mastered** — count of cards in Review state vs total, with percentage
  - **Streak** — consecutive calendar days with completed drill sessions
    (grace: today without a session doesn't break the streak)
  - **Next Review** — relative time until the soonest future due card
  - **Card State Breakdown** — horizontal stacked bar showing New, Learning,
    Review, and Relearning counts with color legend
  - **Accuracy Trend** — last 14 completed sessions as colored blocks
    (green >80%, yellow 60–80%, red <60%)
  - **Gap Finder** — existing widget, now part of the unified grid layout
  - **Trouble Spots** — top 5 cards with 3+ lapses, showing the move and lapse
    count
  - All card stats are scope-filtered (lead-in moves excluded)
  - Pure CSS visualizations, no charting library

### Changed

- **Drill mode: confidence-based grading labels** — replaced FSRS terminology
  (Again/Good/Easy) with friendlier labels (Forgot/Unsure/Easy). Section header
  now reads "How confident was your response?" to better guide self-assessment.

- **Drill mode: show move annotations** — during the waiting phase, the sidebar
  displays the note on the opponent's last move (the move that reached the current
  position). After guessing (correct or incorrect), it swaps to show the note on
  the card's own move, reinforcing why that move is the right choice.

- **Drill mode: manual "Next" button replaces auto-advance** — after grading a
  correct answer (or seeing the correct move on a wrong answer), a "Next" button
  appears instead of auto-advancing. This gives you time to read the annotation
  before moving on. Space or Enter triggers Next; 1/2/3 shortcuts still work for
  grading.

### Added

- **Repertoire start position** — each repertoire now supports a configurable
  start position that defines where its scope begins. Drill cards for lead-in
  moves (before the start) are automatically excluded, and the gap finder only
  checks positions within scope. By default, the start is after the user's first
  move (so 1. d4 in a London repertoire or 1...c5 in a Sicilian repertoire won't
  be drilled). Set a deeper custom start in Build Mode via the "Set as Start
  Position" button (e.g. after 1. d4 d5 2. Nc3 Nc6 3. Bf4 for the Jobava London).

- **Gap Finder on dashboard** — the dashboard now detects positions where the
  opening book has moves that the user hasn't prepared a response to. Shows the
  top 5 gaps with formatted move lines (e.g. "1. e4 c5") and "Open in Build
  Mode" links that deep-link to the exact position. Displays a "fully covered"
  message when no gaps remain. Also available as `GET /api/gaps?repertoireId=X`.

- **PGN export for repertoire sharing** — export a full repertoire (including all
  variations and annotations) as a standards-compliant PGN file:
  - DFS tree traversal converts the FEN-keyed move graph into an ordered move tree,
    with the first-added move as the mainline and later additions as variations
  - Transpositions are handled by visiting each position only once; subsequent paths
    stop at the transposition point
  - Move annotations are included as PGN comments (`{like this}`)
  - Standard PGN seven-tag roster headers (Event, Site, Date, White, Black, Result)
  - Export button on the Build page sidebar (next to Import PGN) with options to
    download as a `.pgn` file or copy to clipboard
  - Export button per repertoire in the Manage Repertoires modal for quick download
  - API endpoint: `GET /api/repertoires/:id/export`

### Fixed

- **PGN import no longer creates orphaned drill cards** — when a conflict was
  resolved by replacing a move, the old move's downstream subtree (children and
  their SR cards) was left behind because only the parent's `san`/`toFen` was
  updated. Now the old subtree is deleted before the replacement, and the delete
  endpoint also sweeps for any orphaned SR cards as a defense-in-depth measure.

- **ImportPgnModal lint cleanup** — replaced `Map` with `SvelteMap` for proper Svelte 5
  reactivity, added missing `{#each}` keys, removed dead reactivity hack

- **detectConflicts.ts** — removed unused variables and dead code block

- **PGN import for repertoire seeding** — paste or upload a PGN with variations to
  bulk-populate a repertoire instead of clicking every move manually:
  - Custom PGN variation-tree parser that walks all parenthetical nesting (Chess.js's
    `loadPgn()` silently drops variations); replays each line through Chess.js for
    FEN computation and move validation
  - Conflict detection: when the PGN has multiple user moves at the same position, or
    the existing repertoire disagrees with the PGN, the user is prompted to choose
  - Conflict resolution UI shows a mini ChessBoard with colored arrows for each
    alternative move and matching colored dots on the choice buttons
  - PGN annotations (`{like this}`) are preserved as move notes; engine-specific
    tags (`[%evp ...]`, `[%cal ...]`, `[%csl ...]`) are filtered out
  - Batch insert via single SQLite transaction for atomicity
  - Import summary shows moves added, replaced, and duplicates skipped
  - "Import PGN" button in the Build mode sidebar header
  - `src/lib/pgn/parseVariations.ts` — variation tree parser + Chess.js replay
  - `src/lib/pgn/detectConflicts.ts` — conflict detection against existing repertoire
  - `POST /api/import/parse` — stateless parse + preview endpoint
  - `POST /api/import/execute` — batch insert with conflict replacement support
  - `src/lib/components/build/ImportPgnModal.svelte` — multi-step modal UI

### Changed

- **Drill depth tabs renamed** — tab labels changed from "All / 1–5 / 6–15 / 16+"
  to "All Moves / Foundation (1–5) / Mainlines (6–15) / Deep Lines (16+)" for
  clearer intent at a glance

- **Refactored RepertoireSelector** — split the 770-line component into two
  single-purpose files with no behavior or UI changes:
  - `src/lib/components/ManageRepertoireModal.svelte` — the full-screen modal
    for creating, renaming, and deleting repertoires (all modal state, markup,
    styles, and API calls)
  - `RepertoireSelector.svelte` reduced from ~770 to ~273 lines (selector
    button, dropdown, and repertoire switching only)

- **Refactored Build Mode page** — split the 1,337-line `build/+page.svelte` into
  three focused modules with no behavior or UI changes:
  - `src/lib/components/build/buildState.svelte.ts` — Svelte 5 runes module
    containing all `$state`, `$derived`, and action functions (`handleMove`,
    `handleUndo`, `deleteMove`, `navigateTo`, annotation helpers, etc.); exports
    a `createBuildState()` factory that returns reactive state and actions
  - `src/lib/components/build/MoveList.svelte` — the "Current Line" move-pair
    display with numbered moves, clickable SAN buttons, and current-position
    highlighting
  - `src/lib/components/build/AnnotationModal.svelte` — the notes modal with
    textarea, character count, save/cancel, and error display
  - `+page.svelte` reduced from ~1,337 to ~430 lines (layout, Chessground setup,
    and event wiring only)

### Fixed

- **`learningSteps: 0` now explicit in all SR card inserts** — `POST /api/moves`
  was relying on the column's `DEFAULT 0` while the two other card-creating routes
  (`review/add-move`, `review/fail-card`) set it explicitly; all three are now
  consistent
- **Stockfish route uses `throw error()` consistently** — `POST /api/stockfish`
  was returning `json({ error: '...' }, { status: ... })` for auth and input
  failures instead of `throw error()` like every other route; standardised
- **Session cookie `secure` flag is now environment-driven** — was hardcoded
  `false`; now reads `SECURE_COOKIES=true` env var so production deployments
  behind HTTPS can opt in without a code change; `docker-compose.yml` documents
  the opt-in as a commented example and `CLAUDE.md` env table updated

### Changed

- **Explicit return type annotations on helper functions** — `drill/+page.svelte`
  and `review/+page.svelte` helper functions (34 total) now have `: void` or
  `: Promise<void>` return types; type-check and lint pass clean

### Added

- **Database indexes** (`drizzle/migrations/0007_add_indexes.sql`) — 9 indexes added
  to eliminate full table scans on the most frequently queried columns:
  - `user_move(repertoire_id)`, `user_move(from_fen)`
  - `user_repertoire_move(repertoire_id)`, `user_repertoire_move(from_fen)`,
    `user_repertoire_move(due)` — `due` is the primary sort key for FSRS scheduling
  - `reviewed_game(repertoire_id)`
  - `book_move(from_fen)` — covers the 7,833-row book table on every position lookup
  - `session(user_id)` — hit on every authenticated request
  - `drill_session(repertoire_id)`
  - Indexes also declared in `schema.ts` via Drizzle's `index()` helper so schema and
    migrations stay in sync

### Fixed

- **Move + SR card writes are now transactional** — `POST /api/moves` and
  `POST /api/review/add-move` previously did two separate writes (insert/update
  `user_move`, then insert/update `user_repertoire_move`) with no transaction
  wrapper. If the second write failed, the move and its SR card would be out of
  sync. Both endpoints now use `db.transaction()` so both writes succeed or roll
  back together. Follows the same pattern as the repertoire DELETE handler.

- **Malformed JSON now returns 400 instead of 500** — all API routes that call
  `request.json()` now wrap the call in a try-catch; a `SyntaxError` from a
  malformed body returns a clean `400 Invalid JSON body` response rather than
  an unhandled 500. Affected routes: `review/save`, `review/add-move`,
  `review/fail-card`, `drill/session`, `drill/session/[id]`, `drill/grade`,
  `moves`, `moves/[id]`, `repertoires`, `repertoires/[id]`, `repertoires/active`,
  `settings`, `stockfish`.

### Changed

- **Stockfish API restructured** — book moves and engine moves are now fully
  independent lists rather than a merged, sorted combined list:
  - Book moves are returned first with no engine eval attached (evals in the
    opening are rarely meaningful and were misleading)
  - Engine moves are always the top N Stockfish results regardless of overlap
    with the book; the two groups are shown in separate tabs so no sorting is
    needed between them
  - `DEFAULT_DEPTH` raised from 15 → 20; `MAX_DEPTH` raised from 20 → 30;
    `MIN_DEPTH` (15) introduced to floor any request that asks for shallow analysis

- **Eval scores now shown from the player's perspective** — previously all evals
  were displayed from White's perspective (standard engine convention), which made
  scores confusing for Black repertoire players (a "+0.4" meant Black was losing):
  - `CandidateMoves` component accepts a new `playerColor` prop; Build mode passes
    the active repertoire's color so the engine tab always shows positive = good for you
  - `formatEval` and `evalColorClass` flip the sign and colour threshold for Black players
  - Game Review eval displays (DEVIATION detail scores and candidate move buttons)
    also flip for Black via `formatEval` / `formatCandidateEval` helpers

### Fixed

- **Review mode: all book moves now shown as candidates** — when a book move
  happened to also be one of Stockfish's top engine picks, the deduplication logic
  was overwriting the book entry with the engine entry, stripping its `isBook: true`
  flag and causing it to render as an engine move. The fix merges the two: the book
  entry keeps its identity and opening name, and gains the engine's eval score.

### Added

- **Full ECO opening dataset** — expanded from ~90 hand-picked positions to the
  complete 3,641-position Lichess ECO dataset, covering all named openings and
  sub-variations across sections A–E:
  - `eco_opening` table now stores one row per unique named position (FEN as
    primary key) rather than one row per ECO code — B90 alone now has 10+
    entries for the Najdorf, English Attack, Adams Attack, etc.
  - `book_move` table populated with 7,833 unique moves covering all ECO lines;
    `UNIQUE(from_fen, san)` added to prevent duplicates from shared early moves
  - `drizzle/migrations/0006_full_eco_dataset.sql` — migration that rebuilds both
    tables and seeds the full dataset
  - `scripts/generate-eco-seed.mjs` — one-time generation script; fetches 5 TSV
    files from the Lichess chess-openings repo, replays each line through Chess.js
    to produce correctly-normalised FENs, and writes the migration SQL; use
    `--count N` to test a subset before the full run

- **Game review mode** (`src/routes/review/`) — analyse a played game against your repertoire:
  - Paste any PGN; auto-detects deviations, gaps, and opponent surprises
  - Board auto-plays moves from the opening at 500 ms/move with sound, stopping at the first issue
  - Arrow keys and ◀/▶ buttons for manual navigation (cancels auto-play); move sounds on forward steps
  - **DEVIATION** — you played a different move than your repertoire:
    - Red arrow on the wrong move, green arrow on the correct alternative
    - Stockfish evals fetched in the background for both moves (e.g. `(−0.3)` vs `(+0.5)`)
    - "Fail card" drops the FSRS card back to review; "Update repertoire" replaces the move and fails the card
  - **BEYOND_REPERTOIRE** — you played from a position not in your repertoire:
    - "Add my move" saves it; "Engine suggestion" fetches the top engine/book candidate
  - **OPPONENT_SURPRISE** — opponent played a move you haven't prepared for:
    - Phase 1: add the opponent's move to your repertoire
    - Phase 2: add your actual response or an engine-suggested alternative (up to 3 candidates)
  - All issues can be individually resolved or skipped; resolved cards are dimmed
  - Notes field and "Save Review" persists the game to `reviewed_game` with deviation FEN
  - Recent review history shown on the input screen
  - `src/routes/review/+page.server.ts` — load + `analyzeGame` form action
  - `src/lib/pgn/index.ts` — pure `parsePgn` and `analyzeGame` helpers (no DB access)
  - `POST /api/review/fail-card` — marks an FSRS card as Again
  - `POST /api/review/add-move` — adds a move to the repertoire (with optional force-replace)
  - `POST /api/review/save` — saves the reviewed game record

- **Drill session persistence and next-session estimate** — sessions are now saved
  to the `drill_session` table and the end screen shows when the next cards will
  be due:
  - `POST /api/drill/session` — creates a session row on the first card graded
  - `PATCH /api/drill/session/[id]` — finalises the session on completion;
    queries the minimum future `due` timestamp to return as `nextDueAt`
  - End screen now shows a "Next session" stat: "Today at 2:30 PM",
    "Tomorrow at 9:00 AM", "In 3 days", or "—" if no future cards are scheduled
  - Abandoned sessions (navigating away mid-drill) are preserved with
    `completed_at = null` for future dashboard use

- **Hint button in drill mode** — 💡 Hint button appears in the sidebar on your turn:
  - Highlights the source square of the correct piece with a yellow Chessground circle
    (reveals _which_ piece to move, not where it goes)
  - After clicking, the button is replaced by a "hint active" notice warning that
    the move will be graded Again
  - If you then play the correct move: green flash, "Correct! (hint used)" banner,
    auto-graded as Again and auto-advanced after 2 s — no grade buttons appear
  - If you play the wrong move after a hint: same auto-Again flow as always
  - Hint state is fully cleared between cards

- **Keyboard shortcuts in drill mode** — press `1`, `2`, or `3` to grade a card
  (Again / Good / Easy) without reaching for the mouse; keys only fire when the
  grading buttons are visible and are ignored inside input fields
- **Sound feedback** — distinct audio cues for every chess interaction:
  - Piece movement and capture sounds on all interactive board moves (drag-and-drop
    and sidebar clicks) in Build mode, Explorer mode, and Drill mode
  - Auto-played moves in Drill mode also produce sounds as each position is replayed
  - "Correct" notification sound after a right answer in Drill mode
  - "Incorrect" error sound on a wrong answer in Drill mode
  - All four sounds use Lichess's open-source assets (`static/sounds/`)
  - `src/lib/sounds.ts` — centralised sound manager: single `AudioContext`,
    preloaded `AudioBuffer`s for zero-latency playback, module-level enable flag
- **Mute toggle** — 🔊/🔇 button in the Drill mode sidebar silences all sounds for
  the session and persists the preference to the database
- **`PATCH /api/settings`** — new endpoint to update user settings fields; currently
  handles `soundEnabled` and is designed to accept additional fields as the Settings
  page is built in a later step

### Added

- **Drill mode** (`src/routes/drill/`) — spaced repetition practice:
  - Auto-plays the full move sequence from move 1 to the due position at 500 ms per move
  - Board becomes interactive at the due position — user must play the correct move
  - Correct: green flash → Again / Good / Easy FSRS grading buttons
  - Incorrect: red flash → reveals correct move → auto-grades Again after 2 s
  - Progress bar showing current card and total due
  - Session complete screen with cards reviewed and accuracy percentage
  - "All caught up!" screen when no cards are due
  - `POST /api/drill/grade` — applies a rating to an SR card via the FSRS algorithm
  - `src/lib/fsrs.ts` — wraps `ts-fsrs` with DB ↔ FSRS type conversions; exposes
    `gradeCard()` and `nextIntervalLabel()` helpers
  - `drizzle/migrations/0004_learning_steps.sql` — adds `learning_steps` column for
    ts-fsrs v5 compatibility

### Changed

- Removed MAIN / PUNISHMENT move-type distinction — all repertoire moves are now
  treated equally; game review (upcoming) will add off-book moves without tagging
  - `drizzle/migrations/0005_remove_types.sql` drops `type` from `user_move` and
    `user_repertoire_move`, `default_drill_mode` from `user_settings`, and `mode`
    from `drill_session`
  - Sub-mode selector (Main / Punishment / Mixed) removed from drill UI

### Fixed

- Drill page infinite reactive loop on load — `startNextCard()` was reading
  `filteredCards` (a `$derived`) inside the data-sync `$effect` after writing its
  dependencies, causing Svelte 5 to reschedule the effect endlessly; fixed with
  `untrack()`
- "Drill again" button did nothing after session complete — now calls `invalidateAll()`
  so fresh due dates are fetched from the server before restarting

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

- **Explorer mode** (`src/routes/explorer/`) — read-only repertoire tree browser:
  - Board arrows show all prepared moves at the current position (green = your moves,
    blue = opponent responses) using Chessground `autoShapes`
  - Gap indicators (`!` badge) on opponent moves that lead to positions with no
    prepared user response
  - Current line breadcrumb with clickable moves for fast position jumping
  - Back / Reset navigation controls; no board interaction — fully read-only
  - "Build from here" button links to Build mode at the exact current position by
    encoding the nav history as a `?line=e4,e5,Nf3` query param; Build mode replays
    the line on first mount so the board jumps straight to that position
  - `autoShapes` prop added to `ChessBoard` component for programmatic arrow/dot
    overlay (available for Drill mode and other future features too)

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
