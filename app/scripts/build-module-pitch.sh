#!/usr/bin/env bash
#
# Build a focused per-module pitch video.
#
#   bash scripts/build-module-pitch.sh automation
#   bash scripts/build-module-pitch.sh ai-notes
#   bash scripts/build-module-pitch.sh crm
#   bash scripts/build-module-pitch.sh content
#   bash scripts/build-module-pitch.sh office
#   bash scripts/build-module-pitch.sh invoicing
#   bash scripts/build-module-pitch.sh hr
#   bash scripts/build-module-pitch.sh inventory
#   bash scripts/build-module-pitch.sh calls
#
# Output: app/demo-output/per-module/<module>.mp4 (overwrites each run)
#
# Each module has a hand-tuned scene plan — the most differentiated
# screen for the module gets the longest hold (e.g., approvals queue
# for automation, AI summary for ai-notes, patient timeline for CRM).
#
set -euo pipefail

if [ "${1:-}" = "" ]; then
  echo "Usage: $0 <module-name>"
  echo "Modules: automation | ai-notes | crm | content | office | invoicing | hr | inventory | calls"
  exit 1
fi
MODULE="$1"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_DIR"

STILLS_DIR="$APP_DIR/demo-output/stills"
OUT_DIR="$APP_DIR/demo-output/per-module"
TMP_DIR="$APP_DIR/demo-output/.pitch-tmp-$MODULE"
mkdir -p "$OUT_DIR" "$TMP_DIR"
trap "rm -rf '$TMP_DIR'" EXIT

# Resolve ffmpeg.
if command -v ffmpeg >/dev/null 2>&1; then
  FFMPEG=(ffmpeg)
elif command -v docker >/dev/null 2>&1; then
  FFMPEG=(docker run --rm -v "$APP_DIR":"$APP_DIR" -w "$APP_DIR" jrottenberg/ffmpeg:7-alpine)
else
  echo "ffmpeg not found and Docker not available."; exit 1
fi

# ── Per-module scene plans ────────────────────────────────────────────
# Format: "<filename>:<seconds>" — longest hold goes on the differentiator.
case "$MODULE" in
  automation)
    SCENES=(
      "03-marketplace-home.png:5"
      "41-automation-dashboard-full.png:7"
      "42-workflows-list.png:6"
      "43-builder-blank.png:6"
      "44-builder-name-typed.png:6"
      "45-builder-trigger-section.png:6"
      "46-builder-full.png:6"
      "47-approvals-queue-populated.png:20"
      "50-conversations-list.png:8"
      "51-conversation-thread.png:8"
      "41-automation-dashboard-full.png:12"
    )
    ;;
  ai-notes)
    SCENES=(
      "03-marketplace-home.png:5"
      "30-ai-notes-connect-plaud.png:8"
      "31-ai-notes-feed-populated.png:15"
      "32-ai-notes-summary-expanded.png:20"
      "33-ai-notes-transcript-expanded.png:14"
      "31-ai-notes-feed-populated.png:8"
    )
    ;;
  crm)
    SCENES=(
      "03-marketplace-home.png:5"
      "55-crm-patients.png:25"
      "56-crm-full.png:25"
      "55-crm-patients.png:15"
    )
    ;;
  content)
    SCENES=(
      "03-marketplace-home.png:5"
      "20-content-guides.png:14"
      "21-content-contacts.png:11"
      "22-content-training.png:11"
      "23-content-files.png:11"
      "20-content-guides.png:8"
    )
    ;;
  office)
    SCENES=(
      "03-marketplace-home.png:5"
      "10-office-staff-directory.png:22"
      "11-office-full.png:18"
      "10-office-staff-directory.png:5"
    )
    ;;
  invoicing)
    SCENES=(
      "03-marketplace-home.png:5"
      "57-invoicing-dashboard.png:25"
      "58-invoicing-full.png:25"
      "57-invoicing-dashboard.png:5"
    )
    ;;
  hr)
    SCENES=(
      "03-marketplace-home.png:5"
      "59-hr-directory.png:30"
    )
    ;;
  inventory)
    SCENES=(
      "03-marketplace-home.png:5"
      "60-inventory-stock.png:30"
    )
    ;;
  calls)
    # 2 of 3 sub-routes (skipping co-pilot — its UI needs a live call to
    # populate transcript + suggestions, so a static screenshot only
    # shows an empty waiting-state). Caller Match + Call Intel carry the pitch.
    SCENES=(
      "03-marketplace-home.png:5"
      "35-calls-screen-pop.png:22"
      "36-call-intel-list.png:12"
      "37-call-intel-detail.png:26"
      "35-calls-screen-pop.png:5"
    )
    ;;
  text-support)
    # 2 sub-routes. Skipping the empty-thread inbox state (85) because
    # the populated thread (86) and suggestions panel (87) carry the pitch.
    SCENES=(
      "03-marketplace-home.png:5"
      "86-text-copilot-thread.png:16"
      "87-text-copilot-suggestions.png:22"
      "88-text-intel-list.png:12"
      "89-text-intel-detail.png:15"
    )
    ;;
  payroll)
    SCENES=(
      "03-marketplace-home.png:5"
      "61-payroll-dashboard.png:25"
      "62-payroll-full.png:25"
      "61-payroll-dashboard.png:5"
    )
    ;;
  opendental)
    SCENES=(
      "03-marketplace-home.png:5"
      "63-opendental-sync.png:35"
    )
    ;;
  ask-ai)
    # Voice + text chat with Gemini Live grounding queries on OpenDental.
    # Conversation view shows the dialog; Audit log surfaces the SQL.
    SCENES=(
      "03-marketplace-home.png:5"
      "65-ask-ai-conversation.png:30"
      "66-ask-ai-audit.png:25"
      "65-ask-ai-conversation.png:5"
    )
    ;;
  translate)
    # Real-time bilingual kiosk — patient on one side, staff on the other.
    SCENES=(
      "03-marketplace-home.png:5"
      "68-translate-kiosk.png:25"
      "69-translate-kiosk-full.png:25"
      "68-translate-kiosk.png:5"
    )
    ;;
  *)
    echo "Unknown module: $MODULE"
    echo "Modules: automation | ai-notes | crm | content | office | invoicing | hr | inventory | calls | text-support | payroll | opendental | ask-ai | translate"
    exit 1
    ;;
esac

# Build the concat manifest.
MANIFEST="$TMP_DIR/concat.txt"
: > "$MANIFEST"
total=0
for s in "${SCENES[@]}"; do
  img="${s%%:*}"
  dur="${s##*:}"
  src="$STILLS_DIR/$img"
  if [ ! -f "$src" ]; then
    echo "Missing screenshot: $src"
    echo "Run 'npm run demo:screenshots' first."
    exit 1
  fi
  echo "file '$src'" >> "$MANIFEST"
  echo "duration $dur" >> "$MANIFEST"
  total=$((total + dur))
done
LAST_IMG="${SCENES[${#SCENES[@]}-1]%%:*}"
echo "file '$STILLS_DIR/$LAST_IMG'" >> "$MANIFEST"

OUT="$OUT_DIR/$MODULE.mp4"

echo "==> $MODULE: ${#SCENES[@]} scenes · ${total}s · → $OUT"
"${FFMPEG[@]}" -y -loglevel warning \
  -f concat -safe 0 -i "$MANIFEST" \
  -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1,format=yuv420p,fps=30" \
  -c:v libx264 -crf 18 -movflags +faststart \
  "$OUT"

SIZE=$(stat -f%z "$OUT" 2>/dev/null || stat -c%s "$OUT" 2>/dev/null || echo 0)
if [ "$SIZE" -lt 1000 ]; then
  echo "Encode produced a tiny file ($SIZE bytes) — likely an error."
  exit 1
fi

MB=$(awk "BEGIN { printf \"%.1f\", $SIZE / 1024 / 1024 }")
echo "Done: ${total}s · ${MB} MB"
