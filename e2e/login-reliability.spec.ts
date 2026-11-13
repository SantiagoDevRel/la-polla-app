import { test, expect, type BrowserContext } from "@playwright/test";

// Ingreso solo por WhatsApp (2026-11-13). El servidor de prueba necesita la
// configuración de ingreso por WhatsApp (en CI: valores ficticios del paso de
// recuperación). wa.me se intercepta: no se abre WhatsApp ni se envía nada.
test.use({ serviceWorkers: "block" });
test.beforeEach(async ({ page, context }) => {
  await page.addInitScript(() => {
    (window as unknown as { __DISABLE_AGENTATION__: boolean }).__DISABLE_AGENTATION__ = true;
    localStorage.setItem("lp_welcome_seen_v1", "1");
    sessionStorage.setItem("lp_splash_seen_v2", "1");
  });
  await stubWhatsApp(context);
});

async function stubWhatsApp(context: BrowserContext) {
  await context.route(/^https:\/\/(wa\.me|api\.whatsapp\.com)\//, route => route.fulfill({ contentType: "text/html", body: "<title>WhatsApp</title>" }));
}

test("first WhatsApp tap plays the mandatory three-step tutorial, then opens the chat", async ({ page, context }) => {
  await page.goto("/login");
  await expect(page.locator('input[type="tel"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: /SMS|contraseña|Telegram/i })).toHaveCount(0);
  const start = page.getByRole("link", { name: "Entrar con WhatsApp" });
  await expect(start).toHaveAttribute("href", /^https:\/\/wa\.me\/\d+\?text=/);

  let popups = 0;
  context.on("page", () => { popups++; });
  await start.click();
  await expect(page.getByTestId("login-whatsapp")).toHaveAttribute("data-view", "tutorial");
  expect(popups).toBe(0);
  const open = page.getByRole("link", { name: "Mira los 3 pasos…" });
  await expect(open).toHaveAttribute("aria-disabled", "true");
  await open.click({ force: true });
  expect(popups).toBe(0);
  await expect(page.locator("[data-tutorial-whatsapp]")).toHaveAttribute("data-paso", "2");
  await expect(page.locator("[data-tutorial-whatsapp]")).toHaveAttribute("data-paso", "3");

  const ready = page.getByRole("link", { name: "Abrir WhatsApp" });
  await expect(ready).toBeVisible({ timeout: 15_000 });
  const popup = context.waitForEvent("page");
  await ready.click();
  expect((await popup).url()).toMatch(/^https:\/\/(wa\.me|api\.whatsapp\.com)\//);
  await expect(page.getByTestId("login-whatsapp")).toHaveAttribute("data-view", "sent");
  await expect(page.getByRole("heading", { name: "TERMINA EN WHATSAPP" })).toBeFocused();

  // The device remembers the tutorial and the pending step survives a reload.
  await page.reload();
  await expect(page.getByTestId("login-whatsapp")).toHaveAttribute("data-view", "sent");
  await page.getByRole("button", { name: "Volver" }).click();
  const again = context.waitForEvent("page");
  await page.getByRole("link", { name: "Entrar con WhatsApp" }).click();
  await again;
  await expect(page.getByTestId("login-whatsapp")).toHaveAttribute("data-view", "sent");
});

test("returning from WhatsApp with an open session continues to the pool", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lp_wa_tutorial_visto", "1");
    sessionStorage.setItem("lp_wa_login_opened", String(Date.now()));
  });
  let signedIn = false;
  await page.route("**/api/users/me", route => signedIn
    ? route.fulfill({ json: { profile: {
      id: "local-fixture", profile_revision: 1, display_name: "Ana", avatar_url: "millos",
      whatsapp_number: "573001234567", is_admin: false,
      default_payout_method: null, default_payout_account: null, default_payout_account_name: null, default_payout_account_type: null,
    } } })
    : route.fulfill({ status: 401, json: { error: "No autenticado" } }));
  await page.route("**/polla/test/pagar", route => route.fulfill({ contentType: "text/plain", body: "Pool payment" }));
  await page.goto("/login?returnTo=%2Fpolla%2Ftest%2Fpagar");
  await expect(page.getByTestId("login-whatsapp")).toHaveAttribute("data-view", "sent");
  expect((await page.context().cookies()).find(c => c.name === "lp_return_to")?.value).toBe(encodeURIComponent("/polla/test/pagar"));

  const profileChecks = page.waitForResponse("**/api/users/me");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect((await profileChecks).status()).toBe(401);
  await expect(page.getByTestId("login-whatsapp")).toHaveAttribute("data-view", "sent");
  signedIn = true;
  await expect.poll(async () => {
    await page.evaluate(() => window.dispatchEvent(new Event("focus"))).catch(() => undefined);
    return page.url();
  }).toMatch(/\/polla\/test\/pagar$/);
});

test("the tutorial can be replayed and storage loss never blocks the chat", async ({ page, context }) => {
  await page.addInitScript(() => sessionStorage.setItem("lp_wa_login_opened", "not-a-time"));
  await page.goto("/login");
  await expect(page.getByTestId("login-whatsapp")).toHaveAttribute("data-view", "start");
  await page.getByRole("link", { name: "Entrar con WhatsApp" }).click();
  await expect(page.getByRole("link", { name: "Abrir WhatsApp" })).toBeVisible({ timeout: 15_000 });
  const popup = context.waitForEvent("page");
  await page.getByRole("link", { name: "Abrir WhatsApp" }).click();
  await popup;
  await page.getByRole("button", { name: "Ver cómo se hace" }).click();
  await expect(page.getByTestId("login-whatsapp")).toHaveAttribute("data-view", "tutorial");
  await expect(page.getByRole("link", { name: "Mira los 3 pasos…" })).toHaveAttribute("aria-disabled", "true");
});
