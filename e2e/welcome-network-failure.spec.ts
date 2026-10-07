import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });
test("a failed optional welcome chunk cannot break registration", async ({ page }) => {
  const errors: string[] = [];
  let failedIntroChunks = 0;
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    Reflect.set(window, "__DISABLE_AGENTATION__", true);
    sessionStorage.setItem("lp_splash_seen_v2", "1");
  });
  await page.route("**/_next/static/chunks/**", async route => {
    if (route.request().resourceType() !== "script") return route.continue();
    const response = await route.fetch();
    if ((await response.text()).includes("data-welcome-stage")) {
      failedIntroChunks++;
      return route.abort("connectionreset");
    }
    await route.fulfill({ response });
  });
  await page.route("**/api/auth/start-otp", route => route.fulfill({ json: { ok: true } }));
  await page.goto("/login");
  await expect.poll(() => failedIntroChunks).toBeGreaterThan(0);
  await page.locator("#phone").fill("3001234567");
  await page.locator('form button[type="submit"]').click();
  await expect(page.getByRole("textbox", { name: "INGRESA TU CÓDIGO" })).toBeVisible();
  expect(errors).toEqual([]);
});
