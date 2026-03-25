#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Celebrity Export — dump star_players + celebrity_moves for distribution
#
# After running the import, use this script to create a compressed pg_dump
# that other users can restore without processing PGN files themselves.
#
# Usage:
#   ./scripts/celebrity-export.sh                    # default output
#   ./scripts/celebrity-export.sh my-dump.sql.gz     # custom filename
#
# The dump includes only the data (--data-only), not the table definitions,
# since the tables are created by the Drizzle migration on app startup.
#
# To restore on another instance (after the app has started and created tables):
#   gunzip -c celebrity-moves-dump.sql.gz | \
#     docker exec -i chessstack-postgres psql -U chessstack chessstack
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

OUTFILE="${1:-celebrity-moves-dump.sql.gz}"
CONTAINER="chessstack-postgres"
DB_USER="chessstack"
DB_NAME="chessstack"

echo "[export] Dumping star_players + celebrity_moves from ${CONTAINER}..."
docker exec "${CONTAINER}" pg_dump -U "${DB_USER}" \
  --table=star_players --table=celebrity_moves --data-only --no-owner "${DB_NAME}" \
  | gzip > "${OUTFILE}"

SIZE=$(du -h "${OUTFILE}" | cut -f1)
echo "[export] Done: ${OUTFILE} (${SIZE})"
echo ""
echo "To restore on another instance:"
echo "  gunzip -c ${OUTFILE} | docker exec -i ${CONTAINER} psql -U ${DB_USER} ${DB_NAME}"
