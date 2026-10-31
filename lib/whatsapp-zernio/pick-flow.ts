// lib/whatsapp-zernio/pick-flow.ts — 1X2 picks for a whole pool in one native
// WhatsApp Flow (a form inside the chat): one radio group per match and a single
// «Guardar». The Flow JSON is static and published once (scripts/zernio-pick-flow.mjs);
// each message fills its slots through flow_action_payload. The response is only
// a request: the shared saver re-checks entry, pool and every match lock.

import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { PickForm } from "@/lib/telegram-player/context";
import type { ZernioContent } from "./format";
import { PICK_FLOW_SCREEN, PICK_FLOW_SLOTS, PICK_FLOW_TOKEN_PREFIX } from "./pick-flow-json";

export { buildPickFlowJson, PICK_FLOW_SCREEN, PICK_FLOW_SLOTS, PICK_FLOW_TOKEN_PREFIX } from "./pick-flow-json";

const CHOICES = ["L", "E", "V"] as const;

const segmenter = new Intl.Segmenter("es", { granularity: "grapheme" });
function fit(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  let out = "";
  for (const { segment } of segmenter.segment(clean)) {
    if (out.length + segment.length > limit - 1) break;
    out += segment;
  }
  return `${out.trimEnd()}…`;
}

const slots = Array.from({ length: PICK_FLOW_SLOTS }, (_, i) => i + 1);

/** Data for one message. Hidden slots still need valid, non-empty values. */
export function pickFlowData(form: PickForm): Record<string, unknown> {
  const shown = form.matches.slice(0, PICK_FLOW_SLOTS);
  const rest = form.total - shown.length;
  const data: Record<string, unknown> = {
    p: form.pollaId,
    intro: [
      "Escoge quién gana en cada partido y toca Guardar.",
      "Los que dejes sin marcar no cambian.",
      rest > 0 ? `Aquí van ${shown.length} de ${form.total} partidos. Después de guardar, toca Pronosticar para ver el resto.` : null,
    ].filter(Boolean).join("\n"),
  };
  slots.forEach((n, i) => {
    const match = shown[i];
    data[`k${n}`] = match?.id ?? "";
    data[`l${n}`] = match ? fit(`${match.home} vs ${match.away}`, 30) : "-";
    data[`d${n}`] = match ? fit([match.when, match.current ? `Actual: ${match.current}` : null].filter(Boolean).join(" · "), 300) : "-";
    data[`o${n}`] = match
      ? [{ id: "L", title: fit(`Gana ${match.home}`, 30) }, { id: "E", title: "Empate" }, { id: "V", title: fit(`Gana ${match.away}`, 30) }]
      : [{ id: "E", title: "-" }];
    data[`v${n}`] = Boolean(match);
  });
  return data;
}

/** Inbox `interactive` object, Meta Cloud API shape (Zernio forwards it verbatim). */
export function pickFlowContent(flowId: string, form: PickForm, options: { draft?: boolean; token?: string } = {}): ZernioContent {
  const count = Math.min(form.total, PICK_FLOW_SLOTS);
  return {
    interactive: {
      type: "flow",
      body: { text: [`*${form.pollaName}*`, "", `${form.total} ${form.total === 1 ? "partido abierto" : "partidos abiertos"}.`,
        count > 1 ? "Toca Pronosticar y escoge todos de una vez." : "Toca Pronosticar para escoger."].join("\n") },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_token: options.token ?? `${PICK_FLOW_TOKEN_PREFIX}${randomBytes(8).toString("hex")}`,
          flow_id: flowId, flow_cta: "Pronosticar", flow_action: "navigate",
          flow_action_payload: { screen: PICK_FLOW_SCREEN, data: pickFlowData(form) },
          ...(options.draft ? { mode: "draft" } : {}),
        },
      },
    },
  };
}

const uuid = z.string().uuid();
const responseSchema = z.record(z.string().max(80), z.unknown());

export interface PickFlowResponse { pollaId: string; choices: { matchId: string; pick: (typeof CHOICES)[number] }[] }

/** Only this flow's token. Unknown keys, malformed ids and unchosen slots are ignored. */
export function parsePickFlowResponse(value: unknown): PickFlowResponse | null {
  let raw: unknown = value;
  if (typeof raw === "string") {
    if (raw.length > 20_000) return null;
    try { raw = JSON.parse(raw); } catch { return null; }
  }
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) return null;
  const data = parsed.data;
  if (typeof data.flow_token !== "string" || !data.flow_token.startsWith(PICK_FLOW_TOKEN_PREFIX)) return null;
  const pollaId = uuid.safeParse(data.p);
  if (!pollaId.success) return null;
  const seen = new Set<string>();
  const choices: PickFlowResponse["choices"] = [];
  for (const n of slots) {
    const matchId = uuid.safeParse(data[`k${n}`]);
    const pick = data[`r${n}`];
    if (!matchId.success || typeof pick !== "string" || !(CHOICES as readonly string[]).includes(pick) || seen.has(matchId.data)) continue;
    seen.add(matchId.data);
    choices.push({ matchId: matchId.data, pick: pick as PickFlowResponse["choices"][number]["pick"] });
  }
  return { pollaId: pollaId.data, choices };
}
