import { test, expect } from "@playwright/test";

test.use({ serviceWorkers: "block" });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __DISABLE_AGENTATION__: boolean }).__DISABLE_AGENTATION__ = true;
    localStorage.setItem("lp_welcome_seen_v1", "1");
    sessionStorage.setItem("lp_splash_seen_v2", "1");
  });
  // Only mocked local endpoints may deliver codes; no SMS or email is sent.
  await page.route("**/api/auth/start-otp", route => route.fulfill({ json: { ok: true } }));
});

test("OTP survives reload and repeated submit without losing the entered phone", async ({ page }) => {
  let sends = 0, verifies = 0;
  await page.route("**/api/auth/start-otp", async route => {
    sends++;
    await new Promise(resolve => setTimeout(resolve, 100));
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/auth/verify-otp", async route => {
    verifies++;
    await new Promise(resolve => setTimeout(resolve, 100));
    await route.fulfill({ status: 401, json: { error: "Código inválido o vencido" } });
  });
  await page.goto("/login");
  await page.locator("#phone").fill("+57 300 123 4567");
  await expect(page.locator("#phone")).toHaveValue("3001234567");
  await page.evaluate(() => {
    for (let i = 0; i < 5; i++) document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  const otp = page.getByRole("textbox", { name: "INGRESA TU CÓDIGO" });
  await expect(otp).toBeVisible();
  expect(sends).toBe(1);
  await page.reload();
  await expect(otp).toBeVisible();
  await otp.fill("000000");
  await page.evaluate(() => {
    for (let i = 0; i < 5; i++) document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await expect(page.getByText("Código inválido o vencido", { exact: true })).toBeVisible();
  expect(verifies).toBe(1);
  await page.getByRole("button", { name: "Reenviar código o cambiar número" }).click();
  await expect(page.locator("#phone")).toHaveValue("3001234567");
});

test("offline send remains retryable after reconnecting", async ({ page, context }) => {
  await page.goto("/login");
  await page.locator("#phone").fill("3001234567");
  await context.setOffline(true);
  await page.locator("form button[type=submit]").click();
  await expect(page.locator("form button[type=submit]")).toBeEnabled();
  await expect(page.locator("#phone")).toHaveValue("3001234567");
  await context.setOffline(false);
  await page.locator("form button[type=submit]").click();
  await expect(page.getByRole("textbox", { name: "INGRESA TU CÓDIGO" })).toBeVisible();
});

test("unsupported international paste does not silently send to another country", async ({ page }) => {
  let sends = 0;
  await page.route("**/api/auth/start-otp", route => { sends++; return route.fulfill({ json: { ok: true } }); });
  await page.goto("/login");
  await page.locator("#phone").fill("+44 7700 900123");
  await expect.poll(() => page.locator("#phone").evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false);
  await page.locator("form button[type=submit]").click();
  expect(sends).toBe(0);
  await page.locator("#phone").fill("+57 300 123 4567");
  await expect(page.locator("#phone")).toHaveValue("3001234567");
  await page.locator("form button[type=submit]").click();
  await expect(page.getByRole("textbox", { name: "INGRESA TU CÓDIGO" })).toBeVisible();
  expect(sends).toBe(1);
});

test("a corrupt persisted cooldown cannot block login indefinitely", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("lp_otp_cooldown_until", String(Date.now() + 7 * 24 * 60 * 60_000)));
  await page.goto("/login");
  await page.locator("#phone").fill("3001234567");
  await expect(page.locator("form button[type=submit]")).toBeEnabled();
  await page.locator("form button[type=submit]").click();
  await expect(page.getByRole("textbox", { name: "INGRESA TU CÓDIGO" })).toBeVisible();
});

for (const matchingAccount of [true, false]) {
  test(`lost verification response recovers only the intended account (${matchingAccount})`, async ({ page }) => {
    await page.route("**/api/auth/verify-otp", route => route.fulfill({ contentType: "application/json", body: '{"ok":' }));
    await page.route("**/api/users/me", route => route.fulfill({ json: { profile: {
      id: "local-fixture", profile_revision: 0, display_name: null, avatar_url: null,
      whatsapp_number: matchingAccount ? "573001234567" : "573009999999", is_admin: false,
      default_payout_method: null, default_payout_account: null, default_payout_account_name: null, default_payout_account_type: null,
    } } }));
    await page.route("**/onboarding?*", route => route.fulfill({ contentType: "text/plain", body: "Confirmed local session" }));
    await page.goto("/login?returnTo=%2Fpolla%2Ftest%2Fpagar");
    await page.locator("#phone").fill("3001234567");
    await page.locator("form button[type=submit]").click();
    await page.getByRole("textbox", { name: "INGRESA TU CÓDIGO" }).fill("123456");
    await page.getByRole("button", { name: "Verificar código", exact: true }).click();
    if (matchingAccount) await expect(page).toHaveURL(/\/onboarding\?returnTo=%2Fpolla%2Ftest%2Fpagar/);
    else {
      await expect(page.getByText("No pudimos confirmar el ingreso.", { exact: false })).toBeVisible();
      await expect(page.getByRole("textbox", { name: "INGRESA TU CÓDIGO" })).toHaveValue("123456");
    }
  });
}
