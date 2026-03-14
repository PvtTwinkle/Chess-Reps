# Changelog

All notable changes to Chessstack are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- Correct-move arrow in drill mode — a green arrow on the board shows the right move when you guess wrong, instead of only showing notation
- Playback speed setting — slider in Settings → Drill to control how fast moves are auto-played in drill and review (200ms–2000ms)
- Game review move evaluations — each move shows an inline eval and is color-coded by centipawn loss (best/good/inaccuracy/mistake/blunder)
- "Your Move" sidebar card shows a live-updating eval and CPL color that refines as the engine analyzes deeper

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

[Unreleased]: https://github.com/PvtTwinkle/Chessstack/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/PvtTwinkle/Chessstack/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/PvtTwinkle/Chessstack/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/PvtTwinkle/Chessstack/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/PvtTwinkle/Chessstack/releases/tag/v1.0.0
