import { expect, test } from "@playwright/test";

// wa.me stays under Playwright's network interception.
test.use({ serviceWorkers: "block" });

for (const allStorage of [false, true]) {
test(`WhatsApp sign-in stays usable when ${allStorage ? "all browser storage" : "session storage"} is blocked`, async ({ page, context }) => {
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
  await context.route(/^https:\/\/(wa\.me|api\.whatsapp\.com)\//, route => route.fulfill({ contentType: "text/html", body: "<title>WhatsApp</title>" }));
  await page.goto("/login?returnTo=%2Fpolla%2Fweekend%2Fpagar");
  await page.getByRole("link", { name: "Entrar con WhatsApp" }).click();
  await expect(page.getByTestId("login-whatsapp")).toHaveAttribute("data-view", "tutorial");
  const open = page.getByRole("link", { name: "Abrir WhatsApp" });
  await expect(open).toBeVisible({ timeout: 15_000 });
  const popup = context.waitForEvent("page");
  await open.click();
  await popup;
  await expect(page.getByTestId("login-whatsapp")).toHaveAttribute("data-view", "sent");
  expect(errors).toEqual([]);
});
}
