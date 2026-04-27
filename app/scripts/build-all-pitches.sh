#!/usr/bin/env bash
#
# Build every per-module pitch video into demo-output/per-module/.
# Each module overwrites cleanly — no timestamp clutter.
#
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MODULES=(automation ai-notes crm content office invoicing hr inventory calls text-support payroll opendental ask-ai translate)

for m in "${MODULES[@]}"; do
  bash "$SCRIPT_DIR/build-module-pitch.sh" "$m"
done

echo ""
echo "All pitches built:"
ls -lh "$(cd "$SCRIPT_DIR/.." && pwd)/demo-output/per-module/" 2>/dev/null | grep '\.mp4$' || true
