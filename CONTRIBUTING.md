# Contributing to Chess Reps

Thank you for your interest in contributing! This document covers how to set up
a development environment, the code style expected, and how to submit changes.

---

## Table of Contents

- [Setting Up a Dev Environment](#setting-up-a-dev-environment)
- [Running the App Locally](#running-the-app-locally)
- [Code Style](#code-style)
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

### Option A — Dev server with local PostgreSQL

This is the fastest way to work on the UI. You need PostgreSQL running locally
(via Docker or native install). Stockfish analysis requires the binary on your
machine (`apt install stockfish` or `brew install stockfish`).

```bash
npm run dev
```

The app starts at `http://localhost:5173`.

You will need a `.env` file in the project root:

```env
DATABASE_URL=postgresql://chess_reps:chess_reps_secret@localhost:5432/chess_reps
ORIGIN=http://localhost:5173
DEFAULT_USERNAME=admin
DEFAULT_PASSWORD=changeme
# Only needed if Stockfish is not at /usr/games/stockfish
# STOCKFISH_BIN=stockfish
```

### Option B — Full stack with Docker

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

## Submitting a Pull Request

1. Fork the repo and create a feature branch from `main`:

   ```bash
   git checkout -b feat/short-description
   ```

2. Keep changes focused — one feature or fix per PR. Smaller PRs are easier to
   review and merge.

3. Run checks before pushing:

   ```bash
   npm run check
   npm run lint
   ```

4. Push and open a pull request against `main`.

5. In the PR description, explain:
   - What you changed and why
   - How you tested it (steps to reproduce, screenshots if UI-related)

6. CI runs automatically — a build check, TypeScript type check, and migration
   smoke test must all pass before the PR can be merged.

---

## Reporting Bugs and Requesting Features

Open a [GitHub Issue](https://github.com/your-org/chess-reps/issues) for bug
reports, feature requests, or general questions.

When reporting a bug, include:
- Steps to reproduce the issue
- Expected vs actual behavior
- Browser and OS (if UI-related)
- Docker version and deployment method (if infrastructure-related)
