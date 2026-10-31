import { describe, expect, it } from "vitest";
import { adaptScreen, HOME, MORE, menuForScreen, renderZernioMenu, visibleOptions, matchZernioOption, truncate, splitBody, parseZernioMenu } from "@/lib/whatsapp-zernio/format";
import { homeButtons } from "@/lib/telegram-player/copy";

const nonce = "a".repeat(16);
function menuWith(count: number) {
  return menuForScreen({ text: "Elige una opción.", buttons: [Array.from({ length: count }, (_, i) => ({ text: `Opción ${i + 1}`, callback_data: `p:${i}` }))] }, undefined, nonce).menu;
}

describe("Zernio native screen renderer", () => {
  it.each([1, 3])("renders %i options as reply buttons with payloads", count => {
    const result = renderZernioMenu(menuWith(count));
    expect(result).toHaveLength(1);
    expect(result[0].buttons).toHaveLength(count);
    expect(result[0].buttons?.[0]).toMatchObject({ type: "postback", payload: `${nonce}:0` });
    expect(result[0].interactive).toBeUndefined();
  });
  it.each([4, 10])("renders %i options in one list", count => {
    const content = renderZernioMenu(menuWith(count))[0];
    expect(content.interactive?.type).toBe("list");
    if (!content.interactive || !("sections" in content.interactive.action)) throw new Error("Expected list");
    expect(content.interactive.action.sections[0].rows).toHaveLength(count);
    expect(content.buttons).toBeUndefined();
  });
  it.each([11, 25, 100])("paginates %i options without losing any option", count => {
    const menu = menuWith(count);
    const seen = new Set<string>();
    for (let page = 0; page < Math.ceil(count / 8); page++) {
      const rows = visibleOptions({ ...menu, page });
      expect(rows.length).toBeLessThanOrEqual(10);
      for (const row of rows.filter(r => !r.data.startsWith("zpage:"))) seen.add(row.data);
      if (page === 0) expect(rows.at(-1)?.label).toBe("Más");
    }
    expect(seen.size).toBe(count);
  });
  it("keeps Menú on every page, including middle and last pages", () => {
    const menu = menuWith(30); menu.options.push({ label: "Menú", data: "m" });
    for (let page = 0; page < 5; page++) {
      const rows = visibleOptions({ ...menu, page });
      expect(rows.length).toBeLessThanOrEqual(10);
      expect(rows.at(-1)?.data).toBe("m");
    }
  });
  it("caps bodies, titles and descriptions, preserving the whole body", () => {
    const menu = menuWith(4);
    menu.body = "🐥 información útil ".repeat(300);
    menu.options.forEach(o => { o.label = "Un nombre largo y repetido ".repeat(9); });
    const result = renderZernioMenu(menu);
    const text = result.map(c => c.message ?? c.interactive?.body.text).join("");
    expect(text).toBe(menu.body);
    expect(result.every(c => (c.message ?? c.interactive?.body.text ?? "").length <= 1024)).toBe(true);
    const last = result.at(-1)!.interactive!;
    if (!("sections" in last.action)) throw new Error("Expected list");
    for (const row of last.action.sections[0].rows) {
      expect(row.title.length).toBeLessThanOrEqual(24);
      expect(row.description!.length).toBeLessThanOrEqual(72);
      expect(row.id.length).toBeLessThanOrEqual(200);
    }
    expect(new Set(last.action.sections[0].rows.map(r => r.title)).size).toBe(4);
  });
  it("keeps reply labels unique after truncation and within 20 characters", () => {
    const menu = menuWith(3); menu.options.forEach(o => { o.label = "Nombre idéntico extremadamente largo"; });
    const buttons = renderZernioMenu(menu)[0].buttons!;
    expect(new Set(buttons.map(b => b.title)).size).toBe(3);
    expect(buttons.every(b => b.title.length <= 20)).toBe(true);
    expect(matchZernioOption(menu, buttons[1].title, false, false)).toBe("p:1");
  });
  it("truncates complete graphemes, including family emoji and combining marks", () => {
    expect(truncate("abc👨‍👩‍👧‍👦def", 8)).toBe("abc…");
    expect(truncate("e\u0301xyz", 3)).toBe("e\u0301…");
    expect(splitBody("🐥".repeat(1000)).join("")).toBe("🐥".repeat(1000));
  });
  it("uses CTA URL for HTTPS links and drops unsafe links", () => {
    const { links } = menuForScreen({ text: "Abre el enlace.", buttons: [[{ text: "Entrar a la web", url: "https://example.test/login" }, { text: "Malo", url: "javascript:alert(1)" }]] });
    expect(links).toHaveLength(1);
    expect(links[0].interactive).toMatchObject({ type: "cta_url", action: { name: "cta_url", parameters: { display_text: "Entrar a la web" } } });
  });
  it("has three main actions and a separate More menu", () => {
    expect(adaptScreen({ text: "inicio", buttons: homeButtons() })).toEqual(HOME);
    expect(HOME.buttons?.flat()).toHaveLength(3);
    expect(MORE.buttons?.flat().map(b => b.callback_data)).toEqual(["pg", "pf", "web", "hp", "m"]);
  });
  it("asks for one typed score, removing the 10 goal buttons", () => {
    const screen = adaptScreen({ text: "Local vs Visitante\n¿Cuántos goles hace Local?", buttons: [[...Array.from({ length: 10 }, (_, i) => ({ text: String(i), callback_data: `h:p:m:${i}` })), { text: "Saltar", callback_data: "sk:p:m" }]] }, "score");
    expect(screen.text).toContain("2-1");
    expect(screen.buttons?.flat().some(b => b.callback_data?.startsWith("h:"))).toBe(false);
    expect(screen.buttons?.flat().at(-1)?.callback_data).toBe("m");
  });
  it("accepts numbers and titles, revalidates opaque ids and preserves numeric free input", () => {
    const menu = menuWith(4);
    expect(matchZernioOption(menu, "2", false, false)).toBe("p:1");
    expect(matchZernioOption(menu, "opcion 2", false, false)).toBe("p:1");
    expect(matchZernioOption(menu, `${nonce}:1`, true, true)).toBe("p:1");
    expect(matchZernioOption(menu, "forged:1", true, false)).toBeNull();
    for (const input of ["2-1", "15", "Opción 2", "Un nombre"]) expect(matchZernioOption(menu, input, false, true)).toBeNull();
    menu.mode = "abc";
    expect(matchZernioOption(menu, "B", false, true)).toBe("p:1");
  });
  it("rejects corrupt stored menus", () => {
    expect(parseZernioMenu({ zernio: 1, options: "bad" })).toBeNull();
    expect(parseZernioMenu(menuWith(4))).not.toBeNull();
  });
});
