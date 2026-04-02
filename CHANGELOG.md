# Changelog

All notable changes to Chessstack are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [1.3.0] -- 2026-04-02

### Added

- Opening Trainer mode -- practice openings against a computer that plays moves weighted by real game statistics from the Lichess open database or masters database
- Computer opponent selects moves with probability proportional to how often each move is played at the chosen rating bracket
- Rating bracket selector with human-readable labels (e.g. "1401-1600"), defaulting to the bracket matching the user's trainer rating
- Per-user trainer Elo rating that updates after rated sessions, with difficulty scaling based on the selected rating bracket relative to your rating
- Configurable depth limit (full moves), with training always stopping on database exhaustion, game over, or manual stop
- Stockfish evaluation of the final position shown on the end screen with rating change breakdown
- Review Game button sends the completed PGN to the review page with full move history, player names, date, rating, and result headers
- Analyze on Lichess link on the end screen to open the final position in the Lichess analysis explorer
- Save and reuse custom starting positions with lead-in move tracking so PGNs always start from move 1
- Repertoire start position support with automatic path reconstruction from the move tree
- First-visit prompt to set an initial trainer rating, also editable from the Settings page
- Rated/unrated session toggle
- Tutorial now includes an Opening Trainer step after Drill, explaining the feature and its rating system

### Fixed

- Game review move list no longer pushes the board and sidebar apart as the game gets longer

### Changed

- Updated all dependencies to latest compatible versions: Svelte 5.55, Vite 8, ESLint 10, Drizzle ORM 0.45.2, and others
- Lichess import script supports cumulative multi-month imports with separate retention and dump thresholds (`--min-games` and `--min-dump-games`)
- Recovery script accepts `--min-games` argument instead of using a hardcoded value

### Known Issues

- Opening Trainer sessions tend to run out of database moves earlier than expected because only one month of Lichess game data is currently loaded, filtered to positions reached at least 100 times. Work is in progress to import at least a year of data and lower the threshold to 50 games.

---

## [1.2.2] — 2026-03-28

### Changed

- Dropped arm64 from the release Docker image to fix builds timing out under QEMU emulation (amd64 only for now)
- Improved mobile responsive layout across all pages with standardized breakpoints and small-phone support
- Dashboard switches to single-column grid on phones under 480px
- Settings page now has full responsive support (touch targets, stacked forms, iOS zoom prevention)
- Admin user cards stack earlier (at tablet width) for better readability
- Header compacts in landscape orientation on phones (shorter bar, hidden brand text)
- Fullscreen modals now trigger at 479px instead of 559px, keeping centered dialogs on larger phones
- Expanded the tutorial from 5 steps to 9, covering all major pages including Puzzles, Review, Prep, and Dashboard
- Tutorial now highlights more features per page: all five suggestion tabs in Build, Explore mode, Cards/Lines drill modes, Blindfold mode, and PGN import/export
- Rewrote README with grouped feature sections, screenshots, tech stack table, and all features through v1.2.1
- Updated THIRD-PARTY-NOTICES with Lichess Open Database and Star Player Games (PGN Mentor, Lichess API, Chess.com API)

### Fixed

- Resolved security lint warning in PGN header parser by using static regex patterns
- Fixed hardcoded goal input width on dashboard that could overflow on small screens
- Fixed prep detail panel overflowing on narrow phones due to min-width: 250px constraint
- Added 44px touch targets to drill grading buttons, filter tabs, puzzle checkboxes, and admin action buttons

---

## [1.2.1] — 2026-03-28

### Added

- **Players move database** — Lichess open database seeded on first boot, showing the most commonly played moves per rating bracket

---

## [1.2.0] — 2026-03-27

### Added

- **Tournament Prep Mode** — new /prep page for opponent-specific preparation
  - Download an opponent's games from Lichess or Chess.com, analyze tendencies, and build targeted responses
  - Alternating turn-based UI: on the opponent's turn see their most-played moves with W/D/L stats; on your turn pick a response using Book/Masters/Stars/Players/Engine tabs plus data on what others played against them
  - Gap detection walks your prep tree and highlights positions where you have no prepared response, prioritized by how often the opponent reaches them
  - Animated "Next uncovered position" button replays the line move-by-move to the highest-priority gap
  - Coverage dashboard shows reachable positions with green/yellow/red breakdown
  - Move tree view (same collapsible tree from Build mode) shows the full prep structure
  - Min-games filter to hide rare moves, and per-move exclusion with restore
  - Export prep as a new repertoire with FSRS drill cards, or add prep moves to an existing repertoire with conflict resolution
  - Configurable max games per fetch (50–5000), time window selector on refresh, and chunked server uploads for large datasets
  - Refresh confirmation to prevent accidental data replacement
  - One-move-per-position enforcement (matching Build mode) — conflict banner warns when a different move already exists
  - Smart worker filter preserves leaf moves at established positions so you can see the end of lines
  - Lichess game fetch prioritizes most recent games (dateDesc) so capped fetches get the latest data

### Changed

- **Light theme redesigned** — replaced heavy blue-grey backgrounds with a proper cool-neutral palette inspired by GitHub; cards are now white on a light off-white page with clear layering, tuned accent/eval/semantic colors, and softer border+shadow depth

### Fixed

- Black prep export was including wrong opponent moves, causing broken drill cards — now correctly filters by expected opponent color
- "Next uncovered position" was stuck at the first move because gap detection only walked opponent moves — now follows prep moves and coverage deeper into the tree
- Dashboard stats (coverage %, position count) were counting unreachable positions — now consistent with gap detection by only counting positions reachable through your prep
- Suggestions in "Played against your opponent" could bypass the one-move-per-position rule — now routed through the conflict check
- Large opponent datasets (2700+ games) failed on merge due to PostgreSQL parameter limits and SvelteKit body size — chunked into 1000-move batches sent as separate requests
- Duplicate `{#each}` keys in move panels caused page crashes after export — switched to index-based keys

### Removed

- Trivy filesystem scan from pre-push hooks and CI — redundant with npm audit and the Docker image scan, and caused SSH timeouts during database downloads

### Changed

- FSRS config loading extracted into a shared helper — eliminates duplicated query logic across three API routes
- FSRS instances are now cached by config key, avoiding redundant instantiation on repeated calls
- Interval label computation calls `f.repeat()` once per card instead of three times (one per rating)
- WDL move rows in Build mode deduplicated into a shared Svelte snippet used by Masters, Stars, and Players tabs
- Drill grade and fail-card API routes now load the card and FSRS config in parallel
- Dockerfile no longer creates an empty placeholder for the Lichess dump file
- PostgreSQL port exposed by default in docker-compose for easier local access

### Added

- **Stars tab** in Build mode — see what moves famous players like Magnus Carlsen, Bobby Fischer, or GothamChess played at any position, with win/draw/loss stats
- Player dropdown in the Stars tab groups players by category: Chess Legends, Modern Super-GMs, Streamers & YouTubers, and Meme
- Import scripts for adding star players from PGN files (`celebrity-import.py`) or downloading games from Lichess/Chess.com APIs (`celebrity-download.py`)
- Celebrity move data ships in the Docker image and auto-loads on first boot, just like the masters and puzzle databases
- **Drill scheduling settings** — configure desired retention (70–97%), maximum review interval (30–3650 days), and relearning delay (1–60 min) from the Settings page
- **Interval labels on drill grade buttons** — each button now shows how long until the card reappears (e.g. "Forgot · 10 min", "Easy · 7 days")
- Link to the FSRS algorithm wiki in Settings for users who want to understand how scheduling works
- **Players tab** in Build mode — shows the most popular moves played at each position, filtered by rating bracket (0–1000 through 2201–2400), sourced from the Lichess Open Database
- Import script for Lichess game data — streams .pgn.zst files, supports incremental month-by-month imports, and exports a pg_dump for Docker distribution
- "Analyze on Lichess" link in Build mode — opens the current position on Lichess for deeper analysis

### Changed

- Dockerfile now downloads seed data dumps from GitHub Releases during build — Railway, CI, and local builds all work without needing the dump files in the repo
- Release workflow simplified — seed download step removed since the Dockerfile handles it
- Removed unused `resulting_fen` column from the celebrity moves table — simplifies storage and import scripts
- Lichess import script now aggregates one rating bracket at a time instead of materializing the entire dataset in a temp table — keeps disk usage manageable for large imports
- Default maximum review interval lowered from ~100 years to 365 days — cards no longer vanish indefinitely
- Light mode redesigned with ice-blue palette — softer on the eyes and aligned with brand colors
- Dark mode background shifted from pitch black to deep navy
- Blue chessboard theme now uses brand colors (Dim Blue dark squares, light blue-white light squares)
- Header bar has a clean edge in light mode instead of a blurred shadow
- Updated logo and added a warm white background for better visibility in dark mode
- Gap finder default threshold raised from 1,000 to 10,000 master games — less noise out of the box
- Build sidebar is more compact — repertoire tree starts collapsed (click to expand), action buttons consolidated into a single row of chips, and Import/Export PGN moved into a "⋯" overflow menu
- Dependency updates — patched prototype pollution vulnerabilities in devalue and flatted, plus minor bumps to SvelteKit, Svelte, Drizzle Kit, ts-fsrs, and typescript-eslint

---

## [1.1.2] — 2026-03-14

### Added

- Correct-move arrow in drill mode — a green arrow on the board shows the right move when you guess wrong, instead of only showing notation
- Playback speed setting — slider in Settings → Drill to control how fast moves are auto-played in drill and review (200ms–2000ms)
- Game review move evaluations — each move shows an inline eval and is color-coded by centipawn loss (best/good/inaccuracy/mistake/blunder)
- "Your Move" sidebar card shows a live-updating eval and CPL color that refines as the engine analyzes deeper
- Server-side logging — startup confirmation, Stockfish failure warnings, failed login attempts, and unhandled error catch-all now appear in `docker logs`
- "Ready at" startup message showing the configured ORIGIN URL

### Changed

- Licensed the project under AGPL-3.0-or-later (previously stated as MIT with no formal license file)

---

## [1.1.1] — 2026-03-12

### Fixed

- Engine eval suggestions not streaming progressively in Docker/production builds

---

## [1.1.0] — 2026-03-12

### Added

- Custom Chessstack logo — isometric chessboard with pawn, used as both favicon and header brand icon
- Guided tutorial for first-time users — a floating card walks new users through Build, Drill, Puzzles, and Review step by step
- "Restart Tutorial" button in Settings to replay the walkthrough at any time
- Streaming engine analysis — the eval bar and candidate move scores now update progressively as Stockfish searches deeper, instead of waiting for the full analysis to finish
- Masters database and puzzle database now ship pre-loaded in the Docker image — no manual download or restore steps required; data is seeded automatically on first boot
- Resizable chessboard — drag the bottom-right corner handle to make the board larger or smaller; your preferred size is saved across sessions and shared across all pages
- Start screen on the Drill page — see how many cards are due with a depth breakdown before you begin, choose your drill type and filters, then hit Start Drilling (or press Space)
- Line-based drilling — toggle between Cards and Lines mode in Drill to practice complete variations from start to leaf, with auto-grading and automatic opponent moves
- Blindfold mode in Drill — hide all pieces and play from memory, with move announcements displayed on the board during auto-play
- Configurable gap threshold dropdown on the dashboard widget — filter gaps by minimum master games played (10 / 100 / 1,000 / 10,000)
- Drill All mode to practice every card in the repertoire regardless of schedule
- Dark/light theme toggle in Settings
- Evaluation bar next to the board in Build Mode showing the engine's position assessment at a glance
- Undo button for drill grades so you can correct a mis-tap
- Keyboard shortcuts and move preview arrows in Build Mode
- Explore Mode on the Build page — try moves on the board without saving them to your repertoire
- Repertoire health score widget on the Dashboard — now shows actionable tips (e.g. "Drill 12 due cards to improve") linking to the right page
- Tempo training — optional countdown timer for Drill Mode (configurable 3–30 seconds per move in Settings; auto-fails if time runs out)

### Changed

- Renamed project from "Chess Reps" to "Chessstack" across all branding, Docker images, database defaults, and documentation
  - **Breaking**: Default database credentials changed — existing installations must set explicit `DATABASE_URL`/`POSTGRES_*` env vars with old values, or back up and restore data
  - Session cookie renamed; existing sessions will be invalidated (sign in again)
- Complete UI redesign: switched from DM Serif Display + JetBrains Mono to Manrope font family
- New color palette with warm tones, updated accent color, and refined border/shadow/radius tokens
- Refreshed styling across all components — modals, buttons, tabs, move lists, onboarding, login/register, settings, and admin pages
- Sidebar panels on Build, Drill, Puzzles, and Review pages now have a visible card background for better visual separation
- Wider page layouts across the site reduce blank space on desktop screens
- Light theme background is now a warm light gray instead of near-white
- Board-to-sidebar spacing tightened so the sidebar sits closer to the chessboard
- Dashboard stat widgets now display as a clean 2×3 grid instead of 4 columns with empty space
- Import buttons on the Review page now have a distinct background against their card panel
- Compact move suggestions in Build Mode — book and masters candidates now use a denser single-line layout with inline WDL bars, scrollable after 5 rows
- Gap Finder now uses the masters game database as its primary source, showing the most commonly played opponent moves you haven't prepared for — falls back to book moves for positions without master data
- Gap finder logic extracted into a shared utility, eliminating duplicated code between the dashboard and API endpoint
- Game import now runs in a single database transaction so the watermark stays in sync with inserted data
- Theme query in request hooks is now skipped for API calls, reducing a database round-trip on every API request
- Updated all devDependencies to latest compatible versions
- Upgraded chessground from 9.x to 10.x (internal DOM performance optimization, no API changes)

### Fixed

- Board layout now adapts to different monitor sizes — the sidebar hugs the board instead of leaving a gap, and the board auto-shrinks to fit smaller screens (e.g. 1080p) without manual resizing
- Move suggestion tabs (Book/Masters/Engine) no longer jump back to Book after selecting a move — the tab stays on whichever view you're using unless it has no results for the new position
- Color indicators for imported games now use explicit colored dots instead of Unicode chess pieces that rendered as the wrong color on dark backgrounds
- Chess.com and Lichess game import now checks both player names explicitly and falls back to PGN headers, preventing color misdetection
- Puzzle page chessboard now displays correctly on first visit without needing a manual resize
- Board resize no longer resets navigation state on build, drill, review, or puzzle pages
- Puzzles page now respects "auto" board size instead of always defaulting to 520px
- Foreign keys now use ON DELETE CASCADE (or SET NULL for imported game links), preventing orphaned rows when users or repertoires are deleted
- Puzzle finder now uses a database subquery instead of loading all attempted puzzle IDs into memory
- Deleting a repertoire no longer leaves dangling references in the imported games table
- Drill auto-play now works correctly for positions reached via transpositions (different move orders to the same board position)
- Drill auto-play sounds no longer continue playing after navigating away from Drill Mode
- Dashboard grid layout no longer breaks with the health score widget
- Pending timers on the Puzzles, Settings, Build, and Manage Repertoire pages are now cleared on navigation, preventing stale callbacks from firing after unmount
- Removed duplicate CSS rules and added missing aria-labels to icon-only buttons for accessibility
- Docker volume warning resolved by marking the named volume as external

### Security

- Added security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) on all responses
- Puzzle theme filter now rejects values containing regex metacharacters, preventing pattern injection
- All `as Error` casts replaced with `instanceof Error` type guards for safer error handling
- Drill undo now validates all FSRS fields (type, range, and format) before writing to the database
- ECO lookup now validates FEN structure (field count, piece placement, side-to-move) before querying

### Removed

- Unused Lichess API stub endpoint (game import was already handled elsewhere)

---

## [1.0.2] — 2026-03-06

### Fixed

- Fixed crash in Review Mode when viewing a deviation from repertoire (infinite reactive loop)

---

## [1.0.1] — 2026-03-06

### Added

- Delete confirmation modal in Build Mode before removing moves

### Changed

- Standardized project documentation for public release
- Cleaned up stale files and expanded `.dockerignore` for smaller build context

### Fixed

- Puzzle opening matching now uses tree-aware ECO selection for more accurate results
- Formatting and code style consistency improvements

---

## [1.0.0] — 2026-03-04

First stable release. A fully self-hosted chess opening trainer with spaced repetition,
game review, puzzle training, and a local masters database — all running offline in Docker.

### Added

#### Core

- **Build Mode** — interactive repertoire builder with auto-saving moves, turn enforcement,
  undo, delete with subtree cascade, and move annotations
- **Drill Mode** — spaced repetition practice using the FSRS algorithm with auto-play to
  the due position, correct/incorrect feedback, confidence-based grading (Forgot/Unsure/Easy),
  hint button, keyboard shortcuts, and session persistence
- **Game Review** — paste a PGN to analyze against your repertoire with auto-play,
  deviation detection, Stockfish eval comparisons, and one-click repertoire updates
- **Puzzle Training** — solve tactics from the Lichess puzzle database matched to your
  repertoire openings with rating and theme filters
- **Explorer / Tree View** — collapsible repertoire tree in the Build Mode sidebar
  with click-to-navigate and current position highlighting

#### Repertoire Management

- Multiple repertoire support with create, rename, delete, and color selection
- Active repertoire persisted across sessions
- Configurable start position per repertoire to scope drill and gap detection
- PGN import with variation parsing, conflict resolution, and annotation preservation
- PGN export with all variations and annotations (download or clipboard)
- Onboarding screen for new users with inline repertoire creation

#### Analysis

- Stockfish engine integration with configurable depth and timeout
- Candidate move display with Book, Masters, and Engine tabs
- Local masters database (Chessmont, ~8.8M positions from 21.5M master games)
  with W/D/L statistics per move
- ECO opening name display (3,641 positions from the Lichess ECO dataset)

#### Dashboard

- Due Now count with link to Drill
- Mastered card count and percentage
- Streak tracker (consecutive days with completed drill sessions)
- Next Review countdown
- Card State Breakdown (New / Learning / Review / Relearning bar)
- Accuracy Trend (last 14 sessions as colored blocks)
- Gap Finder with deep links to Build Mode
- Trouble Spots showing top leeches by lapse count
- Puzzle goal widget with configurable daily/weekly/monthly targets

#### Game Import

- Lichess and Chess.com game import with smart repertoire matching
- Imported game list with status tracking and filter chips
- Watermark-based incremental import (only fetches new games)

#### User Management

- Multi-user support with role-based access (admin / user)
- Admin panel for creating, disabling, promoting, and deleting accounts
- Configurable registration mode (open or invite-only)
- Session-based authentication with secure cookie handling

#### Settings

- Board theme selection (brown, blue, green, purple, grey) with live preview
- Sound effects toggle with distinct audio cues for moves, captures, correct, and incorrect
- Stockfish depth and analysis timeout sliders
- Password change with session invalidation

#### Infrastructure

- Docker Compose deployment (app + PostgreSQL)
- Stockfish installed in the app container as a child process
- PostgreSQL with automatic migrations on startup
- Health check endpoint compatible with monitoring tools
- GitHub Actions CI with migration smoke tests
- Security scanning pipeline (Gitleaks, Semgrep, npm audit, Trivy)
- Production Docker Compose and container release workflow
- Data distribution scripts for GitHub Releases

### Changed

- Database migrated from SQLite to PostgreSQL
- UI redesigned with dark luxury theme, design tokens, and responsive layouts
- Mobile-first responsive optimization across all pages and modals
- Evals displayed from the player's perspective (positive = good for you)

---

[Unreleased]: https://github.com/PvtTwinkle/Chessstack/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/PvtTwinkle/Chessstack/compare/v1.2.2...v1.3.0
[1.2.2]: https://github.com/PvtTwinkle/Chessstack/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/PvtTwinkle/Chessstack/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/PvtTwinkle/Chessstack/compare/v1.1.2...v1.2.0
[1.1.2]: https://github.com/PvtTwinkle/Chessstack/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/PvtTwinkle/Chessstack/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/PvtTwinkle/Chessstack/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/PvtTwinkle/Chessstack/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/PvtTwinkle/Chessstack/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/PvtTwinkle/Chessstack/releases/tag/v1.0.0
