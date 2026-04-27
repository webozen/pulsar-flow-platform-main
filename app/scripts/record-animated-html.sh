#!/usr/bin/env bash
#
# Record HTML animations (Claude Design exports) and copy them into the
# B-roll slots that build-demo-video.sh auto-detects.
#
# Pre-req: drop your exported HTML at:
#   app/demo-output/animated-html/intro.html
#   app/demo-output/animated-html/closer.html
#
# After this script runs, the build pipeline picks them up automatically
# the next time you run `npm run demo:build:full`.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_DIR"

HTML_DIR="$APP_DIR/demo-output/animated-html"
BROLL_DIR="$APP_DIR/demo-output/broll"
mkdir -p "$BROLL_DIR"

if [ ! -f "$HTML_DIR/intro.html" ] && [ ! -f "$HTML_DIR/closer.html" ]; then
  echo "No HTML animations found at $HTML_DIR/{intro,closer}.html"
  echo "Export from Claude Design first, then re-run."
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found. Install: brew install ffmpeg"
  exit 1
fi

rm -rf "$APP_DIR/test-results/demo-html"

echo "==> Recording HTML animations via Playwright"
PLAYWRIGHT_HTML_REPORT_DISABLED=1 \
npx playwright test --config=playwright.demo.config.ts e2e/demo/animated-html-recorder.spec.ts \
  --output="$APP_DIR/test-results/demo-html"

# Find each per-test WebM and convert to MP4 in the broll slot.
for scene in intro closer; do
  WEBM=$(find "$APP_DIR/test-results/demo-html" -path "*${scene}*" -name "video.webm" | head -n 1)
  if [ -z "$WEBM" ] || [ ! -f "$WEBM" ]; then
    echo "  (skipping $scene — no recording found, html likely missing)"
    continue
  fi
  OUT="$BROLL_DIR/$scene.mp4"
  echo "  -> $OUT"
  ffmpeg -y -loglevel error \
    -i "$WEBM" \
    -vf "scale=1920:1080:flags=lanczos,setsar=1,fps=30" \
    -c:v libx264 -pix_fmt yuv420p -movflags +faststart -crf 18 \
    "$OUT"
done

echo "Done. Run 'npm run demo:build:full' to compose with the product walkthrough."
