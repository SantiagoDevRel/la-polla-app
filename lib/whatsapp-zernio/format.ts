import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Screen, FlowName, Button } from "@/lib/telegram-player/context";
import { COPY } from "@/lib/telegram-player/copy";
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

const optionSchema = z.object({
  label: z.string().max(500), data: z.string().min(1).max(64),
  listRow: z.object({ title: z.string().max(500), description: z.string().max(500) }).optional(),
});
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

/** Exact prefix, without an ellipsis; the remaining name goes in the description. */
function prefix(text: string, limit: number): string {
  let result = "";
  for (const { segment } of segmenter.segment(text)) {
    if (result.length + segment.length > limit) break;
    result += segment;
  }
  return result;
}

function actionLabel(button: Button): string {
  const label = cleanLabel(button.text);
  if (button.listRow) return label;
  const action = button.callback_data?.replace(/^!/, "").split(":")[0];
  if ((action === "ol" || action === "ml") && /anteriores|más/i.test(label)) return /anteriores/i.test(label) ? "Anterior" : "Más pollas";
  if (action === "tb" && /actualizar/i.test(label)) return "Actualizar";
  const labels: Record<string, string> = {
    ol: "Pollas disponibles", ml: "Mis pollas", pg: "Mis pagos", pf: "Mi perfil",
    hp: "Ayuda", web: "Entrar a la web", pay: "Cuenta para premios",
    pk: "Pronosticar", ls: "Mis pronósticos", la: "Mis respuestas", q: "Responder preguntas",
    tb: "Tabla", if: "Reglas", cx: "Cancelar", sk: "Saltar", qs: "Saltar",
  };
  if (action === "j") return /gratis/i.test(label) ? "Entrar gratis" : /comprobante/i.test(label) ? "Enviar comprobante" : "Inscribirme";
  return labels[action ?? ""] ?? label;
}

export const HOME: Screen = {
  text: "¿Qué quieres hacer?",
  buttons: [[{ text: "Pollas disponibles", callback_data: "ol:0" }, { text: "Mis pollas", callback_data: "ml:0" }, { text: "Más", callback_data: "zmore" }]],
};
export const MORE: Screen = {
  text: "Elige una opción.",
  buttons: [[{ text: "Mis pagos", callback_data: "pg" }, { text: "Mi perfil", callback_data: "pf" }],
    [{ text: "Entrar a la web", callback_data: "web" }, { text: "Ayuda", callback_data: "hp" }, { text: "Menú", callback_data: "m" }]],
};

/** Presentation only. Business decisions and values still come from the player flows. */
export function adaptScreen(screen: Screen, flow?: FlowName): Screen {
  if (screen === MORE) return MORE;
  const buttons = (screen.buttons ?? []).flat();
  const callbacks = buttons.map(b => b.callback_data);
  if (callbacks.includes("pg") && callbacks.includes("pf") && callbacks.includes("hp") && callbacks.includes("ol:0")) {
    const text = screen.text === COPY.home ? HOME.text : screen.compactText ?? screen.text;
    return { ...HOME, text };
  }
  let text = screen.compactText ?? screen.text;
  if (text.includes("Paso 1 de 2: tu nombre")) text = "Escribe tu nombre para la tabla de posiciones.";
  if (text.includes("Paso 2 de 2: tu pollito")) text = "Elige tu pollito.";
  if (text === COPY.pendingPoints) text = "Pago en revisión. Tus puntos aparecerán cuando lo confirmemos.";
  text = text.replaceAll(COPY.pendingPoints, "Pago en revisión: tus puntos aparecerán cuando lo confirmemos.");
  let kept = buttons.filter(b => !b.url && b.callback_data !== "web");
  if (flow === "score" && buttons.some(b => /^h:/.test(b.callback_data ?? ""))) {
    kept = kept.filter(b => !/^h:/.test(b.callback_data ?? ""));
    text = text.replace(/¿Cuántos goles hace[\s\S]*$/, "Escribe el marcador: <b>2-1</b> (local primero).");
  }
  // Short payment instructions retain the exact account, price and all warnings.
  if (text.includes("<b>Paso 1.</b> Transfiere")) {
    text = text.replace(/<i>Toca el número para copiarlo\.<\/i>[\s\S]*?<b>Paso 3\.<\/b>[^\n]*/, "\nEnvía aquí la imagen del comprobante (JPG, PNG o WEBP).")
      .replace("Revisamos el comprobante y te avisamos por este chat. Si hay un error, te decimos por qué.", "Revisamos tu comprobante. Consulta el estado en Mis pagos.");
  }
  if (!kept.some(b => b.callback_data === "m")) kept = [...kept, { text: "Menú", callback_data: "m" }];
  return { text: text.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "").trim(), buttons: [kept.map(b => ({ ...b, text: actionLabel(b) }))] };
}

export function menuForScreen(screen: Screen, flow?: FlowName, nonce = randomBytes(8).toString("hex")): { menu: ZernioMenu; links: ZernioContent[] } {
  const options: ZernioMenu["options"] = [];
  const links: ZernioContent[] = [];
  for (const button of (screen.buttons ?? []).flat()) {
    // Screen URLs are noise here. Personal login CTAs bypass this renderer through
    // the original login delivery adapter; never convert ordinary links into CTAs.
    if (!button.url && button.callback_data) {
      const data = button.callback_data.startsWith(NEW_MESSAGE_MARK) ? button.callback_data.slice(1) : button.callback_data;
      if (Buffer.byteLength(data) <= 64) options.push({ data,
        label: button.listRow?.title ?? (cleanLabel(button.text) || "Ver opción"),
        ...(button.listRow ? { listRow: button.listRow } : {}),
      });
    }
  }
  const body = toWhatsAppText(screen.text).replace("Solo responde con el número de cada opción.", "Elige una opción.")
    .replace(/Te avisamos por este chat cuando lo confirmemos\./g, "Consulta el estado en Mis pagos.")
    .replace(/Te avisamos por este chat apenas quede confirmado\./g, "Consulta el estado en Mis pagos.").trim();
  // Very long names have priority in row descriptions. Keep overflowing facts in
  // the body too, so native limits never hide price, close time or status.
  const overflow = options.filter(o => o.listRow && rowDescription(o).length > 72)
    .map(o => `${o.listRow!.title}: ${o.listRow!.description}`);
  return { menu: { zernio: 1, nonce, body: [body, ...overflow].join("\n"), options, page: 0, mode: menuModeFor(flow) }, links };
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

function canUseReplyButtons(rows: ReturnType<typeof visibleOptions>): boolean {
  return rows.length <= 3 && rows.every(o => !o.listRow && o.label.length <= 20)
    && new Set(rows.map(o => o.label)).size === rows.length;
}

function rowDescription(option: ZernioMenu["options"][number]): string {
  if (!option.listRow) return option.label.length > 24 ? option.label : "";
  const rest = option.listRow.title.slice(prefix(option.listRow.title, 24).length);
  return [rest, option.listRow.description].filter(Boolean).join(" · ");
}

function optionTitles(rows: ReturnType<typeof visibleOptions>): string[] {
  const limit = canUseReplyButtons(rows) ? 20 : 24;
  const titles = rows.map(o => o.listRow ? prefix(o.listRow.title, 24) : truncate(o.label, limit));
  // Meta rejects duplicate button labels; numbering also disambiguates truncation.
  const used = new Set<string>();
  return titles.map((t, i) => {
    // Pool titles are names, not numbered abbreviations. Their remaining names
    // and facts distinguish matching prefixes in the description.
    if (rows[i].listRow) { used.add(t); return t; }
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
  if (canUseReplyButtons(rows)) contents.push({ message: body, buttons: rows.map((o, i) => ({ type: "postback", title: uniqueTitles[i], payload: o.id })) });
  else contents.push({ interactive: { type: "list", body: { text: body }, action: { button: "Ver opciones", sections: [{ rows: rows.map((o, i) => ({
    id: o.id, title: uniqueTitles[i], ...(rowDescription(o) ? { description: truncate(rowDescription(o), 72) } : {}),
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
  const matching = rows.filter((o, i) => normalizeCommandText(o.label) === wanted || normalizeCommandText(titles[i]) === wanted);
  return matching.length === 1 ? matching[0].data : null;
}
