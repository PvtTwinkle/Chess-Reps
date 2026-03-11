# Changelog

All notable changes to Chessstack are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Changed

- Renamed project from "Chess Reps" to "Chessstack" across all branding, Docker images, database defaults, and documentation
  - **Breaking**: Default database credentials changed — existing installations must set explicit `DATABASE_URL`/`POSTGRES_*` env vars with old values, or back up and restore data
  - Session cookie renamed; existing sessions will be invalidated (sign in again)
- Compact move suggestions in Build Mode — book and masters candidates now use a denser single-line layout with inline WDL bars, scrollable after 5 rows
- Gap Finder now uses the masters game database as its primary source, showing the most commonly played opponent moves you haven't prepared for — falls back to book moves for positions without master data

### Added

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

### Security

- Drill undo now validates all FSRS fields (type, range, and format) before writing to the database
- ECO lookup now validates FEN structure (field count, piece placement, side-to-move) before querying

### Fixed

- Drill auto-play sounds no longer continue playing after navigating away from Drill Mode
- Dashboard grid layout no longer breaks with the health score widget
- Pending timers on the Puzzles, Settings, Build, and Manage Repertoire pages are now cleared on navigation, preventing stale callbacks from firing after unmount

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

[Unreleased]: https://github.com/your-org/chessstack/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/your-org/chessstack/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/your-org/chessstack/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/your-org/chessstack/releases/tag/v1.0.0
