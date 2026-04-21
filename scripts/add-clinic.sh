#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
KESTRA_URL="${KESTRA_URL:-http://localhost:8080}"

if [ $# -lt 1 ]; then
    echo "Usage: $0 <clinic-id> [config-file]"
    echo ""
    echo "  clinic-id:   Short identifier (e.g., 'clinic-a')"
    echo "  config-file: Path to namespace config YAML"
    echo "               Default: kestra/namespace-configs/<clinic-id>.yml"
    echo ""
    echo "Example:"
    echo "  $0 clinic-a"
    echo "  $0 clinic-a ./my-custom-config.yml"
    exit 1
fi

CLINIC_ID="$1"
NAMESPACE="dental.${CLINIC_ID}"
CONFIG_FILE="${2:-$PROJECT_ROOT/kestra/namespace-configs/${CLINIC_ID}.yml}"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "ERROR: Config file not found: $CONFIG_FILE"
    echo "Create one based on kestra/namespace-configs/clinic-a.yml"
    exit 1
fi

echo "=== Onboarding clinic: $CLINIC_ID ==="
echo "  Namespace: $NAMESPACE"
echo "  Config:    $CONFIG_FILE"
echo ""

# Set namespace KV variables from the config file
echo "Setting namespace KV variables..."
in_variables=false
while IFS= read -r line; do
    # Track when we enter/exit the variables block
    if echo "$line" | grep -q "^variables:"; then
        in_variables=true
        continue
    fi
    # Exit variables block on a non-indented line
    if $in_variables && echo "$line" | grep -qE "^[^ #]"; then
        in_variables=false
        continue
    fi
    # Skip non-variable lines
    $in_variables || continue
    # Skip comments and blank lines
    echo "$line" | grep -qE "^\s*#" && continue
    echo "$line" | grep -qE "^\s*$" && continue

    # Parse key: value
    key=$(echo "$line" | sed 's/^\s*//' | cut -d: -f1 | tr -d ' ')
    value=$(echo "$line" | sed 's/^[^:]*:\s*//' | sed 's/^"//' | sed 's/"$//' | tr -d "'")

    if [ -n "$key" ] && [ -n "$value" ]; then
        printf "  %-30s " "$key"
        status=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
            "${KESTRA_URL}/api/v1/namespaces/${NAMESPACE}/kv/${key}" \
            -H "Content-Type: application/json" \
            -d "\"${value}\"")
        if [ "$status" -ge 200 ] && [ "$status" -lt 300 ]; then
            echo "ok"
        else
            echo "WARNING (HTTP $status)"
        fi
    fi
done < "$CONFIG_FILE"

# Deploy flows into the clinic's namespace
echo ""
echo "Deploying flows to namespace $NAMESPACE..."
for flow_file in "$PROJECT_ROOT"/kestra/flows/dental/*.yml; do
    flow_name=$(basename "$flow_file" .yml)
    printf "  %-30s " "$flow_name"
    # Override the namespace in the flow YAML
    status=$(sed "s/^namespace: dental$/namespace: ${NAMESPACE}/" "$flow_file" | \
        curl -s -o /dev/null -w "%{http_code}" -X POST "${KESTRA_URL}/api/v1/flows" \
            -H "Content-Type: application/x-yaml" \
            --data-binary @-)
    if [ "$status" -ge 200 ] && [ "$status" -lt 300 ]; then
        echo "ok"
    else
        echo "WARNING (HTTP $status)"
    fi
done

echo ""
echo "=== Clinic $CLINIC_ID onboarded ==="
echo ""
echo "Remaining manual steps:"
echo "  1. Set secrets via Kestra UI or API:"
echo "     curl -X PUT ${KESTRA_URL}/api/v1/namespaces/${NAMESPACE}/secrets/OPENDENTAL_DB_PASSWORD \\"
echo "       -H 'Content-Type: application/json' -d '\"your-password\"'"
echo "     (repeat for TWILIO_AUTH_TOKEN and SMTP_PASSWORD)"
echo ""
echo "  2. Run the dedup table migration against the clinic's MySQL:"
echo "     mysql -h <host> -u <user> -p <opendental_db> < scripts/sql/V1__dental_automation_log.sql"
echo ""
echo "  3. Verify flows in Kestra UI: ${KESTRA_URL}/ui/flows?namespace=${NAMESPACE}"
