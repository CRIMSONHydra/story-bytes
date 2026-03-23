#!/usr/bin/env bash
set -euo pipefail

mkdir -p /app/dataset /app/processed

# Start supervisor (manages backend + nginx)
/usr/bin/supervisord -c /etc/supervisor/conf.d/supervisor.conf &
SUPERVISOR_PID=$!

# Wait for supervisor socket
until [ -S /var/run/supervisor.sock ]; do sleep 0.5; done

echo "Waiting for backend to be ready..."
TRIES=0
MAX_TRIES=30
while [ $TRIES -lt $MAX_TRIES ]; do
    if wget -qO- http://127.0.0.1:5001/health >/dev/null 2>&1; then
        echo "Backend is ready."
        break
    fi
    TRIES=$((TRIES + 1))
    sleep 1
done

if [ $TRIES -eq $MAX_TRIES ]; then
    echo "WARNING: Backend not fully ready. Starting nginx anyway."
fi

# Start nginx via supervisor
supervisorctl start nginx
echo "Nginx started on port 80."

wait $SUPERVISOR_PID
