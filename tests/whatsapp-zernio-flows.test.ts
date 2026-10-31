import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const q = vi.hoisted(() => ({ listPublicPollas: vi.fn(), getPollaById: vi.fn(), getMyEntry: vi.fn(), getPot: vi.fn(), getPots: vi.fn(), getPayouts: vi.fn(), getPollaMatches: vi.fn(), getMyPicks: vi.fn(), getLeaderboard: vi.fn() }));
const proof = vi.hoisted(() => ({ beginCasaProof: vi.fn(), confirmCasaProof: vi.fn(), failCasaProof: vi.fn(), readOwnedProofAttempt: vi.fn() }));
const mine = vi.hoisted(() => vi.fn());
vi.mock("@/lib/casa/queries", async original => ({ ...await original<object>(), ...q }));
vi.mock("@/lib/casa/proof-server", () => proof);
vi.mock("@/lib/casa/tournaments", () => ({ getPollaTournamentSlugs: async () => ({}) }));
vi.mock("@/lib/casa/my-pollas", () => ({ listMyPollas: mine }));
import { handleZernioPlayerEvent } from "@/lib/whatsapp-zernio/handler";
import { visibleOptions, parseZernioMenu, type ZernioContent } from "@/lib/whatsapp-zernio/format";
import { shortId } from "@/lib/telegram-player/ids";
import type { CasaEntry, CasaPick, CasaPolla } from "@/lib/casa/types";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const phone = ["57", "3", "0".repeat(9)].join("");
const config = { accountId: "a".repeat(24), apiKey: "test-key", allowedPhones: null };
const conversationId = "b".repeat(24);
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
afterEach(() => vi.resetAllMocks());

describe("real shared player router over the Zernio channel", () => {
  it.each([
    { free: false, scoring: "marcador" }, { free: true, scoring: "marcador" },
    { free: false, scoring: "1x2" }, { free: true, scoring: "1x2" },
  ])("onboards → lists → joins ($free free, $scoring) → saves and changes picks → table → account screens", async ({ free, scoring }) => {
    const now = Date.now();
    const profile: Record<string, unknown> = { display_name: null, avatar_url: null };
    const chat: Record<string, unknown> = { phone, user_id: null, flow: null, flow_data: null, flow_at: null, menu: null,
      zernio_last_inbound_at: new Date(now).toISOString(), zernio_conversation_id: conversationId };
    const pool = { id: id(2), name: "Polla de prueba con nombre completo muy largo", slug: "prueba", status: "abierta", kind: "partidos", scoring_mode: scoring, prize_kind: "pozo", entry_price_cop: free ? 0 : 10000,
      payout_method: "nequi", payout_account: "TEST-ACCOUNT", payout_account_name: "Titular de prueba", opens_at: new Date(now - 10000).toISOString(), closes_at: new Date(now + 86_400_000).toISOString() } as CasaPolla;
    const match = { id: id(3), home_team: "Local", away_team: "Visitante", scheduled_at: new Date(now + 2 * 86_400_000).toISOString(), scheduled_at_confirmed: true, status: "scheduled", elapsed: null, voided_at: null, final_verified_at: null };
    let entry: CasaEntry | null = null;
    let picks: CasaPick[] = [];
    let media: Record<string, unknown> | null = null;
    const writes: string[] = [];
    const sent: ZernioContent[] = [];
    const upload = vi.fn(async (): Promise<{ error: { message: string } | null }> => ({ error: null }));
    const db = {
      from: vi.fn((table: string) => {
        const query: Record<string, unknown> = {};
        for (const method of ["select", "eq", "gte", "limit", "or", "is", "in", "order"]) query[method] = () => query;
        query.update = (value: Record<string, unknown>) => { writes.push(table); Object.assign(table === "users" ? profile : chat, value); return query; };
        query.insert = (value: Record<string, unknown>) => { writes.push(table); media = value; return query; };
        query.maybeSingle = async () => ({ data: table === "users" ? profile : table === "whatsapp_bot_media" ? media : chat, error: null });
        query.single = async () => ({ data: { id: id(5) }, error: null });
        query.then = (resolve: (result: unknown) => void) => resolve({ data: table === "casa_entries" && entry ? [{ ...entry, polla_id: pool.id, created_at: new Date(now).toISOString(), casa_pollas: pool }] : [], error: null });
        return query;
      }),
      rpc: vi.fn(async (name: string, params: Record<string, unknown>) => {
        if (name === "whatsapp_zernio_claim") return { data: { outcome: "new", lease: id(9) }, error: null };
        if (name === "whatsapp_zernio_prepare") { if (params.p_menu) chat.menu = params.p_menu; return { data: true, error: null }; }
        if (name === "casa_my_entry_v2") return { data: entry, error: null };
        if (name === "casa_join_free_v1") {
          entry = { id: id(4), status: "pagada", proof_path: null, amount_cop: 0, origin: "compra" } as CasaEntry;
          return { data: { entry_id: id(4) }, error: null };
        }
        if (name === "casa_save_picks_v1") {
          const input = (params.p_picks as Array<{ homeScore?: number; awayScore?: number; pick1x2?: string }>)[0];
          picks = [{ match_id: match.id, home_score: input.homeScore, away_score: input.awayScore, pick_1x2: input.pick1x2, points_earned: 0 } as CasaPick];
          return { data: { ok: true, requestId: params.p_request_id, revision: 1, guardados: 1, avisos: [], results: [] }, error: null };
        }
        throw new Error(`Unexpected RPC ${name}`);
      }),
      storage: { from: () => ({ upload }) },
    };
    q.listPublicPollas.mockResolvedValue([pool]); q.getPollaById.mockResolvedValue(pool);
    q.getMyEntry.mockImplementation(async () => entry); q.getMyPicks.mockImplementation(async () => picks);
    q.getPollaMatches.mockResolvedValue([match]);
    q.getPot.mockResolvedValue({ prize_cop: 50000, paid_entries: 5 }); q.getPots.mockResolvedValue({ [pool.id]: { prize_cop: 50000 } });
    q.getPayouts.mockResolvedValue([]); q.getLeaderboard.mockResolvedValue([{ puesto: 1, user_id: id(1), display_name: "Jugador de prueba", points: 7 }]);
    mine.mockImplementation(async () => entry ? [{ ...pool, entry_status: entry.status }] : []);
    proof.beginCasaProof.mockResolvedValue({ data: { state: "uploading", proof_path: "test/proof.png", attempt_id: id(6) }, error: null });
    proof.readOwnedProofAttempt.mockResolvedValue({ data: { id: id(6), entry_id: id(4), proof_path: "test/proof.png" }, error: null });
    proof.confirmCasaProof.mockImplementation(async () => {
      entry = { id: id(4), status: "pendiente", proof_path: "test/proof.png" } as CasaEntry;
      return { ok: true, data: { entry_status: "pendiente" } };
    });
    const resolveAccount = vi.fn().mockResolvedValue({ ok: true, authUserId: id(1) });
    let downloadResult: { ok: true; bytes: Buffer; mime: string } | { ok: false; reason: string } = { ok: true, bytes: png, mime: "image/png" };
    let index = 0;
    const input = async (text: string | null, selection: string | null = null, attachment: { type: string; url: string } | null = null) => {
      sent.length = 0;
      expect(await handleZernioPlayerEvent({ key: `test-${index++}`, phone, conversationId, sentAt: new Date(now).toISOString(), text, selection, attachment }, {
        db: db as never, config, now: () => now, resolveAccount, login: vi.fn(),
        send: async (_config, _conversation, content) => { sent.push(content); },
        download: vi.fn().mockImplementation(async () => downloadResult),
      })).toBe("sent");
      expect(sent.every(c => c.interactive?.type !== "cta_url")).toBe(true);
      const menu = parseZernioMenu(chat.menu)!;
      expect(menu.options.some(o => o.data === "m") || menu.options.some(o => o.data === "zmore")).toBe(true);
    };
    const click = async (callback: string) => {
      const menu = parseZernioMenu(chat.menu)!;
      const option = visibleOptions(menu).find(o => o.data === callback);
      expect(option, `Missing action ${callback}`).toBeTruthy();
      await input(null, option!.id);
    };
    const body = () => sent.map(c => c.message ?? c.interactive?.body.text ?? "").join("\n");

    await input("hola"); expect(chat.flow).toBe("name"); expect(body()).toContain("Escribe tu nombre");
    await input("Jugador de prueba"); expect(profile.display_name).toBe("Jugador de prueba"); expect(body()).toContain("Elige tu pollito");
    await click("pa:verde:o"); expect(profile.avatar_url).toBe("verde");
    await click("ml:0"); expect(body()).toContain("Aún no tienes pollas");
    expect(parseZernioMenu(chat.menu)!.options[0].label).toBe("Pollas disponibles");
    await click("ol:0"); expect(body()).toContain("Pollas disponibles");
    const listed = sent.at(-1)!.interactive!;
    if (!("sections" in listed.action)) throw new Error("Expected pool list");
    const row = listed.action.sections[0].rows[0];
    expect(row.title + row.description!.split(" · ")[0]).toBe(pool.name);
    expect(row.description).toContain(free ? "Gratis" : "10.000");
    await click(`p:${shortId(pool.id)}`); expect(body()).toContain("50.000");
    expect(body().match(/50\.000/g)).toHaveLength(1);
    await click(`j:${shortId(pool.id)}`);
    if (free) {
      expect(body()).toContain("ya estás inscrito");
      expect(body()).not.toContain("TEST-ACCOUNT");
      expect(proof.beginCasaProof).not.toHaveBeenCalled();
      expect(upload).not.toHaveBeenCalled();
    } else {
      expect(chat.flow).toBe("proof"); expect(body()).toContain("TEST-ACCOUNT"); expect(body()).toContain("10.000");
      expect(body()).toContain("3 MB");
      const attachment = { type: "document", url: "https://zernio.com/api/v1/whatsapp/media/123" };
      for (const reason of ["unsupported", "too_large", "download"]) {
        downloadResult = { ok: false, reason };
        await input(null, null, attachment);
        expect(proof.beginCasaProof).not.toHaveBeenCalled();
        expect(body()).toContain(reason === "unsupported" ? "captura de pantalla" : reason === "too_large" ? "3 MB" : "descargar");
        expect(chat.flow).toBe("proof");
        await click("zretry"); expect(chat.flow).toBe("proof");
        expect(body()).toContain("No repitas la transferencia");
      }
      downloadResult = { ok: true, bytes: png, mime: "image/png" };
      upload.mockResolvedValueOnce({ error: { message: "connection failed" } });
      await input(null, null, attachment);
      expect(body()).toContain("No pudimos guardar"); expect(chat.flow).toBe("proof");
      await input(null, null, attachment);
      expect(proof.beginCasaProof).toHaveBeenCalledWith(db, expect.objectContaining({ userId: id(1), pollaId: pool.id, contentType: "image/png", bytes: png.length }));
      expect(proof.confirmCasaProof).toHaveBeenCalled(); expect(upload).toHaveBeenCalledWith("test/proof.png", png, { contentType: "image/png", upsert: false });
      expect(body()).toContain("Recibimos tu comprobante");
    }
    const P = shortId(pool.id), M = shortId(match.id);
    await click(`pk:${P}`);
    if (scoring === "marcador") {
      expect(chat.flow).toBe("score"); expect(body()).toContain("2-1");
      await input("invalid"); expect(body()).toContain("2-1"); expect(chat.flow).toBe("score");
      await input("2-1");
    } else {
      expect(body()).toContain("¿Quién gana?");
      await click(`x:${P}:${M}:L`);
    }
    expect(body()).toContain("Guardado");
    expect(db.rpc).toHaveBeenCalledWith("casa_save_picks_v1", expect.objectContaining({ p_user_id: id(1), p_entry_id: id(4), p_request_id: expect.any(String),
      p_picks: [expect.objectContaining(scoring === "marcador" ? { homeScore: 2, awayScore: 1 } : { pick1x2: "L" })] }));
    await click(`ls:${shortId(pool.id)}`); await click(`e:${shortId(pool.id)}:${shortId(match.id)}`);
    if (scoring === "marcador") {
      await input("0-0"); expect(picks[0]).toMatchObject({ home_score: 0, away_score: 0 });
    } else {
      await click(`x:${P}:${M}:E`); expect(picks[0].pick_1x2).toBe("E");
    }
    await click(`tb:${shortId(pool.id)}`); expect(body()).toContain("7 puntos"); expect(body()).toContain("tú");
    expect(body()).toContain("1. Jugador de prueba");
    await click("m"); await click("ml:0");
    const myMenu = parseZernioMenu(chat.menu)!;
    expect(myMenu.options[0].listRow?.title).toBe(pool.name);
    expect(myMenu.options[0].listRow?.description).toContain(free ? "Inscrito" : "Pago pendiente");
    await click("m"); await click("zmore"); await click("pg");
    expect(body()).toContain(pool.name); expect(body()).toContain(free ? "cortesía" : "en revisión");
    await click("m"); await click("zmore"); await click("pf");
    expect(body()).toContain("Jugador de prueba"); expect(body()).toContain("Cuenta para premios");
    expect(parseZernioMenu(chat.menu)!.options.some(o => o.data === "web")).toBe(false);
    await click("m"); await click("zmore"); await click("hp");
    expect(body()).toContain("5 minutos"); expect(body()).toContain("Soporte");
    expect(resolveAccount).toHaveBeenCalledExactlyOnceWith(`+${phone}`, "whatsapp-bot", db);
    expect(writes).not.toContain("predictions"); expect(writes).not.toContain("casa_picks");
  });
});
