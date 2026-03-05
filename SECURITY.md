# Security

This project uses a layered security pipeline with three enforcement points:

1. **Pre-push Git hooks** -- catch issues before code reaches the remote
2. **GitHub Actions CI** -- enforce the same checks server-side, plus Docker image scanning
3. **Manual audits** -- periodic host-level checks (documented in SECURITY-SETUP.md)

---

## Tools

### Gitleaks

Scans Git history for hardcoded secrets (API keys, passwords, tokens, private keys).

- **Runs:** pre-push hook + CI
- **Local:** `gitleaks detect --source .`
- **Suppress false positives:** add patterns to `.gitleaksignore`

### npm audit

Checks all dependencies against the GitHub Advisory Database for known CVEs.

- **Runs:** pre-push hook + CI
- **Local:** `npm audit --omit=dev`
- **Note:** `--omit=dev` skips dev dependencies since they are not shipped in the Docker image

### ESLint Security Plugins

Two plugins integrated into the main ESLint config:

- **eslint-plugin-security** -- catches common Node.js security antipatterns (eval, non-literal RegExp, non-literal require, timing attacks in string comparisons, object injection sinks)
- **eslint-plugin-no-unsanitized** -- prevents DOM injection via innerHTML, document.write, and similar sinks (maintained by Mozilla)

| Where | How |
|-------|-----|
| Pre-push hook + CI | `npm run lint:security` |
| Local | `npm run lint:security` |
| Suppress false positives | `// eslint-disable-next-line security/detect-object-injection` |

### License Checker

Ensures all dependency licenses are on the approved allowlist. Prevents accidentally introducing copyleft or proprietary dependencies.

**Approved licenses:** MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, MPL-2.0, GPL-3.0-or-later, Python-2.0, Unlicense, CC0-1.0, CC-BY-3.0, CC-BY-4.0

- **Runs:** pre-push hook + CI
- **Local:** `npx license-checker --excludePrivatePackages --onlyAllow 'MIT;ISC;BSD-2-Clause;BSD-3-Clause;Apache-2.0;MPL-2.0;GPL-3.0-or-later;Python-2.0;Unlicense;CC0-1.0;CC-BY-3.0;CC-BY-4.0;(MIT OR WTFPL);(MIT AND CC-BY-3.0);(BSD-2-Clause OR MIT OR Apache-2.0)'`
- **View all licenses:** `npx license-checker --summary`

### Semgrep

Static Application Security Testing (SAST) using community-maintained rulesets for JavaScript and TypeScript. Catches patterns like SQL injection, command injection, path traversal, and insecure deserialization.

- **Runs:** pre-push hook + CI
- **Local:** `semgrep --config p/javascript --config p/typescript .`
- **Suppress false positives:** add comments or patterns to `.semgrepignore`

### Trivy (Filesystem)

Scans source code and dependency lock files for known vulnerabilities.

- **Runs:** pre-push hook + CI
- **Local:** `trivy fs --severity HIGH,CRITICAL .`
- **Suppress false positives:** add CVE IDs to `.trivyignore`

### Trivy (Config)

Scans Dockerfiles and docker-compose.yml for misconfigurations against best practices (CIS benchmarks, Docker security guidelines).

- **Runs:** pre-push hook + CI
- **Local:** `trivy config --severity HIGH,CRITICAL .`

### Trivy (Image)

Scans the built Docker image for OS-level and library CVEs in the final container.

- **Runs:** CI only (requires built image)
- **Local:** `docker build -t chess-reps:scan . && trivy image --severity HIGH,CRITICAL chess-reps:scan`

---

## Suppressing False Positives

| Tool | Method |
|------|--------|
| ESLint | `// eslint-disable-next-line <rule-name>` with a comment explaining why |
| Gitleaks | Add the pattern to `.gitleaksignore` in the project root |
| Semgrep | Add paths to `.semgrepignore` or use `// nosemgrep: <rule-id>` inline |
| Trivy | Add CVE IDs to `.trivyignore` in the project root |

---

## Running All Checks Locally

```bash
# Run all pre-push hooks manually (requires pre-commit framework)
pre-commit run --all-files --hook-stage pre-push

# Or run each tool individually:
npm audit --omit=dev
npm run lint:security
npx license-checker --excludePrivatePackages --onlyAllow 'MIT;ISC;BSD-2-Clause;BSD-3-Clause;Apache-2.0;MPL-2.0;GPL-3.0-or-later;Python-2.0;Unlicense;CC0-1.0;CC-BY-3.0;CC-BY-4.0;(MIT OR WTFPL);(MIT AND CC-BY-3.0);(BSD-2-Clause OR MIT OR Apache-2.0)'
gitleaks detect --source .
semgrep --config p/javascript --config p/typescript .
trivy fs --severity HIGH,CRITICAL .
trivy config --severity HIGH,CRITICAL .
```
