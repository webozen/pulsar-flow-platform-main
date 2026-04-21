#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
KESTRA_URL="${KESTRA_URL:-http://localhost:8080}"

echo "=== Flowcore Dental Automation Platform Setup ==="
echo ""

# Check prerequisites
for cmd in docker curl; do
    command -v "$cmd" >/dev/null 2>&1 || { echo "ERROR: $cmd is required but not installed."; exit 1; }
done

# Create .env from example if not exists
if [ ! -f "$PROJECT_ROOT/.env" ]; then
    cp "$PROJECT_ROOT/.env.example" "$PROJECT_ROOT/.env"
    echo "Created .env from .env.example"
fi

# Start services
echo "Starting Docker Compose stack..."
cd "$PROJECT_ROOT"
docker compose up -d

# Wait for Kestra to be healthy
echo "Waiting for Kestra to start..."
for i in $(seq 1 60); do
    if curl -sf "${KESTRA_URL}/api/v1/flows" >/dev/null 2>&1; then
        echo "Kestra is ready!"
        break
    fi
    if [ "$i" -eq 60 ]; then
        echo "ERROR: Kestra did not start within 120 seconds."
        docker compose logs kestra
        exit 1
    fi
    sleep 2
done

# Load base flows into the 'dental' namespace
echo ""
echo "Loading workflow definitions..."
for flow_file in "$PROJECT_ROOT"/kestra/flows/dental/*.yml; do
    name="$(basename "$flow_file")"
    printf "  Loading %s... " "$name"
    status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${KESTRA_URL}/api/v1/flows" \
        -H "Content-Type: application/x-yaml" \
        --data-binary @"$flow_file")
    if [ "$status" -ge 200 ] && [ "$status" -lt 300 ]; then
        echo "ok"
    else
        echo "WARNING (HTTP $status)"
    fi
done

echo ""
echo "=== Setup complete ==="
echo ""
echo "  Kestra UI:  ${KESTRA_URL}"
echo ""
echo "Next steps:"
echo "  1. Run ./scripts/add-clinic.sh <clinic-id> to onboard a clinic"
echo "  2. Run scripts/sql/V1__dental_automation_log.sql against each clinic's MySQL"
