#!/usr/bin/env bash
# Restore seed data after schema init.
# Runs as 02-seed.sh in /docker-entrypoint-initdb.d/ (after 01-schema.sql).
set -e

DUMP_FILE="/docker-entrypoint-initdb.d/seed.dump"
if [ -f "$DUMP_FILE" ]; then
    echo "Restoring seed data..."
    pg_restore --no-owner --no-privileges --data-only --disable-triggers \
        --dbname="$POSTGRES_DB" "$DUMP_FILE" || true
    echo "Seed data restored."
else
    echo "No seed dump found, starting with empty database."
fi
