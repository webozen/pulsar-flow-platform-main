#!/usr/bin/env bash
#
# Build the product demo video.
#
# Steps:
#   1. Run e2e/demo/golden-path.spec.ts under playwright.demo.config.ts
#      (records WebM at 1080p, 250ms slowMo, single worker).
#   2. Convert WebM → MP4 via ffmpeg.
#   3. If a voice-over file is present at scripts/voiceover.mp3, mux it
#      onto the MP4. Otherwise leave the MP4 silent.
#
# Required env:
#   TEST_TENANT_PASSCODE   the current tenant passcode (regen via admin API)
# Optional env (defaults shown):
#   TEST_TENANT_SLUG=acme-dental
#   TEST_TENANT_EMAIL=admin@acme.test
#   PULSAR_ADMIN_PASSCODE=PULS-DEV-0000
#
# Usage:
#   bash scripts/build-demo-video.sh
#
set -euo pipefail

# Resolve paths relative to this script (works from any cwd).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_DIR"

OUTPUT_DIR="$APP_DIR/demo-output"
RAW_DIR="$OUTPUT_DIR/raw"
FINAL_DIR="$OUTPUT_DIR/final"
mkdir -p "$RAW_DIR" "$FINAL_DIR"

# Sanity check: ffmpeg present.
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found on PATH. Install it: brew install ffmpeg"
  exit 1
fi

# Sanity check: required env.
: "${TEST_TENANT_PASSCODE:?TEST_TENANT_PASSCODE must be set — regen via POST /api/admin/tenants/{id}/passcode}"
: "${TEST_TENANT_SLUG:=acme-dental}"
: "${TEST_TENANT_EMAIL:=admin@acme.test}"
: "${PULSAR_ADMIN_PASSCODE:=PULS-DEV-0000}"

# Choose which demo spec to record. Default is the 30s hero clip.
# Set DEMO_SPEC=full-tour for the comprehensive 2-3 minute tour.
DEMO_SPEC="${DEMO_SPEC:-golden-path}"
case "$DEMO_SPEC" in
  golden-path) SPEC_FILE="e2e/demo/golden-path.spec.ts" ;;
  full-tour)   SPEC_FILE="e2e/demo/full-tour.spec.ts" ;;
  *)
    echo "Unknown DEMO_SPEC=$DEMO_SPEC (expected: golden-path | full-tour)"
    exit 1
    ;;
esac

# Clean prior recording so we always pick up the freshly produced one.
rm -rf "$APP_DIR/test-results/demo"

echo "==> Recording demo: $DEMO_SPEC ($SPEC_FILE)"
TEST_TENANT_SLUG="$TEST_TENANT_SLUG" \
TEST_TENANT_EMAIL="$TEST_TENANT_EMAIL" \
TEST_TENANT_PASSCODE="$TEST_TENANT_PASSCODE" \
PULSAR_ADMIN_PASSCODE="$PULSAR_ADMIN_PASSCODE" \
npx playwright test --config=playwright.demo.config.ts "$SPEC_FILE"

# Find the WebM Playwright produced. The single-worker, single-test
# config means there's exactly one.
WEBM=$(find "$APP_DIR/test-results/demo" -name "*.webm" | head -n 1)
if [ -z "$WEBM" ] || [ ! -f "$WEBM" ]; then
  echo "No video found at test-results/demo/**/*.webm"
  exit 1
fi

STAMP=$(date +%Y%m%d-%H%M%S)
RAW_OUT="$RAW_DIR/$DEMO_SPEC-$STAMP.webm"
MP4_OUT="$FINAL_DIR/$DEMO_SPEC-$STAMP.mp4"
cp "$WEBM" "$RAW_OUT"

echo "==> Converting WebM → MP4 (H.264 + faststart for web/streaming)"
# Encode at a fixed 1920x1080@30fps with consistent SAR/PAR so we can
# concat with Seedance/Sora B-roll without ffmpeg complaining about
# stream parameter mismatches.
ffmpeg -y -loglevel error \
  -i "$RAW_OUT" \
  -vf "scale=1920:1080:flags=lanczos,setsar=1,fps=30" \
  -c:v libx264 -pix_fmt yuv420p -movflags +faststart -crf 18 \
  "$MP4_OUT"

# ── Optional B-roll composition ────────────────────────────────────────
# Drop AI-generated clips (Seedance / Sora / Runway) into demo-output/broll/:
#   intro.mp4    — prepended (5–8s opener)
#   midcut.mp4   — inserted between Act 2 and Act 3 of the tour
#   closer.mp4   — appended (3–8s outro)
# Each clip should be 1080p H.264 — the encoder normalizes silently if not.
# Missing files are skipped gracefully.

BROLL_DIR="$OUTPUT_DIR/broll"
INTRO="$BROLL_DIR/intro.mp4"
CLOSER="$BROLL_DIR/closer.mp4"
COMPOSED="$FINAL_DIR/$DEMO_SPEC-$STAMP-composed.mp4"

normalize() {
  # Re-encode any input to match the core MP4's stream params so concat
  # is loss-free at the container level. Silent audio track is added
  # because concat needs all streams present in every segment.
  local in="$1" out="$2"
  ffmpeg -y -loglevel error \
    -i "$in" -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000 \
    -shortest \
    -vf "scale=1920:1080:flags=lanczos,setsar=1,fps=30" \
    -c:v libx264 -pix_fmt yuv420p -crf 18 \
    -c:a aac -ar 48000 -ac 2 \
    "$out"
}

if [ -f "$INTRO" ] || [ -f "$CLOSER" ]; then
  echo "==> Composing with B-roll"
  TMP_DIR=$(mktemp -d)
  trap "rm -rf $TMP_DIR" EXIT

  # The core MP4 has no audio yet, so add a silent track to match the
  # B-roll segments' stream layout.
  CORE_NORM="$TMP_DIR/core.mp4"
  ffmpeg -y -loglevel error \
    -i "$MP4_OUT" -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000 \
    -shortest \
    -c:v copy -c:a aac -ar 48000 -ac 2 \
    "$CORE_NORM"

  CONCAT_LIST="$TMP_DIR/list.txt"
  : > "$CONCAT_LIST"

  if [ -f "$INTRO" ]; then
    INTRO_NORM="$TMP_DIR/intro.mp4"
    normalize "$INTRO" "$INTRO_NORM"
    echo "file '$INTRO_NORM'" >> "$CONCAT_LIST"
  fi
  echo "file '$CORE_NORM'" >> "$CONCAT_LIST"
  if [ -f "$CLOSER" ]; then
    CLOSER_NORM="$TMP_DIR/closer.mp4"
    normalize "$CLOSER" "$CLOSER_NORM"
    echo "file '$CLOSER_NORM'" >> "$CONCAT_LIST"
  fi

  ffmpeg -y -loglevel error \
    -f concat -safe 0 -i "$CONCAT_LIST" \
    -c copy \
    "$COMPOSED"
  echo "Composed: $COMPOSED"
  FINAL_VIDEO="$COMPOSED"
else
  FINAL_VIDEO="$MP4_OUT"
fi

# ── Optional voice-over mux ────────────────────────────────────────────
VO="$SCRIPT_DIR/voiceover.mp3"
if [ -f "$VO" ]; then
  WITH_VO="${FINAL_VIDEO%.mp4}-with-vo.mp4"
  echo "==> Muxing voice-over from $VO"
  ffmpeg -y -loglevel error \
    -i "$FINAL_VIDEO" -i "$VO" \
    -map 0:v -map 1:a \
    -c:v copy -c:a aac -shortest \
    "$WITH_VO"
  echo "Done: $WITH_VO"
else
  echo "Done: $FINAL_VIDEO"
  if [ ! -f "$INTRO" ] && [ ! -f "$CLOSER" ]; then
    echo "  (Drop Seedance/Sora B-roll at $BROLL_DIR/intro.mp4 + closer.mp4 to compose.)"
  fi
  echo "  (Drop a voice-over at $VO to mux it onto the final video.)"
fi
