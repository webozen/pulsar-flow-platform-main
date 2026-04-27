import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["**/*.spec.ts"],
  // Demo recording / screenshot specs run under playwright.demo.config.ts.
  // Exclude them from the default suite so `npx playwright test` is the
  // bug-hunt suite, not a video shoot.
  testIgnore: ["**/demo/**"],
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: "http://localhost:3002",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
});
