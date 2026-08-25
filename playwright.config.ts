// playwright.config.ts — e2e visual + a11y. Usa el Chrome instalado (channel), no descarga browsers.
// Baselines de toHaveScreenshot son por-OS (win32): viven locales, no compartirlas con un CI Linux.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.02 },
  },
  use: {
    baseURL: "http://localhost:3001",
    channel: "chrome",
    colorScheme: "dark",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npx next dev -p 3001",
    url: "http://localhost:3001",
    reuseExistingServer: true,
    // El primer boot de next dev acá tarda >2 min (compilación fría + fonts): timeout generoso.
    timeout: 300_000,
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], channel: "chrome" },
    },
  ],
});
