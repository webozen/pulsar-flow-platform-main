/**
 * Records HTML animations (e.g. Claude Design exports) as MP4-ready
 * WebM video. Lives next to the product demo specs so it shares the
 * playwright.demo.config.ts (1080p, video on, single worker).
 *
 * Inputs:
 *   demo-output/animated-html/intro.html   (~11s)
 *   demo-output/animated-html/closer.html  (~5s)
 * Outputs:
 *   test-results/demo/<scene-name>/video.webm  (one per scene)
 *
 * Usage:
 *   npm run demo:record:html
 *
 * Then run a tiny ffmpeg pass to copy each WebM into demo-output/broll/
 * as intro.mp4 / closer.mp4 (the slot the build script auto-detects).
 */
import { test, type Page } from "@playwright/test"
import { existsSync } from "node:fs"
import path from "node:path"

const HTML_DIR = path.resolve(__dirname, "../../demo-output/animated-html")

async function record(page: Page, fileBaseName: string, durationMs: number) {
  const file = path.join(HTML_DIR, `${fileBaseName}.html`)
  if (!existsSync(file)) {
    test.skip(true, `${fileBaseName}.html not found at ${file} — export from Claude Design first`)
    return
  }
  // file:// URL so Playwright loads the standalone HTML directly.
  await page.goto(`file://${file}`)
  // Hold for the full animation duration. Playwright's video recording
  // captures the entire viewport for the lifetime of the page object,
  // so a wait here = a recording of that wait.
  await page.waitForTimeout(durationMs)
}

test("record intro.html", async ({ page }) => {
  test.setTimeout(60_000)
  // 11s scene + 1s pad so the final frame holds in the recording.
  await record(page, "intro", 12_000)
})

test("record closer.html", async ({ page }) => {
  test.setTimeout(60_000)
  // 5s scene + 1s pad.
  await record(page, "closer", 6_000)
})
