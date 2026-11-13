import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });
test("a failed optional welcome chunk cannot break WhatsApp sign-in", async ({ page, context }) => {
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
  await context.route(/^https:\/\/(wa\.me|api\.whatsapp\.com)\//, route => route.fulfill({ contentType: "text/html", body: "<title>WhatsApp</title>" }));
  await page.goto("/login");
  await expect.poll(() => failedIntroChunks).toBeGreaterThan(0);
  await page.getByRole("link", { name: "Entrar con WhatsApp" }).click();
  await expect(page.getByTestId("login-whatsapp")).toHaveAttribute("data-view", "tutorial");
  expect(errors).toEqual([]);
});
