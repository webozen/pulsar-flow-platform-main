import { defineConfig } from "@playwright/test";

/**
 * Playwright config for demo-video recording. Distinct from
 * playwright.config.ts so the bug-hunt suite stays fast and headless
 * while demo recording uses 1080p, slow click pacing, video-on, and a
 * single worker.
 *
 * Run via: npm run demo:record  (or scripts/build-demo-video.sh)
 */
export default defineConfig({
  testDir: "./e2e/demo",
  testMatch: ["**/*.spec.ts"],
  timeout: 180_000,
  retries: 0,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3002",
    // Recording works in headless Chromium (same renderer as headed).
    // Flip to false locally if you want to watch the demo as it records.
    headless: true,
    viewport: { width: 1920, height: 1080 },
    video: "on",
    screenshot: "off",
    trace: "off",
    // 250ms between every Playwright action — paces clicks/navs at
    // human speed without touching every individual `waitForTimeout`.
    launchOptions: { slowMo: 250 },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  outputDir: "test-results/demo",
});
