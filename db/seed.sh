#!/usr/bin/env bash
# Restore seed data after schema init.
# Runs as 02-seed.sh in /docker-entrypoint-initdb.d/ (after 01-schema.sql).
set -e

DUMP_FILE="/docker-entrypoint-initdb.d/seed.dump"
if [ -f "$DUMP_FILE" ]; then
    echo "Restoring seed data..."
    if pg_restore --no-owner --no-privileges --data-only --disable-triggers \
        --dbname="$POSTGRES_DB" "$DUMP_FILE" 2>&1; then
        echo "Seed data restored successfully."
    else
        echo "WARNING: pg_restore exited with errors (some data may have been restored)."
        echo "This is often harmless (e.g., duplicate key warnings on re-init)."
    fi
else
    echo "No seed dump found, starting with empty database."
fi
