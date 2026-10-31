import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Screen } from "@/lib/telegram-player/context";
import { NEW_MESSAGE_MARK } from "@/lib/telegram-player/ids";
import { toWhatsAppText, type WhatsAppMenu } from "./format";

const choice = z.object({ label: z.string().min(1).max(100), data: z.string().min(1).max(64) });
const sourceChoice = choice.extend({ label: z.string().min(1).max(1000) });
const menuSchema = z.object({
  openwa: z.literal(1), nonce: z.string().regex(/^[a-f0-9]{32}$/),
  mode: z.enum(["num", "abc"]), body: z.string().max(16000),
  source: z.array(sourceChoice).max(1000), page: z.number().int().min(0).max(1000),
  options: z.array(choice.extend({ key: z.string().min(1).max(2) })).min(2).max(12),
  digits: z.record(z.string(), z.string().max(64)).optional(),
});
export type OpenWaMenu = z.infer<typeof menuSchema>;
export interface OpenWaPoll {
  nonce: string;
  name: string;
  options: string[];
  allowMultipleAnswers: false;
}
export const POLL_PAGE_PREFIX = "wapage:";

const segmenter = new Intl.Segmenter("es", { granularity: "grapheme" });
function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let result = "";
  for (const { segment } of segmenter.segment(text)) {
    if (result.length + segment.length > limit - 1) break;
    result += segment;
  }
  return `${result.trimEnd()}…`;
}
function label(text: string): string {
  return toWhatsAppText(text).replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "").replace(/\s+/g, " ").trim();
}
export function parseOpenWaMenu(value: unknown): OpenWaMenu | null {
  const result = menuSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** Poll labels are also the exact keys returned by poll.vote. Keep them unique. */
export function renderOpenWaMenu(input: Pick<OpenWaMenu, "body" | "source" | "mode" | "page">): {
  text: string; menu: OpenWaMenu; poll: OpenWaPoll;
} {
  const main = input.source.filter(o => o.data !== "m");
  const paged = main.length > 11;
  const size = paged ? 9 : 11;
  const page = Math.max(0, Math.min(input.page, Math.ceil(main.length / size) - 1));
  const rows = main.slice(page * size, (page + 1) * size);
  if (page > 0) rows.push({ label: "Anterior", data: `${POLL_PAGE_PREFIX}${page - 1}` });
  if ((page + 1) * size < main.length) rows.push({ label: "Más", data: `${POLL_PAGE_PREFIX}${page + 1}` });
  rows.push({ label: "Menú", data: "m" });
  // WhatsApp requires at least two choices, including for a free-text prompt.
  if (rows.length === 1) rows.unshift({ label: "Ayuda", data: "hp" });
  const navigationLabels = new Set(rows.filter(o => o.data === "m" || o.data.startsWith(POLL_PAGE_PREFIX)).map(o => o.label));
  const used = new Set<string>();
  const options = rows.map((o, i) => {
    const base = label(o.label) || "Ver opción";
    let title = truncate(base, 100);
    if (used.has(title) || (o.data !== "m" && !o.data.startsWith(POLL_PAGE_PREFIX) && navigationLabels.has(title))) {
      title = truncate(`${i + 1}. ${base}`, 100);
    }
    let suffix = 1;
    while (used.has(title)) title = truncate(`${i + 1}.${suffix++}. ${base}`, 100);
    used.add(title);
    return { key: input.mode === "abc" ? String.fromCharCode(65 + i) : String(i + 1), label: title, data: o.data };
  });
  const digits = Object.fromEntries(main.filter(o => /^\d$/.test(o.label)).map(o => [o.label, o.data]));
  const menu: OpenWaMenu = {
    openwa: 1, nonce: randomBytes(16).toString("hex"), body: input.body,
    source: input.source, mode: input.mode, page, options,
    ...(Object.keys(digits).length ? { digits } : {}),
  };
  const tail = options.map(o => `*${o.key}.* ${o.label}`).join("\n")
    + `\n\n_Elige una opción o escribe su ${input.mode === "abc" ? "letra" : "número"}. Escribe «menú» para volver._`;
  const body = truncate(input.body.trim() || "Elige una opción.", 4096 - tail.length - 2);
  return {
    text: `${body}\n\n${tail}`, menu,
    poll: { nonce: menu.nonce, name: truncate(body.split("\n")[0].replace(/[*_]/g, ""), 255) || "Elige una opción.",
      options: options.map(o => o.label), allowMultipleAnswers: false },
  };
}

export function renderOpenWaScreen(screen: Screen, mode: WhatsAppMenu["mode"]) {
  const source: OpenWaMenu["source"] = [];
  const links: string[] = [];
  for (const button of (screen.buttons ?? []).flat()) {
    if (button.url && /^https:\/\//.test(button.url)) links.push(`${label(button.text)}: ${button.url}`);
    else if (button.callback_data) {
      const data = button.callback_data.startsWith(NEW_MESSAGE_MARK) ? button.callback_data.slice(NEW_MESSAGE_MARK.length) : button.callback_data;
      if (data && data.length <= 64) source.push({ label: label(button.text) || "Ver opción", data });
    }
  }
  const body = [toWhatsAppText(screen.compactText ?? screen.text).trim(), ...links].join("\n\n");
  return renderOpenWaMenu({ body, source, mode, page: 0 });
}
