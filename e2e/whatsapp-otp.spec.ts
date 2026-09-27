import { test, expect } from "@playwright/test";

// Opt-in: run against a server started with WHATSAPP_OTP_ENABLED=true.
// All auth requests are intercepted: no messages, charges or real sessions.
test.skip(process.env.WHATSAPP_OTP_ENABLED !== "true", "WhatsApp rollout must be enabled on the isolated test server");

for (const width of [320, 768, 1440]) {
  test(`WhatsApp OTP: channel, six digits and errors at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const failures: string[] = [];
    page.on("pageerror", e => failures.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem("lp_welcome_seen_v1", "1");
      (window as unknown as Record<string, unknown>).__DISABLE_AGENTATION__ = true;
    });
    await page.route("**/auth/v1/**", route => route.abort());
    const requests: unknown[] = [];
    await page.route("**/api/auth/start-otp", async route => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, json: { ok: true } });
    });
    await page.route("**/api/auth/verify-otp", async route => {
      expect(route.request().postDataJSON()).toMatchObject({ token: "123456" });
      await route.fulfill({ status: 401, json: { error: "Código inválido o vencido" } });
    });
    await page.goto("/login");
    const send = page.getByRole("button", { name: "Enviar código por WhatsApp", exact: true });
    await expect(send).toBeVisible();
    await expect(page.getByRole("button", { name: "Enviar código por SMS", exact: true })).toHaveCount(0);
    await page.locator('input[type="tel"]').fill("3001234567");
    await send.click();
    await expect(page.getByText("Código enviado por WhatsApp a", { exact: false })).toBeVisible();
    expect(requests).toEqual([{ phone: "+573001234567", deliveryChannel: "whatsapp" }]);
    const code = page.getByRole("textbox", { name: "INGRESA TU CÓDIGO" });
    const verify = page.getByRole("button", { name: "Verificar código", exact: true });
    await code.fill("12345");
    await expect(verify).toBeDisabled();
    await code.fill("123456");
    await expect(verify).toBeEnabled();
    await verify.click();
    await expect(page.getByText("Código inválido o vencido", { exact: true })).toBeVisible();
    if (width === 320) {
      await code.evaluate(element => {
        element.style.fontSize = `${parseFloat(getComputedStyle(element).fontSize) * 2}px`;
      });
      // All six digits must fit at 200% text size, not just remain in the value.
      expect(await code.evaluate(element => {
        const style = getComputedStyle(element);
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d")!;
        ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const needed = ctx.measureText((element as HTMLInputElement).value).width
          + (parseFloat(style.letterSpacing) || 0) * 6 + (parseFloat(style.textIndent) || 0);
        return needed <= element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      })).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(failures).toEqual([]);
  });
}
