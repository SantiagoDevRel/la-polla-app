import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  sendMessage: vi.fn(),
  sendPhoto: vi.fn(),
  answerCallback: vi.fn(),
  editCaption: vi.fn(),
  rpc: vi.fn(),
  listPendingProofs: vi.fn(),
  listAllPollas: vi.fn(),
  getPot: vi.fn(),
  signedProofUrl: vi.fn(),
  rows: {} as Record<string, unknown>,
}));

vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/lib/casa/review-notify", () => ({ notifyCasaReview: vi.fn() }));
vi.mock("@/lib/telegram/notify", () => ({ signedProofUrl: mocks.signedProofUrl }));
vi.mock("@/lib/telegram/admin", () => ({ isLinkedAdmin: async () => true, touchAdmin: vi.fn(), tryLink: vi.fn(), unlink: vi.fn() }));
vi.mock("@/lib/telegram/bot", () => ({
  answerCallback: mocks.answerCallback, editCaption: mocks.editCaption, sendMessage: mocks.sendMessage, sendPhoto: mocks.sendPhoto,
  esc: (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
}));
vi.mock("@/lib/casa/queries", () => ({ getPot: mocks.getPot, listAllPollas: mocks.listAllPollas, listPendingProofs: mocks.listPendingProofs }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      const chain = {
        select: () => chain, eq: () => chain, is: () => chain, in: () => chain,
        single: async () => ({ data: mocks.rows[table] ?? null, error: null }),
        maybeSingle: async () => ({ data: mocks.rows[table] ?? null, error: null }),
      };
      return chain;
    },
  }),
}));

import { casaError, casaErrorMessage } from "@/lib/casa/operations";
import { updateSession } from "@/lib/supabase/middleware";
import { POST } from "@/app/api/telegram/webhook/route";
import { isLiveRefreshWindow, msUntilNextRefreshWindow } from "@/components/casa/PicksBoard";
import { readPicks, ResponseError } from "@/components/casa/MatchPicks";

const pollaId = "00000000-0000-4000-8000-000000000001";
const attemptId = "00000000-0000-4000-8000-000000000002";
const telegram = (body: unknown) => POST(new NextRequest("http://localhost/api/telegram/webhook", {
  method: "POST", headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": "secret" }, body: JSON.stringify(body),
}));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TELEGRAM_WEBHOOK_SECRET = "secret";
  process.env.NEXT_PUBLIC_APP_URL = "https://example.test";
  mocks.rows = {};
});

describe("Casa error messages", () => {
  // 107 rejects closing a scheduled pool that is not published yet with POLLA_NOT_PUBLISHED.
  it("maps POLLA_NOT_PUBLISHED to a known conflict", async () => {
    expect(casaErrorMessage({ message: "POLLA_NOT_PUBLISHED" })).toBe("Esta polla todavía no está publicada.");
    const response = casaError({ message: "POLLA_NOT_PUBLISHED", code: "55000" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "POLLA_NOT_PUBLISHED" });
  });
});

describe("middleware JSON exemption", () => {
  it("lets an expired session reach the match-picks JSON handler instead of redirecting", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const exempt = await updateSession(new NextRequest(`http://localhost/api/casa/pollas/demo/match-picks?match=${attemptId}`));
    expect(exempt.status).not.toBe(307);
    const guarded = await updateSession(new NextRequest("http://localhost/api/casa/pollas/demo/otra-cosa"));
    expect(guarded.status).toBe(307);
  });
});

describe("MatchPicks response handling", () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const failure = async (response: Response) => {
    try { await readPicks(response); } catch (error) { return error as ResponseError; }
    throw new Error("expected failure");
  };

  it("reads rows from a JSON success", async () => {
    await expect(readPicks(json({ rows: [], hasMore: true }))).resolves.toEqual({ rows: [], hasMore: true });
  });

  it("explains an ended session without a retry loop", async () => {
    expect(await failure(json({ error: "Sin sesión." }, 401))).toMatchObject({ message: "Tu sesión terminó. Vuelve a ingresar para ver los pronósticos.", retryable: false });
    const html = new Response("<html>login</html>", { status: 200, headers: { "Content-Type": "text/html" } });
    expect(await failure(html)).toMatchObject({ message: "No se pudieron cargar los pronósticos.", retryable: false });
  });

  it("offers a retry only for server failures", async () => {
    expect(await failure(json({ error: "Inscríbete para ver los pronósticos de esta polla." }, 403))).toMatchObject({ retryable: false });
    expect(await failure(json({ error: "No se pudieron cargar los pronósticos." }, 500))).toMatchObject({ retryable: true });
    const gateway = new Response("<html>502</html>", { status: 502, headers: { "Content-Type": "text/html" } });
    expect(await failure(gateway)).toMatchObject({ message: "No se pudieron cargar los pronósticos.", retryable: true });
  });
});

describe("PicksBoard refresh window", () => {
  const kickoff = Date.parse("2026-09-20T20:00:00Z");
  const base = { scheduled_at: new Date(kickoff).toISOString(), status: "scheduled", final_verified_at: null, voided_at: null };

  it("stays still days before kickoff and wakes 10 minutes before it", () => {
    const twoDaysBefore = kickoff - 2 * 86_400_000;
    expect(isLiveRefreshWindow(base, twoDaysBefore)).toBe(false);
    expect(msUntilNextRefreshWindow([base], twoDaysBefore)).toBe(2 * 86_400_000 - 10 * 60_000);
    expect(isLiveRefreshWindow(base, kickoff - 10 * 60_000)).toBe(true);
    expect(isLiveRefreshWindow(base, kickoff + 3 * 3_600_000)).toBe(true);
    expect(isLiveRefreshWindow(base, kickoff + 3 * 3_600_000 + 1)).toBe(false);
  });

  it("refreshes live or unverified finished matches and ignores settled ones", () => {
    const late = kickoff + 10 * 3_600_000;
    expect(isLiveRefreshWindow({ ...base, status: "live" }, late)).toBe(true);
    expect(isLiveRefreshWindow({ ...base, status: "finished" }, late)).toBe(true);
    expect(isLiveRefreshWindow({ ...base, status: "finished", final_verified_at: "2026-09-20T22:00:00Z" }, late)).toBe(false);
    expect(isLiveRefreshWindow({ ...base, status: "live", voided_at: "2026-09-20T22:00:00Z" }, late)).toBe(false);
    expect(msUntilNextRefreshWindow([{ ...base, final_verified_at: "2026-09-20T22:00:00Z" }], kickoff - 86_400_000)).toBeNull();
    expect(msUntilNextRefreshWindow([base], late)).toBeNull();
  });
});

describe("Telegram review of corrected payments", () => {
  const entry = { id: "entry", user_id: "user", polla_id: pollaId, current_proof_attempt_id: attemptId, proof_path: "proof.png", ticket_number: null, amount_cop: 10_000 };

  it("sends corrected payments to the web without approval buttons", async () => {
    mocks.listPendingProofs.mockResolvedValue([entry]);
    mocks.rows = { users: { display_name: "Ana" }, casa_pollas: { name: "Polla <Final>" }, casa_entry_proof_attempts: { proof_path: "proof.png", review_revision: 1 } };
    await telegram({ message: { chat: { id: 7 }, text: "/pendientes" } });
    expect(mocks.sendPhoto).not.toHaveBeenCalled();
    expect(mocks.signedProofUrl).not.toHaveBeenCalled();
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, buttons] = mocks.sendMessage.mock.calls[0];
    expect(chatId).toBe(7);
    expect(buttons).toBeUndefined();
    expect(text).toContain("Polla: Polla &lt;Final&gt;");
    expect(text).toContain(`Este pago fue corregido. Revísalo en la web: https://example.test/admin/pollas/recibos?pollaId=${pollaId}`);
  });

  it("keeps approval buttons for payments that were never corrected", async () => {
    mocks.listPendingProofs.mockResolvedValue([entry]);
    mocks.signedProofUrl.mockResolvedValue("https://signed.test/proof.png");
    mocks.rows = { users: { display_name: "Ana" }, casa_pollas: { name: "Polla" }, casa_entry_proof_attempts: { proof_path: "proof.png", review_revision: 0 } };
    await telegram({ message: { chat: { id: 7 }, text: "/pendientes" } });
    expect(mocks.sendPhoto).toHaveBeenCalledTimes(1);
    expect(mocks.sendPhoto.mock.calls[0][3]).toEqual([[{ text: "✅ Aprobar", callback_data: `ok2:${attemptId}` }, { text: "❌ Rechazar", callback_data: `no2:${attemptId}` }]]);
  });

  it("answers an old button on a corrected payment by pointing to the web", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "UPDATE_REQUIRED", code: "55000" } });
    await telegram({ callback_query: { id: "cb", data: `ok2:${attemptId}`, message: { message_id: 1, chat: { id: 7 } } } });
    expect(mocks.answerCallback).toHaveBeenCalledWith("cb", "Este pago fue corregido; revísalo desde la web.");
  });

  it("announces the Colombia publication date of a scheduled open polla", async () => {
    mocks.listAllPollas.mockResolvedValue([{ id: pollaId, name: "Programada", slug: "programada", status: "abierta", prize_kind: "pozo", opens_at: "2099-09-20T01:30:00Z", closes_at: "2099-09-21T01:30:00Z" }]);
    mocks.getPot.mockResolvedValue({ paid_entries: 0, prize_cop: 0, house_cop: 0 });
    await telegram({ message: { chat: { id: 7 }, text: "/pollas" } });
    const text = mocks.sendMessage.mock.calls[0][1] as string;
    expect(text).toMatch(/se publica el 19 de septiembre/);
    expect(text).not.toContain("cierra en");
  });
});
