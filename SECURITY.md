# Security

Chessstack uses a layered security approach with automated scanning at multiple
stages of the development lifecycle.

---

## Reporting a Vulnerability

If you discover a security issue, please open a
[GitHub Issue](https://github.com/your-org/chessstack/issues) with the label
`security`. Include steps to reproduce and any relevant details.

---

## Application Security

- **Authentication** — passwords hashed with bcrypt; session-based auth with
  secure, HTTP-only cookies
- **Data isolation** — all queries filter by `user_id` from the authenticated
  session; no cross-user data access
- **Input validation** — all user input is validated and sanitized before
  reaching business logic or the database
- **CSRF protection** — SvelteKit's built-in origin checking via the `ORIGIN`
  environment variable
- **Cookie security** — secure flag derived automatically from `ORIGIN`
  (HTTPS origins enable secure cookies)
- **Non-root container** — the Docker image runs as an unprivileged `node` user
- **No external calls** — the app is fully offline except for optional
  Lichess/Chess.com game imports

---

## Automated Security Scanning

### Pre-push Hooks

Every push is gated by the following checks via the `pre-commit` framework:

| Tool                    | Purpose                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| Gitleaks                | Scans Git history for hardcoded secrets, API keys, and tokens                            |
| npm audit               | Checks dependencies against the GitHub Advisory Database for known CVEs                  |
| ESLint security plugins | Catches Node.js security antipatterns and DOM injection sinks                            |
| License checker         | Ensures all dependency licenses are on the approved allowlist                            |
| Semgrep                 | SAST scanning for SQL injection, command injection, path traversal, and similar patterns |
| Trivy (filesystem)      | Scans source code and lock files for known vulnerabilities                               |
| Trivy (config)          | Checks Dockerfiles and Compose files against CIS benchmarks                              |

### CI Pipeline

GitHub Actions runs all of the above checks on every push, plus:

- **Trivy image scan** — scans the built Docker image for OS-level and library CVEs

### Dependency Licenses

Only dependencies with approved open-source licenses are permitted: MIT, ISC,
BSD-2-Clause, BSD-3-Clause, Apache-2.0, MPL-2.0, GPL-3.0-or-later, Unlicense,
CC0-1.0, CC-BY-3.0, CC-BY-4.0.
