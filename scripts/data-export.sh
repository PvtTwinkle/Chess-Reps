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

CONTAINER="chess-reps-postgres"
DB_USER="chess_reps"
DB_NAME="chess_reps"
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

echo "=== Chess Reps Data Export ==="
echo ""

# Export chessmont_moves
CHESSMONT_FILE="${OUTPUT_DIR}/chessmont-moves-dump.sql.gz"
echo "[1/2] Dumping chessmont_moves..."
docker exec "${CONTAINER}" pg_dump -U "${DB_USER}" \
  --table=chessmont_moves --data-only --no-owner "${DB_NAME}" \
  | gzip > "${CHESSMONT_FILE}"
CHESSMONT_SIZE=$(du -h "${CHESSMONT_FILE}" | cut -f1)
echo "      Done: ${CHESSMONT_FILE} (${CHESSMONT_SIZE})"

# Export puzzle
PUZZLE_FILE="${OUTPUT_DIR}/puzzles-dump.sql.gz"
echo "[2/2] Dumping puzzle..."
docker exec "${CONTAINER}" pg_dump -U "${DB_USER}" \
  --table=puzzle --data-only --no-owner "${DB_NAME}" \
  | gzip > "${PUZZLE_FILE}"
PUZZLE_SIZE=$(du -h "${PUZZLE_FILE}" | cut -f1)
echo "      Done: ${PUZZLE_FILE} (${PUZZLE_SIZE})"

echo ""
echo "=== Export Complete ==="
echo ""
echo "  chessmont_moves: ${CHESSMONT_FILE} (${CHESSMONT_SIZE})"
echo "  puzzle:          ${PUZZLE_FILE} (${PUZZLE_SIZE})"
echo ""
echo "Next steps:"
echo "  1. git tag data-vX.Y && git push origin data-vX.Y"
echo "  2. gh release create data-vX.Y ${CHESSMONT_FILE} ${PUZZLE_FILE}"
