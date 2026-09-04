// playwright.config.ts — e2e visual + a11y. Usa el Chrome instalado (channel), no descarga browsers.
// Baselines de toHaveScreenshot son por-OS (win32): viven locales, no compartirlas con un CI Linux.
import { defineConfig, devices } from "@playwright/test";

const requestedPort = Number.parseInt(process.env.PLAYWRIGHT_PORT ?? "3101", 10);
const port = Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : 3101;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  // Next's webpack dev server can invalidate an in-flight page while another
  // worker compiles a new route. Serial execution keeps axe and screenshots
  // attached to one stable document on cold Windows boots.
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: "list",
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.02 },
  },
  use: {
    baseURL,
    channel: "chrome",
    colorScheme: "dark",
    trace: "on-first-retry",
  },
  webServer: {
    // Keep the browser gate on the same webpack path used by `npm run dev`
    // and production builds. Serwist's Next integration is webpack-based.
    command: `npm run dev -- --port ${port}`,
    // A service unrelated to La Polla once occupied the old port and still
    // answered 200 at `/`, so Playwright silently tested the wrong app. A
    // real app route makes the readiness check specific to this project.
    url: `${baseURL}/login`,
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
