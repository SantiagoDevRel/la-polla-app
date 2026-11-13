import { test, expect } from "@playwright/test";

test.use({ serviceWorkers: "block" });

// Solo WhatsApp (2026-11-13): el HTML del servidor ya trae el enlace real a
// wa.me, así que el ingreso funciona aunque el JavaScript tarde en llegar. Al
// hidratar, el primer toque pasa por el tutorial obligatorio sin errores.
test("slow JavaScript still shows a working WhatsApp entry and hydrates into the tutorial", async ({ page, context }) => {
  await page.addInitScript(() => {
    (window as unknown as { __DISABLE_AGENTATION__: boolean }).__DISABLE_AGENTATION__ = true;
    localStorage.setItem("lp_welcome_seen_v1", "1");
    sessionStorage.setItem("lp_splash_seen_v2", "1");
  });
  await context.route(/^https:\/\/(wa\.me|api\.whatsapp\.com)\//, route => route.fulfill({ contentType: "text/html", body: "<title>WhatsApp</title>" }));
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  let release!: () => void;
  const chunksReady = new Promise<void>(resolve => { release = resolve; });
  let heldChunks = 0;
  await page.route("**/_next/static/**/*.js", async route => {
    heldChunks++;
    await chunksReady;
    await route.continue();
  });
  try {
    // DOMContentLoaded/load would wait for scripts; inspect actual SSR first.
    await page.goto("/login", { waitUntil: "commit" });
    const start = page.getByRole("link", { name: "Entrar con WhatsApp" });
    await expect(start).toHaveAttribute("href", /^https:\/\/wa\.me\/\d+\?text=/);
    await expect.poll(() => heldChunks).toBeGreaterThan(0);
    await expect(page.locator('input[type="tel"]')).toHaveCount(0);
    release();
    await page.waitForLoadState("load");
    await expect.poll(async () => {
      await start.click({ timeout: 2_000 }).catch(() => undefined);
      return page.getByTestId("login-whatsapp").getAttribute("data-view");
    }).toBe("tutorial");
    expect(errors).toEqual([]);
  } finally { release(); }
});
