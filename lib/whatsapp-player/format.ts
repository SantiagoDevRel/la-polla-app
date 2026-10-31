// lib/whatsapp-player/format.ts — Pantallas del bot de Telegram convertidas a
// mensajes de WhatsApp. Funciones puras.
//
// Respaldo de texto; los menús nativos de encuestas viven en poll-menu.ts.
// OpenWA (whatsapp-web.js) no tiene reply buttons ni listas: cada botón se vuelve una
// opción numerada y la persona responde con el número. Mientras el bot espera
// un texto que puede ser un número (boleta, marcador, cuenta Nequi, respuesta
// libre…), las opciones van con LETRAS para no confundir «15» con la opción 15.
// Los botones de goles (0–9) no se listan: se responde con el número de goles.
//
// El HTML de Telegram pasa a la marca de WhatsApp (*negrita*, _cursiva_) y las
// frases que hablan de tocar botones o de Telegram se dicen para WhatsApp.

import type { FlowName, Keyboard, Screen } from "@/lib/telegram-player/context";
import { NEW_MESSAGE_MARK } from "@/lib/telegram-player/ids";
import { normalizeCommandText } from "@/lib/telegram-player/update";

export const WHATSAPP_MAX_TEXT = 4096;

export interface MenuOption {
  key: string;
  data: string;
  label: string;
}

/** Qué hace cada respuesta corta en la última pantalla (whatsapp_bot_chats.menu). */
export interface WhatsAppMenu {
  mode: "num" | "abc";
  options: MenuOption[];
  /** Botones de goles: «2» → callback. */
  digits?: Record<string, string>;
}

/** Pasos en los que la persona escribe un texto que puede ser un número. */
const TEXT_FLOWS: ReadonlySet<FlowName> = new Set(["name", "ticket", "score", "answer", "pay_name", "pay_account"]);

export function menuModeFor(flow: FlowName | null | undefined): WhatsAppMenu["mode"] {
  return flow && TEXT_FLOWS.has(flow) ? "abc" : "num";
}

/** Frases de Telegram → WhatsApp. Las específicas van antes que las generales. */
const PHRASES: Array<[RegExp, string]> = [
  [/Toca el número para copiarlo\./g, "Mantén presionado el número para copiarlo."],
  [/Toca el clip 📎, elige/g, "Toca el clip 📎 (en iPhone, el +), elige"],
  [/Envíala como foto \(no como archivo\) para que Telegram la comprima\./g, "Envíala como foto (no como documento) para que WhatsApp la comprima."],
  [/Todo con botones\./g, "Solo responde con el número de cada opción."],
  [/Estos botones también quedan fijos abajo\. En el computador se abren con el ícono de cuatro cuadritos junto a la carita\./g, "Escribe «menú» cuando quieras volver a estas opciones."],
  [/o usa los botones del partido/g, "o elige una opción"],
  [/Ese botón ya no está vigente\./g, "Esa opción ya no está vigente."],
  [/\bToca\b/g, "Elige"],
  [/\btoca\b/g, "elige"],
];

function unescapeHtml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

/**
 * WhatsApp solo aplica la marca si va pegada al texto y en una sola línea:
 * se marca cada línea por separado y los espacios quedan por fuera.
 */
function wrap(mark: string, inner: string): string {
  return inner.split("\n").map((line) => {
    const content = line.trim();
    if (!content) return line;
    const lead = line.slice(0, line.indexOf(content));
    return `${lead}${mark}${content}${mark}${line.slice(lead.length + content.length)}`;
  }).join("\n");
}

/** HTML de Telegram (b, i, code, a) → texto de WhatsApp. */
export function toWhatsAppText(html: string): string {
  let text = html;
  for (const [pattern, replacement] of PHRASES) text = text.replace(pattern, replacement);
  text = text
    .replace(/<b>([\s\S]*?)<\/b>/g, (_m, inner: string) => wrap("*", inner))
    .replace(/<i>([\s\S]*?)<\/i>/g, (_m, inner: string) => wrap("_", inner))
    .replace(/<code>([\s\S]*?)<\/code>/g, "$1")
    .replace(/<a\s+href="([^"]+)">([\s\S]*?)<\/a>/g, "$2: $1")
    .replace(/<[^>]+>/g, "");
  return unescapeHtml(text);
}

function stripMark(data: string): string {
  return data.startsWith(NEW_MESSAGE_MARK) ? data.slice(NEW_MESSAGE_MARK.length) : data;
}

function keyFor(mode: WhatsAppMenu["mode"], index: number): string | null {
  if (mode === "num") return String(index + 1);
  return index < 26 ? String.fromCharCode(65 + index) : null;
}

export interface RenderedScreen {
  text: string;
  /** null = la pantalla no trae opciones (el menú anterior sigue vigente). */
  menu: WhatsAppMenu | null;
}

/** Una pantalla (texto HTML + botones) → un mensaje de WhatsApp con opciones. */
export function renderScreen(screen: Screen, mode: WhatsAppMenu["mode"]): RenderedScreen {
  const options: MenuOption[] = [];
  const digits: Record<string, string> = {};
  const links: string[] = [];
  for (const button of (screen.buttons ?? ([] as Keyboard)).flat()) {
    if (button.url) {
      if (/^https:\/\//.test(button.url)) links.push(`${toWhatsAppText(button.text)}: ${button.url}`);
      continue;
    }
    if (!button.callback_data) continue;
    const data = stripMark(button.callback_data);
    if (/^\d$/.test(button.text.trim())) {
      digits[button.text.trim()] = data;
      continue;
    }
    const key = keyFor(mode, options.length);
    if (!key) continue;
    options.push({ key, data, label: button.text });
  }

  const hasDigits = Object.keys(digits).length > 0;
  const lines = options.map((o) => `*${o.key}.* ${toWhatsAppText(o.label)}`);
  const hint = hasDigits
    ? options.length > 0
      ? "Responde con un número del 0 al 9, o con la letra de otra opción."
      : "Responde con un número del 0 al 9."
    : options.length === 0
      ? null
      : mode === "num"
        ? "Responde con el número de la opción."
        : "Responde con la letra de la opción.";
  const tail = [lines.length ? lines.join("\n") : null, hint ? `_${hint}_` : null, links.length ? links.join("\n") : null]
    .filter((part) => part !== null)
    .join("\n\n");

  let body = toWhatsAppText(screen.text).trim();
  const room = WHATSAPP_MAX_TEXT - (tail ? tail.length + 2 : 0);
  if (body.length > room) body = `${body.slice(0, Math.max(0, room - 1)).trimEnd()}…`;
  const text = tail ? `${body}\n\n${tail}` : body;
  const menu = options.length > 0 || hasDigits ? { mode, options, ...(hasDigits ? { digits } : {}) } : null;
  return { text, menu };
}

/** Lee un menú guardado (jsonb): todo lo que no tenga la forma esperada se descarta. */
export function parseMenu(value: unknown): WhatsAppMenu | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.mode !== "num" && raw.mode !== "abc") return null;
  const options = Array.isArray(raw.options)
    ? raw.options.filter((o): o is MenuOption =>
      typeof o === "object" && o !== null
      && typeof (o as MenuOption).key === "string"
      && typeof (o as MenuOption).data === "string" && (o as MenuOption).data.length <= 64
      && typeof (o as MenuOption).label === "string")
    : [];
  const digits: Record<string, string> = {};
  if (typeof raw.digits === "object" && raw.digits !== null && !Array.isArray(raw.digits)) {
    for (const [k, v] of Object.entries(raw.digits as Record<string, unknown>)) {
      if (/^\d$/.test(k) && typeof v === "string" && v.length <= 64) digits[k] = v;
    }
  }
  return { mode: raw.mode, options, ...(Object.keys(digits).length ? { digits } : {}) };
}

const KEYCAPS: Record<string, string> = {
  "0️⃣": "0", "1️⃣": "1", "2️⃣": "2", "3️⃣": "3", "4️⃣": "4", "5️⃣": "5", "6️⃣": "6", "7️⃣": "7", "8️⃣": "8", "9️⃣": "9", "🔟": "10",
};

/**
 * Respuesta corta → callback de la última pantalla, o null si es otra cosa
 * (un nombre, un marcador «2-1», un número de boleta…). Con labels, también
 * vale escribir el texto exacto de la opción («Inscribirme»).
 */
export function matchMenu(menu: WhatsAppMenu | null, text: string, options: { labels: boolean }): string | null {
  if (!menu) return null;
  let t = text.trim();
  for (const [cap, digit] of Object.entries(KEYCAPS)) t = t.split(cap).join(digit);
  t = t.replace(/[.)\s]+$/, "").trim();
  if (menu.digits && /^\d$/.test(t) && menu.digits[t]) return menu.digits[t];
  const key = menu.mode === "num" ? (/^\d{1,2}$/.test(t) ? String(Number(t)) : null) : (/^[a-z]$/i.test(t) ? t.toUpperCase() : null);
  if (key) return menu.options.find((o) => o.key === key)?.data ?? null;
  if (!options.labels) return null;
  const wanted = normalizeCommandText(t);
  if (!wanted) return null;
  return menu.options.find((o) => normalizeCommandText(o.label) === wanted)?.data ?? null;
}
