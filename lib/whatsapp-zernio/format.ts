import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Screen, FlowName } from "@/lib/telegram-player/context";
import { NEW_MESSAGE_MARK } from "@/lib/telegram-player/ids";
import { normalizeCommandText } from "@/lib/telegram-player/update";
import { menuModeFor, toWhatsAppText } from "@/lib/whatsapp-player/format";

export type ZernioContent = {
  message?: string;
  buttons?: { type: "postback"; title: string; payload: string }[];
  interactive?: {
    type: "list" | "cta_url";
    body: { text: string };
    action: { button: string; sections: { rows: { id: string; title: string; description?: string }[] }[] }
      | { name: "cta_url"; parameters: { display_text: string; url: string } };
  };
};

const optionSchema = z.object({ label: z.string().max(500), data: z.string().min(1).max(64) });
const menuSchema = z.object({
  zernio: z.literal(1), nonce: z.string().regex(/^[a-f0-9]{16}$/),
  body: z.string().max(16000), options: z.array(optionSchema).max(200),
  page: z.number().int().min(0).max(200), mode: z.enum(["num", "abc"]),
});
export type ZernioMenu = z.infer<typeof menuSchema>;

export function parseZernioMenu(value: unknown): ZernioMenu | null {
  const result = menuSchema.safeParse(value);
  return result.success ? result.data : null;
}

const segmenter = new Intl.Segmenter("es", { granularity: "grapheme" });
/** Use UTF-16 limits conservatively; never cut a surrogate, accent or ZWJ emoji. */
export function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let result = "";
  for (const { segment } of segmenter.segment(text)) {
    if (result.length + segment.length > limit - 1) break;
    result += segment;
  }
  return `${result.trimEnd()}…`;
}

export function splitBody(text: string, limit = 1024): string[] {
  const chunks: string[] = [];
  let part = "";
  for (const { segment } of segmenter.segment(text)) {
    if (part.length + segment.length > limit) { chunks.push(part); part = ""; }
    part += segment;
  }
  if (part) chunks.push(part);
  return chunks.length ? chunks : ["Elige una opción."];
}

function cleanLabel(text: string): string {
  return text.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "").replace(/\s+/g, " ").trim();
}

export const HOME: Screen = {
  text: "🐥 ¿Qué quieres hacer?",
  buttons: [[{ text: "Pollas disponibles", callback_data: "ol:0" }, { text: "Mis pollas", callback_data: "ml:0" }, { text: "Más", callback_data: "zmore" }]],
};
export const MORE: Screen = {
  text: "Más opciones. La tabla está dentro de cada polla.",
  buttons: [[{ text: "Mis pagos", callback_data: "pg" }, { text: "Mi perfil", callback_data: "pf" }],
    [{ text: "Entrar a la web", callback_data: "web" }, { text: "Ayuda", callback_data: "hp" }, { text: "Menú", callback_data: "m" }]],
};

/** Presentation only. Business decisions and values still come from the player flows. */
export function adaptScreen(screen: Screen, flow?: FlowName): Screen {
  const buttons = (screen.buttons ?? []).flat();
  const callbacks = buttons.map(b => b.callback_data);
  if (callbacks.includes("pg") && callbacks.includes("pf") && callbacks.includes("hp") && callbacks.includes("ol:0")) return HOME;
  let text = screen.compactText ?? screen.text;
  if (text.includes("Paso 1 de 2: tu nombre")) text = "🐥 Bienvenido a La Polla.\nEscribe tu nombre para la tabla de posiciones.";
  if (text.includes("Paso 2 de 2: tu pollito")) text = "Elige tu pollito.";
  let kept = buttons;
  if (flow === "score" && buttons.some(b => /^h:/.test(b.callback_data ?? ""))) {
    kept = buttons.filter(b => !/^h:/.test(b.callback_data ?? ""));
    text = text.replace(/¿Cuántos goles hace[\s\S]*$/, "Escribe el marcador: <b>2-1</b> (local primero).");
  }
  // Short payment instructions retain the exact account, price and all warnings.
  if (text.includes("<b>Paso 1.</b> Transfiere")) {
    text = text.replace(/<i>Toca el número para copiarlo\.<\/i>[\s\S]*?<b>Paso 3\.<\/b>[^\n]*/, "\nEnvía aquí la imagen del comprobante (JPG, PNG o WEBP).")
      .replace("Revisamos el comprobante y te avisamos por este chat. Si hay un error, te decimos por qué.", "Revisamos tu comprobante. Consulta el estado en Mis pagos.");
  }
  if (!kept.some(b => b.callback_data === "m")) kept = [...kept, { text: "Menú", callback_data: "m" }];
  return { text, buttons: [kept] };
}

export function menuForScreen(screen: Screen, flow?: FlowName, nonce = randomBytes(8).toString("hex")): { menu: ZernioMenu; links: ZernioContent[] } {
  const options: ZernioMenu["options"] = [];
  const links: ZernioContent[] = [];
  for (const button of (screen.buttons ?? []).flat()) {
    if (button.url && /^https:\/\//.test(button.url)) {
      links.push({ interactive: { type: "cta_url", body: { text: truncate(cleanLabel(button.text), 1024) || "Abrir enlace" },
        action: { name: "cta_url", parameters: { display_text: truncate(cleanLabel(button.text), 20) || "Abrir enlace", url: button.url } } } });
    } else if (button.callback_data) {
      const data = button.callback_data.startsWith(NEW_MESSAGE_MARK) ? button.callback_data.slice(1) : button.callback_data;
      if (Buffer.byteLength(data) <= 64) options.push({ data, label: cleanLabel(button.text) || "Ver opción" });
    }
  }
  const body = toWhatsAppText(screen.text).replace("Solo responde con el número de cada opción.", "Elige una opción.")
    .replace(/Te avisamos por este chat cuando lo confirmemos\./g, "Consulta el estado en Mis pagos.")
    .replace(/Te avisamos por este chat apenas quede confirmado\./g, "Consulta el estado en Mis pagos.").trim();
  return { menu: { zernio: 1, nonce, body, options, page: 0, mode: menuModeFor(flow) }, links };
}

export function visibleOptions(menu: ZernioMenu) {
  if (menu.options.length <= 10) return menu.options.map((o, index) => ({ ...o, id: `${menu.nonce}:${index}` }));
  const home = menu.options.find(o => o.data === "m");
  const main = menu.options.map((o, index) => ({ ...o, id: `${menu.nonce}:${index}` })).filter(o => o.data !== "m");
  const size = home ? 7 : 8;
  const page = Math.min(menu.page, Math.max(0, Math.ceil(main.length / size) - 1));
  const rows = main.slice(page * size, (page + 1) * size);
  if (page > 0) rows.push({ label: "Anterior", data: `zpage:${page - 1}`, id: `${menu.nonce}:prev` });
  if ((page + 1) * size < main.length) rows.push({ label: "Más", data: `zpage:${page + 1}`, id: `${menu.nonce}:next` });
  if (home) rows.push({ ...home, id: `${menu.nonce}:${menu.options.indexOf(home)}` });
  return rows;
}

function optionTitles(rows: ReturnType<typeof visibleOptions>): string[] {
  const limit = rows.length <= 3 ? 20 : 24;
  const titles = rows.map(o => truncate(o.label, limit));
  // Meta rejects duplicate button labels; numbering also disambiguates truncation.
  const used = new Set<string>();
  return titles.map((t, i) => {
    let title = titles.filter(x => x === t).length > 1 ? truncate(`${i + 1}. ${rows[i].label}`, limit) : t;
    let attempt = 1;
    while (used.has(title)) title = truncate(`${i + 1}.${attempt++}. ${rows[i].label}`, limit);
    used.add(title);
    return title;
  });
}

export function renderZernioMenu(menu: ZernioMenu): ZernioContent[] {
  const rows = visibleOptions(menu);
  const bodies = splitBody(menu.body);
  const body = bodies.pop()!;
  const contents: ZernioContent[] = bodies.map(message => ({ message }));
  if (!rows.length) return [...contents, { message: body }];
  const uniqueTitles = optionTitles(rows);
  if (rows.length <= 3) contents.push({ message: body, buttons: rows.map((o, i) => ({ type: "postback", title: uniqueTitles[i], payload: o.id })) });
  else contents.push({ interactive: { type: "list", body: { text: body }, action: { button: "Ver opciones", sections: [{ rows: rows.map((o, i) => ({
    id: o.id, title: uniqueTitles[i], ...(o.label.length > 24 ? { description: truncate(o.label, 72) } : {}),
  })) }] } } });
  return contents;
}

export function matchZernioOption(menu: ZernioMenu | null, input: string, interactive: boolean, textFlow: boolean): string | null {
  if (!menu) return null;
  const rows = visibleOptions(menu);
  if (interactive) return rows.find(o => o.id === input)?.data ?? null;
  // Numeric free input is never interpreted as a menu selection during a text flow.
  const t = input.trim().replace(/[.)]+$/, "");
  const index = menu.mode === "abc" && /^[a-z]$/i.test(t) ? t.toUpperCase().charCodeAt(0) - 65
    : !textFlow && /^\d{1,2}$/.test(t) ? Number(t) - 1 : -1;
  if (index >= 0) return rows[index]?.data ?? null;
  if (textFlow) return null;
  const wanted = normalizeCommandText(t);
  const titles = optionTitles(rows);
  return rows.find((o, i) => normalizeCommandText(o.label) === wanted || normalizeCommandText(titles[i]) === wanted)?.data ?? null;
}
