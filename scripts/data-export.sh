#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Data Export — dump all optional datasets for distribution
#
# Produces compressed pg_dump files for upload to a GitHub Release.
# Users restore these with scripts/data-restore.sh.
#
# Usage:
#   ./scripts/data-export.sh                        # output to current dir
#   ./scripts/data-export.sh --output-dir ./dumps   # custom output directory
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

CONTAINER="chessstack-postgres"
DB_USER="chessstack"
DB_NAME="chessstack"
OUTPUT_DIR="."

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: $0 [--output-dir DIR]" >&2
      exit 1
      ;;
  esac
done

mkdir -p "${OUTPUT_DIR}"

echo "=== Chessstack Data Export ==="
echo ""

# Export chessmont_moves
CHESSMONT_FILE="${OUTPUT_DIR}/chessmont-moves-dump.sql.gz"
echo "[1/4] Dumping chessmont_moves..."
docker exec "${CONTAINER}" pg_dump -U "${DB_USER}" \
  --table=chessmont_moves --data-only --no-owner "${DB_NAME}" \
  | gzip > "${CHESSMONT_FILE}"
CHESSMONT_SIZE=$(du -h "${CHESSMONT_FILE}" | cut -f1)
echo "      Done: ${CHESSMONT_FILE} (${CHESSMONT_SIZE})"

# Export puzzle
PUZZLE_FILE="${OUTPUT_DIR}/puzzles-dump.sql.gz"
echo "[2/4] Dumping puzzle..."
docker exec "${CONTAINER}" pg_dump -U "${DB_USER}" \
  --table=puzzle --data-only --no-owner "${DB_NAME}" \
  | gzip > "${PUZZLE_FILE}"
PUZZLE_SIZE=$(du -h "${PUZZLE_FILE}" | cut -f1)
echo "      Done: ${PUZZLE_FILE} (${PUZZLE_SIZE})"

# Export star_players + celebrity_moves
CELEBRITY_FILE="${OUTPUT_DIR}/celebrity-moves-dump.sql.gz"
echo "[3/4] Dumping star_players + celebrity_moves..."
docker exec "${CONTAINER}" pg_dump -U "${DB_USER}" \
  --table=star_players --table=celebrity_moves --data-only --no-owner "${DB_NAME}" \
  | gzip > "${CELEBRITY_FILE}"
CELEBRITY_SIZE=$(du -h "${CELEBRITY_FILE}" | cut -f1)
echo "      Done: ${CELEBRITY_FILE} (${CELEBRITY_SIZE})"

# Export lichess_moves
LICHESS_FILE="${OUTPUT_DIR}/lichess-moves-dump.sql.gz"
echo "[4/4] Dumping lichess_moves..."
docker exec "${CONTAINER}" pg_dump -U "${DB_USER}" \
  --table=lichess_moves --data-only --no-owner "${DB_NAME}" \
  | gzip > "${LICHESS_FILE}"
LICHESS_SIZE=$(du -h "${LICHESS_FILE}" | cut -f1)
echo "      Done: ${LICHESS_FILE} (${LICHESS_SIZE})"

echo ""
echo "=== Export Complete ==="
echo ""
echo "  chessmont_moves:  ${CHESSMONT_FILE} (${CHESSMONT_SIZE})"
echo "  puzzle:           ${PUZZLE_FILE} (${PUZZLE_SIZE})"
echo "  celebrity_moves:  ${CELEBRITY_FILE} (${CELEBRITY_SIZE})"
echo "  lichess_moves:    ${LICHESS_FILE} (${LICHESS_SIZE})"
echo ""
echo "Next steps:"
echo "  1. git tag data-vX.Y && git push origin data-vX.Y"
echo "  2. gh release create data-vX.Y ${CHESSMONT_FILE} ${PUZZLE_FILE} ${CELEBRITY_FILE} ${LICHESS_FILE}"
