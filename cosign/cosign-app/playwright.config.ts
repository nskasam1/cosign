// Phase 2 evidence harness. Specs run against the real production server
// (`npm run prod` on :8787) so they exercise SSR, not `vite preview`.
// Start the server first; the config will not silently start a second one
// (only one process may own :8787 — a second looks like it started and dies).

import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.COSIGN_BASE ?? "http://localhost:8787";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "../../evidence/phase2/playwright-results.json" }]],
  use: {
    baseURL: BASE_URL,
    trace: "off",
    screenshot: "off",
  },
  projects: [
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 },
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
    },
  ],
});
