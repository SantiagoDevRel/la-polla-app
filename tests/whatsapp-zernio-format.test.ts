import { describe, expect, it } from "vitest";
import { adaptScreen, HOME, MORE, menuForScreen, renderZernioMenu, visibleOptions, matchZernioOption, truncate, splitBody, parseZernioMenu } from "@/lib/whatsapp-zernio/format";
import { COPY, homeButtons, MENU_LABELS, menuCommandOf } from "@/lib/telegram-player/copy";

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
  it("uses a list when even one reply label exceeds 20 characters", () => {
    const menu = menuWith(2);
    menu.options[0].label = "POLLA JAMES 2 · Gratis";
    const content = renderZernioMenu(menu)[0];
    expect(content.buttons).toBeUndefined();
    expect(content.interactive?.type).toBe("list");
    if (!content.interactive || !("sections" in content.interactive.action)) throw new Error("Expected list");
    expect(content.interactive.action.sections[0].rows[0].title).toBe(menu.options[0].label);
  });
  it("keeps long list labels unique and selectable", () => {
    const menu = menuWith(3); menu.options.forEach(o => { o.label = "Nombre idéntico extremadamente largo"; });
    const content = renderZernioMenu(menu)[0].interactive!;
    if (!("sections" in content.action)) throw new Error("Expected list");
    const rows = content.action.sections[0].rows;
    expect(new Set(rows.map(b => b.title)).size).toBe(3);
    expect(rows.every(b => b.title.length <= 24)).toBe(true);
    expect(matchZernioOption(menu, rows[1].title, false, false)).toBe("p:1");
  });
  it("truncates complete graphemes, including family emoji and combining marks", () => {
    expect(truncate("abc👨‍👩‍👧‍👦def", 8)).toBe("abc…");
    expect(truncate("e\u0301xyz", 3)).toBe("e\u0301…");
    expect(splitBody("🐥".repeat(1000)).join("")).toBe("🐥".repeat(1000));
  });
  it("omits screen URLs: personal login links use the dedicated login adapter", () => {
    const { links } = menuForScreen({ text: "Abre el enlace.", buttons: [[{ text: "Entrar a la web", url: "https://example.test/login" }, { text: "Malo", url: "javascript:alert(1)" }]] });
    expect(links).toHaveLength(0);
  });
  it("has three main actions and a separate More menu", () => {
    expect(adaptScreen({ text: COPY.home, buttons: homeButtons() })).toEqual(HOME);
    expect(HOME.buttons?.flat()).toHaveLength(3);
    expect(MORE.buttons?.flat().map(b => b.callback_data)).toEqual(["pg", "pf", "web", "hp", "m"]);
  });
  it("preserves home errors instead of hiding them behind a normal welcome", () => {
    expect(adaptScreen({ text: COPY.failure, buttons: homeButtons() }).text).toBe(COPY.failure);
  });
  it("offers one pool-list label and keeps the old typed alias working", () => {
    expect(MENU_LABELS.abiertas).toBe("⚽ Pollas disponibles");
    expect(menuCommandOf("Pollas disponibles")).toBe("abiertas");
    expect(menuCommandOf("pollas abiertas")).toBe("abiertas");
  });
  it("keeps the complete pool name separate from price and close time", () => {
    const name = "POLLA JAMES 2";
    const screen = adaptScreen({ text: "Pollas disponibles. Elige una.", buttons: [[{
      text: `${name} · Gratis`, callback_data: "p:1",
      listRow: { title: name, description: "Gratis · Cierra dom, 1 nov, 3:00 p. m. (Colombia)" },
    }]] });
    const menu = menuForScreen(screen, undefined, nonce).menu;
    expect(parseZernioMenu(menu)).toEqual(menu);
    const result = renderZernioMenu(menu)[0];
    expect(result.buttons).toBeUndefined();
    const interactive = result.interactive!;
    if (!("sections" in interactive.action)) throw new Error("Expected list");
    expect(interactive.action.sections[0].rows[0]).toMatchObject({ title: name, description: "Gratis · Cierra dom, 1 nov, 3:00 p. m. (Colombia)" });
  });
  it("distinguishes long pool names sharing 24 characters and preserves all facts", () => {
    const start = "Nombre de polla de prueba";
    const names = [start + " A".repeat(27), start + " B".repeat(27)];
    const facts = "Gratis · Cierra dom, 1 nov, 3:00 p. m. (Colombia) · Inscrito";
    const menu = menuForScreen(adaptScreen({ text: "Mis pollas. Elige una.", buttons: [names.map((title, i) => ({
      text: "truncated upstream", callback_data: `p:${i}`, listRow: { title, description: facts },
    }))] }), undefined, nonce).menu;
    const result = renderZernioMenu(menu);
    const interactive = result.at(-1)!.interactive!;
    if (!("sections" in interactive.action)) throw new Error("Expected list");
    const rows = interactive.action.sections[0].rows.slice(0, 2);
    rows.forEach((row, i) => {
      expect(row.title + row.description!.split(" · ")[0]).toBe(names[i]);
      expect(row.title.length).toBeLessThanOrEqual(24);
      expect(row.description!.length).toBeLessThanOrEqual(72);
      expect(matchZernioOption(menu, row.id, true, false)).toBe(`p:${i}`);
      expect(menu.body).toContain(`${names[i]}: ${facts}`);
    });
    expect(rows[0].description).not.toBe(rows[1].description);
    expect(matchZernioOption(menu, start, false, false)).toBeNull();
    expect(matchZernioOption(menu, names[1], false, false)).toBe("p:1");
  });
  it("preserves graphemes in names split between title and description", () => {
    const title = "a".repeat(23) + "e\u0301" + " final";
    const menu = menuForScreen({ text: "Elige.", buttons: [[{ text: title, callback_data: "p:1", listRow: { title, description: "Inscrito" } }]] }).menu;
    const content = renderZernioMenu(menu)[0].interactive!;
    if (!("sections" in content.action)) throw new Error("Expected list");
    const row = content.action.sections[0].rows[0];
    expect(row.title).toBe("a".repeat(23));
    expect(row.title + row.description!.split(" · ")[0]).toBe(title);
  });
  it("keeps screen links out of the reply and exposes login only from Más", () => {
    const screen = adaptScreen({ text: "Perfil", buttons: [[{ text: "Ver en la página", url: "https://example.test/polla" }, { text: "Web", callback_data: "web" }]] });
    expect(screen.buttons?.flat().map(b => b.callback_data)).toEqual(["m"]);
    expect(adaptScreen(MORE).buttons?.flat().some(b => b.callback_data === "web")).toBe(true);
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
