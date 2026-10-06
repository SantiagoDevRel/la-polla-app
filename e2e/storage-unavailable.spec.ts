import { expect, test } from "@playwright/test";

for (const allStorage of [false, true]) {
test(`registration stays usable when ${allStorage ? "all browser storage" : "session storage"} is blocked`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript((blockAll) => {
    Reflect.set(window, "__DISABLE_AGENTATION__", true);
    if (!blockAll) localStorage.setItem("lp_welcome_seen_v1", "1");
    else Object.defineProperty(window, "localStorage", {
      get() { throw new DOMException("Storage blocked by browser", "SecurityError"); },
    });
    Object.defineProperty(window, "sessionStorage", {
      get() { throw new DOMException("Storage blocked by browser", "SecurityError"); },
    });
  }, allStorage);
  await page.route("**/api/auth/password", route => route.fulfill({ json: { enabled: false } }));
  await page.route("**/api/auth/start-otp", route => route.fulfill({ json: { ok: true } }));
  await page.goto("/login?returnTo=%2Fpolla%2Fweekend%2Fpagar");
  await page.locator('input[type="tel"]').fill("3001234567");
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('input[maxlength="6"]')).toBeVisible();
  expect(errors).toEqual([]);
});
}
