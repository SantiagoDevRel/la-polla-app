// e2e/a11y-visual.spec.ts — gate visual + accesibilidad de páginas públicas.
// Primera vez (siembra baselines): npm run test:e2e:update
// Corridas normales:               npm run test:e2e
// El gate a11y bloquea solo violaciones critical/serious (WCAG A/AA); el resto se loguea.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// El overlay dev de Agentation no debe entrar ni al scan de axe ni a los screenshots.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __DISABLE_AGENTATION__?: boolean }).__DISABLE_AGENTATION__ = true;
  });
});

// "/" redirige a /login con la app cerrada — se testean las públicas reales.
const PAGES = [
  { path: "/login", name: "login" },
  { path: "/privacy", name: "privacy" },
  { path: "/soporte", name: "soporte" },
] as const;

for (const { path, name } of PAGES) {
  test(`visual: ${name}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(path);
    await expect(page).toHaveScreenshot(`${name}.png`, {
      fullPage: true,
      animations: "disabled",
    });
  });

  test(`a11y: ${name}`, async ({ page }) => {
    await page.goto(path);
    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    const blocking = violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    const minor = violations.filter((v) => !blocking.includes(v));
    if (minor.length) {
      console.log(
        `[a11y:${name}] no-bloqueantes: ${minor.map((v) => `${v.id}(${v.impact})`).join(", ")}`,
      );
    }
    for (const v of blocking) {
      for (const n of v.nodes) {
        console.log(`[a11y:${name}] ${v.id}: ${n.target.join(" ")} → ${n.html}`);
      }
    }
    expect(
      blocking.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
    ).toEqual([]);
  });
}
