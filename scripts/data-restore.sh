#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Data Restore — download and load optional datasets into Chessstack
#
# Downloads pre-built data dumps from GitHub Releases and restores them
# into the PostgreSQL database. The app must be running (docker compose up -d)
# before running this script.
#
# Usage:
#   ./scripts/data-restore.sh                          # download + restore all
#   ./scripts/data-restore.sh --chessmont-only         # masters data only
#   ./scripts/data-restore.sh --puzzles-only           # puzzles only
#   ./scripts/data-restore.sh --local FILE [FILE...]   # restore from local files
#   ./scripts/data-restore.sh --force                  # skip confirmation prompts
#   ./scripts/data-restore.sh --container NAME         # custom container name
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
REPO="PvtTwinkle/Chessstack"
CONTAINER="chessstack-postgres"
DB_USER="chessstack"
DB_NAME="chessstack"
FORCE=false
LOCAL_MODE=false
CHESSMONT=true
PUZZLES=true
LOCAL_FILES=()

# ── Parse arguments ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --chessmont-only)
      PUZZLES=false
      shift
      ;;
    --puzzles-only)
      CHESSMONT=false
      shift
      ;;
    --local)
      LOCAL_MODE=true
      shift
      while [[ $# -gt 0 && ! "$1" =~ ^-- ]]; do
        LOCAL_FILES+=("$1")
        shift
      done
      if [[ ${#LOCAL_FILES[@]} -eq 0 ]]; then
        echo "Error: --local requires at least one file path" >&2
        exit 1
      fi
      ;;
    --force)
      FORCE=true
      shift
      ;;
    --container)
      CONTAINER="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --chessmont-only   Only restore masters database"
      echo "  --puzzles-only     Only restore puzzle database"
      echo "  --local FILE...    Restore from local .sql.gz files instead of downloading"
      echo "  --force            Skip confirmation prompts"
      echo "  --container NAME   PostgreSQL container name (default: chessstack-postgres)"
      echo "  --help             Show this help message"
      exit 0
      ;;
    *)
      echo "Unknown option: $1 (use --help for usage)" >&2
      exit 1
      ;;
  esac
done

# ── Helper functions ─────────────────────────────────────────────────────────

run_sql() {
  docker exec -i "${CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -tAc "$1"
}

check_container() {
  if ! docker inspect --format='{{.State.Running}}' "${CONTAINER}" 2>/dev/null | grep -q true; then
    echo "Error: Container '${CONTAINER}' is not running." >&2
    echo "Start the app first: docker compose up -d" >&2
    exit 1
  fi
}

# Returns row count for a table
row_count() {
  run_sql "SELECT count(*) FROM $1;" 2>/dev/null || echo "0"
}

# Confirm with user (skipped with --force)
confirm() {
  if [[ "${FORCE}" == true ]]; then
    return 0
  fi
  local msg="$1"
  echo ""
  read -rp "${msg} [y/N] " answer
  case "${answer}" in
    [yY]|[yY][eE][sS]) return 0 ;;
    *) return 1 ;;
  esac
}

# Restore a single .sql.gz file into a table
restore_table() {
  local table="$1"
  local file="$2"

  if [[ ! -f "${file}" ]]; then
    echo "Error: File not found: ${file}" >&2
    return 1
  fi

  local existing
  existing=$(row_count "${table}")

  if [[ "${existing}" -gt 0 ]]; then
    echo "  Table '${table}' already has ${existing} rows."
    if ! confirm "  Replace existing data?"; then
      echo "  Skipped ${table}."
      return 0
    fi
    echo "  Truncating ${table}..."
    run_sql "TRUNCATE ${table};"
  fi

  echo "  Restoring ${table} from ${file}..."
  gunzip -c "${file}" | docker exec -i "${CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -q

  local new_count
  new_count=$(row_count "${table}")
  echo "  Done: ${table} now has ${new_count} rows."
}

# Detect table from filename
detect_table() {
  local file="$1"
  local basename
  basename=$(basename "${file}")
  case "${basename}" in
    *chessmont*) echo "chessmont_moves" ;;
    *puzzle*)    echo "puzzle" ;;
    *)
      echo "Error: Cannot determine table for '${basename}'." >&2
      echo "  File name must contain 'chessmont' or 'puzzle'." >&2
      return 1
      ;;
  esac
}

# ── Fetch release assets from GitHub ─────────────────────────────────────────

fetch_release_urls() {
  local api_url="https://api.github.com/repos/${REPO}/releases"
  local response

  echo "Fetching latest data release from GitHub..."
  response=$(curl -sL "${api_url}?per_page=20") || {
    echo "Error: Failed to reach GitHub API." >&2
    echo "  Download manually from: https://github.com/${REPO}/releases" >&2
    exit 1
  }

  # Find the latest release tagged data-v*
  # Try jq first, fall back to grep
  if command -v jq &>/dev/null; then
    RELEASE_TAG=$(echo "${response}" | jq -r '[.[] | select(.tag_name | startswith("data-v"))][0].tag_name // empty')
    if [[ -z "${RELEASE_TAG}" ]]; then
      echo "Error: No data-v* release found at https://github.com/${REPO}/releases" >&2
      exit 1
    fi
    CHESSMONT_URL=$(echo "${response}" | jq -r "[.[] | select(.tag_name==\"${RELEASE_TAG}\")][0].assets[] | select(.name | contains(\"chessmont\")) | .browser_download_url // empty")
    PUZZLES_URL=$(echo "${response}" | jq -r "[.[] | select(.tag_name==\"${RELEASE_TAG}\")][0].assets[] | select(.name | contains(\"puzzle\")) | .browser_download_url // empty")
  else
    # Fallback: grep for download URLs from the first data-v* release block
    RELEASE_TAG=$(echo "${response}" | grep -oP '"tag_name"\s*:\s*"data-v[^"]*"' | head -1 | grep -oP 'data-v[^"]*')
    if [[ -z "${RELEASE_TAG}" ]]; then
      echo "Error: No data-v* release found at https://github.com/${REPO}/releases" >&2
      echo "  (Install jq for more reliable parsing: sudo apt install jq)" >&2
      exit 1
    fi
    CHESSMONT_URL=$(echo "${response}" | grep -oP '"browser_download_url"\s*:\s*"[^"]*chessmont[^"]*"' | head -1 | grep -oP 'https://[^"]*')
    PUZZLES_URL=$(echo "${response}" | grep -oP '"browser_download_url"\s*:\s*"[^"]*puzzle[^"]*"' | head -1 | grep -oP 'https://[^"]*')
  fi

  echo "Found release: ${RELEASE_TAG}"
}

download_file() {
  local url="$1"
  local dest="$2"

  if [[ -z "${url}" ]]; then
    echo "  Warning: No download URL found for $(basename "${dest}"). Skipping." >&2
    return 1
  fi

  echo "  Downloading $(basename "${dest}")..."
  curl -L --progress-bar --retry 3 -o "${dest}" "${url}" || {
    echo "  Error: Download failed. Try again or download manually:" >&2
    echo "    ${url}" >&2
    return 1
  }
}

# ── Main ─────────────────────────────────────────────────────────────────────

echo "=== Chessstack Data Restore ==="
echo ""

check_container

if [[ "${LOCAL_MODE}" == true ]]; then
  # ── Local file mode ──────────────────────────────────────────────────────
  for file in "${LOCAL_FILES[@]}"; do
    table=$(detect_table "${file}") || exit 1
    restore_table "${table}" "${file}"
    echo ""
  done
else
  # ── Download mode ────────────────────────────────────────────────────────
  TMPDIR=$(mktemp -d)
  trap 'rm -rf "${TMPDIR}"' EXIT

  fetch_release_urls

  if [[ "${CHESSMONT}" == true ]]; then
    CHESSMONT_FILE="${TMPDIR}/chessmont-moves-dump.sql.gz"
    if download_file "${CHESSMONT_URL:-}" "${CHESSMONT_FILE}"; then
      restore_table "chessmont_moves" "${CHESSMONT_FILE}"
    fi
    echo ""
  fi

  if [[ "${PUZZLES}" == true ]]; then
    PUZZLES_FILE="${TMPDIR}/puzzles-dump.sql.gz"
    if download_file "${PUZZLES_URL:-}" "${PUZZLES_FILE}"; then
      restore_table "puzzle" "${PUZZLES_FILE}"
    fi
    echo ""
  fi
fi

echo "=== Restore Complete ==="
