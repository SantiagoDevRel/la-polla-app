import { test, expect } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test("slow JavaScript cannot accept a phone before normalization handlers are ready", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __DISABLE_AGENTATION__: boolean }).__DISABLE_AGENTATION__ = true;
    localStorage.setItem("lp_welcome_seen_v1", "1");
    sessionStorage.setItem("lp_splash_seen_v2", "1");
  });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  let release!: () => void;
  const chunksReady = new Promise<void>(resolve => { release = resolve; });
  let heldChunks = 0, sends = 0;
  let deliveredPhone: unknown;
  await page.route("**/_next/static/**/*.js", async route => {
    heldChunks++;
    await chunksReady;
    await route.continue();
  });
  await page.route("**/api/auth/start-otp", async route => {
    sends++;
    deliveredPhone = route.request().postDataJSON().phone;
    await new Promise(resolve => setTimeout(resolve, 100));
    await route.fulfill({ json: { ok: true } });
  });
  try {
    // DOMContentLoaded/load would wait for scripts; inspect actual SSR first.
    await page.goto("/login", { waitUntil: "commit" });
    await expect(page.locator("#phone")).toBeVisible();
    await expect.poll(() => heldChunks).toBeGreaterThan(0);
    await expect(page.locator("#phone")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Colombia +57", exact: true })).toBeDisabled();
    await expect(page.locator("form button[type=submit]")).toBeDisabled();
    expect(sends).toBe(0);
    release();
    await page.locator("#phone").fill("+57 300 123 4567");
    await expect(page.locator("#phone")).toHaveValue("3001234567");
    await page.evaluate(() => {
      for (let i = 0; i < 5; i++) document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await expect(page.getByRole("textbox", { name: "INGRESA TU CÓDIGO" })).toBeVisible();
    expect(sends).toBe(1);
    expect(deliveredPhone).toBe("+573001234567");
    expect(errors).toEqual([]);
  } finally { release(); }
});
