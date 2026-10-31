import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const q = vi.hoisted(() => ({ getPollaById: vi.fn(), getMyEntry: vi.fn(), getPot: vi.fn(), getPayouts: vi.fn(), getPollaMatches: vi.fn(), getMyPicks: vi.fn() }));
vi.mock("@/lib/casa/queries", async original => ({ ...await original<object>(), ...q }));
vi.mock("@/lib/casa/tournaments", () => ({ getPollaTournamentSlugs: async () => ({}) }));
import { handleZernioPlayerEvent } from "@/lib/whatsapp-zernio/handler";
import { menuForScreen, parseZernioMenu, tidyText, visibleOptions, type ZernioContent } from "@/lib/whatsapp-zernio/format";
import { buildPickFlowJson, parsePickFlowResponse, pickFlowContent, pickFlowData, PICK_FLOW_SLOTS } from "@/lib/whatsapp-zernio/pick-flow";
import { parseZernioInbound } from "@/lib/whatsapp-zernio/inbound";
import { getZernioBotConfig } from "@/lib/whatsapp-zernio/config";
import { blocks, type PickForm } from "@/lib/telegram-player/context";
import { shortId } from "@/lib/telegram-player/ids";
import type { CasaEntry, CasaPick, CasaPolla } from "@/lib/casa/types";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const phone = ["57", "3", "0".repeat(9)].join("");
const conversationId = "b".repeat(24);
const flowId = "990480350128405";
afterEach(() => vi.resetAllMocks());

const form = (n: number): PickForm => ({
  pollaId: id(2), pollaName: "Polla de prueba", total: n, fallback: "e:x:y",
  matches: Array.from({ length: n }, (_, i) => ({ id: id(100 + i), home: `Local con nombre muy largo ${i}`, away: `Visitante ${i}`, when: "sáb 1 nov · 6:00 p. m.", current: i === 0 ? "empate" : null })),
});

describe("one-screen 1X2 WhatsApp Flow", () => {
  it("keeps the static Flow JSON inside Meta limits and posts every slot", () => {
    const json = buildPickFlowJson();
    const children = json.screens[0].layout.children;
    expect(children.length).toBeLessThanOrEqual(50);
    expect(children.filter(c => c.type === "RadioButtonsGroup")).toHaveLength(PICK_FLOW_SLOTS);
    const payload = (children.at(-1) as { "on-click-action": { payload: Record<string, string> } })["on-click-action"].payload;
    expect(Object.keys(payload)).toHaveLength(1 + 2 * PICK_FLOW_SLOTS);
    expect(payload.r20).toBe("${form.r20}");
  });

  it("fills visible slots within limits and hides the rest with valid values", () => {
    const data = pickFlowData(form(3));
    expect(data.v1).toBe(true); expect(data.v3).toBe(true); expect(data.v4).toBe(false);
    expect(String(data.l1).length).toBeLessThanOrEqual(30);
    expect((data.o1 as { title: string }[]).every(o => o.title.length <= 30)).toBe(true);
    expect(data.d1).toContain("Actual: empate");
    expect(data.o4).toEqual([{ id: "E", title: "-" }]);
    expect(String(pickFlowData(form(26)).intro)).toContain("20 de 26");
  });

  it("sends a Meta flow interactive (draft only when asked)", () => {
    const content = pickFlowContent(flowId, form(3), { token: "lp-picks:t" });
    expect(content.interactive?.type).toBe("flow");
    const action = content.interactive!.action as { name: string; parameters: Record<string, unknown> };
    expect(action.parameters).toMatchObject({ flow_id: flowId, flow_cta: "Pronosticar", flow_action: "navigate", flow_token: "lp-picks:t" });
    expect(action.parameters.mode).toBeUndefined();
    expect((pickFlowContent(flowId, form(3), { draft: true }).interactive!.action as { parameters: Record<string, unknown> }).parameters.mode).toBe("draft");
  });

  it("parses only this flow's answers and ignores malformed slots", () => {
    const answer = { flow_token: "lp-picks:abc", p: id(2), k1: id(3), r1: "L", k2: id(4), r2: "", k3: "nope", r3: "E", k4: id(3), r4: "V", k5: id(5), r5: "X" };
    expect(parsePickFlowResponse(answer)).toEqual({ pollaId: id(2), choices: [{ matchId: id(3), pick: "L" }] });
    expect(parsePickFlowResponse(JSON.stringify(answer))?.choices).toHaveLength(1);
    expect(parsePickFlowResponse({ ...answer, flow_token: "other" })).toBeNull();
    expect(parsePickFlowResponse({ ...answer, p: "x" })).toBeNull();
    expect(parsePickFlowResponse("not json")).toBeNull();
  });

  it("reads the flow id from env and the nfm_reply from the webhook metadata", () => {
    const env = { WHATSAPP_ZERNIO_BOT_ENABLED: "true", ZERNIO_WHATSAPP_ACCOUNT_ID: "a".repeat(24), ZERNIO_API_KEY: "k" };
    expect(getZernioBotConfig(env)!.pickFlowId).toBeNull();
    expect(getZernioBotConfig({ ...env, ZERNIO_WHATSAPP_PICKS_FLOW_ID: flowId })!.pickFlowId).toBe(flowId);
    expect(getZernioBotConfig({ ...env, ZERNIO_WHATSAPP_PICKS_FLOW_ID: "x;y" })!.pickFlowId).toBeNull();
    const now = Date.parse("2026-10-31T12:00:00Z");
    const parsed = parseZernioInbound({ id: "e", event: "message.received", account: { accountId: "a".repeat(24) }, conversation: { id: conversationId },
      metadata: { interactiveType: "nfm_reply", flowResponseData: { flow_token: "lp-picks:x" } },
      message: { id: "m", platform: "whatsapp", direction: "incoming", sentAt: new Date(now).toISOString(), sender: { id: phone, phoneNumber: `+${phone}` }, text: "Sent" } },
    { accountId: "a".repeat(24), apiKey: "k", allowedPhones: null }, now)!;
    expect(parsed.flowResponse).toEqual({ flow_token: "lp-picks:x" });
    expect(parsed.text).toBeNull(); expect(parsed.phone).toBe(phone);
  });

  it("formats WhatsApp copy in readable blocks", () => {
    expect(blocks(["*Polla*"], [null], ["Premio: 1", "Entrada: 2"], ["Listo."])).toBe("*Polla*\n\nPremio: 1\nEntrada: 2\n\nListo.");
    expect(tidyText("  Premio: 1 \n\n\n\n Entrada ")).toBe("Premio: 1\n\nEntrada");
  });
});

describe("form over the real shared router", () => {
  it("opens the form, saves all open picks at once and reports closed matches", async () => {
    const now = Date.now();
    const pool = { id: id(2), name: "Polla de prueba", slug: "prueba", status: "abierta", kind: "partidos", scoring_mode: "1x2", prize_kind: "pozo", entry_price_cop: 10000,
      opens_at: new Date(now - 10000).toISOString(), closes_at: new Date(now + 86_400_000).toISOString() } as CasaPolla;
    const at = (h: number) => new Date(now + h * 3_600_000).toISOString();
    const match = (n: number, h: number) => ({ id: id(n), home_team: `Local ${n}`, away_team: `Visitante ${n}`, scheduled_at: at(h), scheduled_at_confirmed: true, status: "scheduled", elapsed: null, voided_at: null, final_verified_at: null });
    const matches = [match(3, 48), match(4, 50), match(5, -1)];
    const entry = { id: id(4), status: "pagada", proof_path: "x" } as CasaEntry;
    let picks: CasaPick[] = [];
    const saved: unknown[] = [];
    const chat: Record<string, unknown> = { phone, user_id: id(1), flow: null, flow_data: null, flow_at: null, menu: null,
      zernio_last_inbound_at: new Date(now).toISOString(), zernio_conversation_id: conversationId };
    const db = {
      from: vi.fn((table: string) => {
        const query: Record<string, unknown> = {};
        for (const method of ["select", "eq", "gte", "limit", "or", "is", "in", "order"]) query[method] = () => query;
        query.update = (value: Record<string, unknown>) => { if (table === "whatsapp_bot_chats") Object.assign(chat, value); return query; };
        query.maybeSingle = async () => ({ data: table === "users" ? { display_name: "Jugador", avatar_url: "verde" } : chat, error: null });
        query.then = (resolve: (r: unknown) => void) => resolve({ data: [], error: null });
        return query;
      }),
      rpc: vi.fn(async (name: string, params: Record<string, unknown>) => {
        if (name === "whatsapp_zernio_claim") return { data: { outcome: "new", lease: id(9) }, error: null };
        if (name === "whatsapp_zernio_prepare") { if (params.p_menu) chat.menu = params.p_menu; return { data: true, error: null }; }
        if (name === "casa_my_entry_v2") return { data: entry, error: null };
        if (name === "casa_save_picks_v1") {
          const input = params.p_picks as { matchId: string; pick1x2: string }[];
          saved.push(input);
          picks = input.map(p => ({ match_id: p.matchId, pick_1x2: p.pick1x2, points_earned: 0 } as CasaPick));
          return { data: { ok: true, requestId: params.p_request_id, revision: 1, guardados: input.length, avisos: [], results: input.map(p => ({ targetId: p.matchId, status: "saved", values: { pick1x2: p.pick1x2, homeScore: null, awayScore: null, optionId: null, freeText: null } })) }, error: null };
        }
        throw new Error(`Unexpected RPC ${name}`);
      }),
    };
    q.getPollaById.mockResolvedValue(pool); q.getMyEntry.mockResolvedValue(entry);
    q.getMyPicks.mockImplementation(async () => picks); q.getPollaMatches.mockResolvedValue(matches);
    q.getPot.mockResolvedValue({ prize_cop: 50000, paid_entries: 5 }); q.getPayouts.mockResolvedValue([]);
    const sent: ZernioContent[] = [];
    let index = 0;
    const deps = (pickFlowId: string | null) => ({
      db: db as never, config: { accountId: "a".repeat(24), apiKey: "k", allowedPhones: null, pickFlowId }, now: () => now, login: vi.fn(),
      send: async (_c: unknown, _v: unknown, content: ZernioContent) => { sent.push(content); },
    });
    const run = async (event: { selection?: string; flowResponse?: unknown }, pickFlowId: string | null = flowId) => {
      sent.length = 0;
      expect(await handleZernioPlayerEvent({ key: `k-${index++}`, phone, conversationId, sentAt: new Date(now).toISOString(), text: null, selection: event.selection ?? null, attachment: null, flowResponse: event.flowResponse }, deps(pickFlowId))).toBe("sent");
    };
    const P = shortId(pool.id);
    const tap = async (data: string, pickFlowId?: string | null) => {
      chat.menu = menuForScreen({ text: "x", buttons: [[{ text: "Pronosticar", callback_data: data }]] }).menu;
      await run({ selection: visibleOptions(parseZernioMenu(chat.menu)!).find(o => o.data === data)!.id }, pickFlowId);
    };

    await tap(`pk:${P}`);
    expect(sent[0].interactive?.type).toBe("flow");
    const data = (sent[0].interactive!.action as unknown as { parameters: { flow_action_payload: { data: Record<string, unknown> } } }).parameters.flow_action_payload.data;
    expect([data.k1, data.k2, data.v3]).toEqual([id(3), id(4), false]);
    expect(visibleOptions(parseZernioMenu(chat.menu)!).map(o => o.label)).toContain("Uno por uno");

    await run({ flowResponse: { flow_token: "lp-picks:x", p: pool.id, k1: id(3), r1: "L", k2: id(4), r2: "E", k3: id(5), r3: "V", k4: id(99), r4: "L" } });
    expect(saved).toEqual([[expect.objectContaining({ matchId: id(3), pick1x2: "L" }), expect.objectContaining({ matchId: id(4), pick1x2: "E" })]]);
    const text = sent.map(c => c.message ?? c.interactive?.body.text ?? "").join("\n");
    expect(text).toContain("Guardamos 2 pronósticos");
    expect(text).toContain("Local 3 vs Visitante 3: gana Local 3");
    expect(text).toContain("2 partidos ya cerraron");

    // Without a configured flow the same button keeps the per-match screens.
    await tap(`pk:${P}`, null);
    expect(sent.some(c => c.interactive?.type === "flow")).toBe(false);
  });
});
