#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Chessmont Export — dump chessmont_moves for distribution
#
# After running the import, use this script to create a compressed pg_dump
# that other users can restore without processing the PGN themselves.
#
# Usage:
#   ./scripts/chessmont-export.sh                    # default output
#   ./scripts/chessmont-export.sh my-dump.sql.gz     # custom filename
#
# The dump includes only the data (--data-only), not the table definition,
# since the table is created by the Drizzle migration on app startup.
#
# To restore on another instance (after the app has started and created tables):
#   gunzip -c chessmont-moves-dump.sql.gz | \
#     docker exec -i chessstack-postgres psql -U chessstack chessstack
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

OUTFILE="${1:-chessmont-moves-dump.sql.gz}"
CONTAINER="chessstack-postgres"
DB_USER="chessstack"
DB_NAME="chessstack"

echo "[export] Dumping chessmont_moves from ${CONTAINER}..."
docker exec "${CONTAINER}" pg_dump -U "${DB_USER}" \
  --table=chessmont_moves --data-only --no-owner "${DB_NAME}" \
  | gzip > "${OUTFILE}"

SIZE=$(du -h "${OUTFILE}" | cut -f1)
echo "[export] Done: ${OUTFILE} (${SIZE})"
echo ""
echo "To restore on another instance:"
echo "  gunzip -c ${OUTFILE} | docker exec -i ${CONTAINER} psql -U ${DB_USER} ${DB_NAME}"
