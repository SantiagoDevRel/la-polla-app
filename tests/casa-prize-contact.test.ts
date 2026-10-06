import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn(), polla: vi.fn(), entry: vi.fn() }));
vi.mock("@/lib/auth/admin", () => ({ getAuthenticatedUser: mocks.auth }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/casa/queries", () => ({ getPollaBySlug: mocks.polla, getMyEntry: mocks.entry }));
import { GET, POST } from "@/app/api/casa/pollas/[slug]/prize-contact/route";
import { GET as adminGET } from "@/app/api/casa/admin/pollas/[id]/prize-contacts/route";
import { QUENTRO_POLLA_ID, prizeContactSchema } from "@/lib/casa/prize-contact";

const context = { params: Promise.resolve({ slug: "polla-regalo" }) };
const adminContext = { params: Promise.resolve({ id: QUENTRO_POLLA_ID }) };
const read = () => new Request("https://lapollacolombiana.com/api/casa/pollas/polla-regalo/prize-contact");
function write(body: unknown) {
  return new Request(read(), { method: "POST", headers: { "Content-Type": "application/json", "X-Casa-Contract": "2" }, body: JSON.stringify(body) });
}
function query(data: unknown, error: unknown = null) {
  const result = { data, error };
  const q = { select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(), maybeSingle: vi.fn().mockResolvedValue(result), then: Promise.resolve(result).then.bind(Promise.resolve(result)) };
  q.select.mockReturnValue(q); q.eq.mockReturnValue(q); q.in.mockReturnValue(q); q.order.mockReturnValue(q);
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ id: "self", is_admin: false });
  mocks.polla.mockResolvedValue({ id: QUENTRO_POLLA_ID, prize_kind: "objeto", status: "cerrada" });
  mocks.entry.mockResolvedValue({ status: "pagada" });
});

describe("private Quentro contact", () => {
  it("requires a real address and matching confirmation, never accepts client identity", () => {
    expect(prizeContactSchema.safeParse({ email: "a", confirmation: "a" }).success).toBe(false);
    expect(prizeContactSchema.safeParse({ email: "one@example.com", confirmation: "two@example.com" }).success).toBe(false);
    expect(prizeContactSchema.safeParse({ email: "one@example.com", confirmation: "one@example.com", user_id: "someone" }).success).toBe(false);
    expect(prizeContactSchema.parse({ email: " one+ticket@example.com ", confirmation: "one+ticket@example.com" }).email).toBe("one+ticket@example.com");
  });

  it("denies anonymous reads/writes before application data access", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET(read(), context)).status).toBe(401);
    expect((await POST(write({}), context)).status).toBe(401);
    expect(mocks.polla).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("rejects unrelated or unavailable pollas and nonparticipants", async () => {
    for (const polla of [null, { id: "different", prize_kind: "objeto" }, { id: QUENTRO_POLLA_ID, prize_kind: "pozo" }]) {
      mocks.polla.mockResolvedValue(polla);
      expect((await GET(read(), context)).status).toBe(403);
    }
    mocks.polla.mockResolvedValue({ id: QUENTRO_POLLA_ID, prize_kind: "objeto", status: "cerrada" });
    for (const status of ["pendiente", "rechazada", "anulada"]) {
      mocks.entry.mockResolvedValue({ status });
      expect((await GET(read(), context)).status).toBe(403);
    }
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("reads only the session owner, requires no cache and does not declare a leader winner", async () => {
    const contact = query({ email: "owner@example.com" }); const payout = query(null);
    mocks.admin.mockReturnValue({ from: vi.fn().mockReturnValueOnce(contact).mockReturnValueOnce(payout) });
    const result = await GET(read(), context);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(await result.json()).toEqual({ owner_id: "self", email: "owner@example.com", winner: false, editable: true, revision: 0, request_id: null });
    for (const q of [contact, payout]) {
      expect(q.eq).toHaveBeenCalledWith("polla_id", QUENTRO_POLLA_ID);
      expect(q.eq).toHaveBeenCalledWith("user_id", "self");
    }
  });

  it("saves the server session id through the constrained RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { email: "owner@example.com", winner: false, editable: true }, error: null });
    mocks.admin.mockReturnValue({ rpc });
    const result = await POST(write({ email: "owner@example.com", confirmation: "owner@example.com" }), context);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ owner_id: "self", email: "owner@example.com", winner: false, editable: true });
    expect(rpc).toHaveBeenCalledWith("casa_save_prize_contact", { p_polla_id: QUENTRO_POLLA_ID, p_user_id: "self", p_email: "owner@example.com" });
  });

  it("blocks a retained draft from another account before application data access", async () => {
    const request = write({ email: "owner@example.com", confirmation: "owner@example.com" });
    request.headers.set("X-Casa-Owner", "previous-owner");
    const response = await POST(request, context);
    expect(response.status).toBe(412);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ code: "SESSION_CHANGED" });
    expect(mocks.polla).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("recognizes another account on verification before participant or contact access", async () => {
    const request = read(); request.headers.set("X-Casa-Owner", "previous-owner");
    const response = await GET(request, context);
    expect(response.status).toBe(412); expect(await response.json()).toMatchObject({ code: "SESSION_CHANGED" });
    expect(mocks.polla).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("returns authoritative contact revision and request identity on owner-scoped reads", async () => {
    const requestId = "91b95911-724a-4dd3-bf5f-8c3ca740f72b";
    const contact = query({ email: "owner@example.com", save_revision: 3, last_request_id: requestId });
    mocks.admin.mockReturnValue({ from: vi.fn().mockReturnValueOnce(contact).mockReturnValueOnce(query(null)) });
    expect(await (await GET(read(), context)).json()).toEqual({ owner_id: "self", email: "owner@example.com", winner: false,
      editable: true, revision: 3, request_id: requestId });
    expect(contact.select).toHaveBeenCalledWith("email, save_revision, last_request_id");
  });

  it("uses the CAS writer for a new request while preserving the old request path", async () => {
    const requestId = "91b95911-724a-4dd3-bf5f-8c3ca740f72b";
    const acknowledgement = { email: "owner@example.com", winner: false, editable: true, revision: 1, request_id: requestId };
    const rpc = vi.fn().mockResolvedValue({ data: acknowledgement, error: null }); mocks.admin.mockReturnValue({ rpc });
    const response = await POST(write({ email: "owner@example.com", confirmation: "owner@example.com", requestId, expectedRevision: 0 }), context);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ ...acknowledgement, owner_id: "self" });
    expect(rpc).toHaveBeenCalledWith("casa_save_prize_contact_v2", { p_polla_id: QUENTRO_POLLA_ID, p_user_id: "self", p_email: "owner@example.com",
      p_request_id: requestId, p_expected_revision: 0 });
  });

  it("does not discard partial metadata or mismatched confirmation before the CAS write", async () => {
    const requestId = "91b95911-724a-4dd3-bf5f-8c3ca740f72b";
    for (const body of [
      { email: "owner@example.com", confirmation: "owner@example.com", requestId },
      { email: "owner@example.com", confirmation: "owner@example.com", expectedRevision: 0 },
      { email: "owner@example.com", confirmation: "wrong@example.com", requestId, expectedRevision: 0 },
      { email: "owner@example.com", confirmation: "owner@example.com", requestId, expectedRevision: -1 },
      { email: "owner@example.com", confirmation: "owner@example.com", requestId, expectedRevision: 0, user_id: "other" },
    ]) expect((await POST(write(body), context)).status).toBe(400);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("maps a newer contact to a structured conflict without claiming success", async () => {
    mocks.admin.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ data: { ok: false, conflict: true, revision: 2 }, error: null }) });
    const response = await POST(write({ email: "owner@example.com", confirmation: "owner@example.com",
      requestId: "91b95911-724a-4dd3-bf5f-8c3ca740f72b", expectedRevision: 0 }), context);
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "PRIZE_CONTACT_CHANGED" });
  });

  it("never reports an unadvanced revision or another request receipt as a successful write", async () => {
    const requestId = "91b95911-724a-4dd3-bf5f-8c3ca740f72b";
    for (const data of [
      { email: "owner@example.com", winner: false, editable: true, revision: 0, request_id: requestId },
      { email: "owner@example.com", winner: false, editable: true, revision: 1, request_id: "91b95911-724a-4dd3-bf5f-8c3ca740f72c" },
    ]) {
      mocks.admin.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ data, error: null }) });
      expect((await POST(write({ email: "owner@example.com", confirmation: "owner@example.com", requestId, expectedRevision: 0 }), context)).status).toBe(503);
    }
  });

  it("returns a stable code for request reuse without leaking the SQL error", async () => {
    mocks.admin.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ error: { message: "PRIZE_REQUEST_REUSED" } }) });
    const response = await POST(write({ email: "owner@example.com", confirmation: "owner@example.com",
      requestId: "91b95911-724a-4dd3-bf5f-8c3ca740f72b", expectedRevision: 0 }), context);
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ code: "PRIZE_REQUEST_REUSED",
      error: "No pudimos enviar este intento. Revisa ambos correos y vuelve a guardar." });
  });

  it("never treats a missing or contradictory RPC acknowledgement as a successful save", async () => {
    for (const data of [null, {}, { email: "different@example.com", winner: false, editable: true }, { email: "owner@example.com", winner: false }]) {
      mocks.admin.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ data, error: null }) });
      const response = await POST(write({ email: "owner@example.com", confirmation: "owner@example.com" }), context);
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("invalid_save_ack");
    }
  });

  it("refuses mismatched confirmation and simple form requests before DB access", async () => {
    expect((await POST(write({ email: "owner@example.com", confirmation: "wrong@example.com" }), context)).status).toBe(400);
    expect((await POST(new Request(read(), { method: "POST", body: "{}" }), context)).status).toBe(409);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("preserves SQL access and delivery gates and never emits raw DB errors", async () => {
    for (const [message, status] of [["PRIZE_PARTICIPANT_REQUIRED", 403], ["PRIZE_WINNER_REQUIRED", 403], ["PRIZE_ALREADY_DELIVERED", 409], ["database detail secret@example.com", 503]] as const) {
      mocks.admin.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ error: { message } }) });
      const result = await POST(write({ email: "owner@example.com", confirmation: "owner@example.com" }), context);
      expect(result.status).toBe(status); expect(await result.text()).not.toContain(message);
    }
  });

  it("locks editing after settled loss or recorded delivery", async () => {
    mocks.polla.mockResolvedValue({ id: QUENTRO_POLLA_ID, prize_kind: "objeto", status: "resuelta" });
    for (const payoutData of [null, { id: "award", delivered_at: "2026-09-24T20:00:00Z" }]) {
      mocks.admin.mockReturnValue({ from: vi.fn().mockReturnValueOnce(query(null)).mockReturnValueOnce(query(payoutData)) });
      expect((await (await GET(read(), context)).json()).editable).toBe(false);
    }
  });
});

describe("administrator ticket delivery", () => {
  it("uses the recipient FK in the actual PostgREST query, never paid_by or delivered_by", async () => {
    mocks.auth.mockResolvedValue({ id: "admin", is_admin: true });
    const urls: URL[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      urls.push(url);
      if (url.pathname.endsWith("/casa_payouts")) {
        // PostgREST has three payout -> users relationships. An unqualified
        // embedding fails even when there are no payouts yet.
        if (url.searchParams.get("select") !== "user_id,delivered_at,users!casa_payouts_user_id_fkey(display_name)")
          return Response.json({ code: "PGRST201", message: "Ambiguous users relationship" }, { status: 300 });
        return Response.json([{ user_id: "winner", delivered_at: null, users: { display_name: "Recipient" } }]);
      }
      if (url.pathname.endsWith("/casa_prize_contacts")) return Response.json([{ user_id: "winner", email: "recipient@example.com" }]);
      throw new Error(`Unexpected test query ${url.pathname}`);
    });
    mocks.admin.mockReturnValue(createClient("https://supabase.invalid", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetcher },
    }));
    const result = await adminGET(read(), adminContext);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ winners: [{ name: "Recipient", email: "recipient@example.com", delivered: false, provisional: false }] });
    expect(urls[0].searchParams.get("polla_id")).toBe(`eq.${QUENTRO_POLLA_ID}`);
    expect(urls[1].searchParams.get("user_id")).toBe("in.(winner)");
  });

  it("denies non-admin and anonymous requests before querying contacts", async () => {
    expect((await adminGET(read(), adminContext)).status).toBe(403);
    mocks.auth.mockResolvedValue(null);
    expect((await adminGET(read(), adminContext)).status).toBe(401);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("never exposes leaders' emails while results are incomplete", async () => {
    mocks.auth.mockResolvedValue({ id: "admin", is_admin: true });
    const from = vi.fn().mockReturnValue(query([]));
    mocks.admin.mockReturnValue({ from, rpc: vi.fn().mockResolvedValue({ data: { state: "waiting" }, error: null }) });
    expect(await (await adminGET(read(), adminContext)).json()).toEqual({ winners: [] });
    expect(from).toHaveBeenCalledTimes(1); expect(from).toHaveBeenCalledWith("casa_payouts");
  });

  it("reads only the authoritative computed winner email, marked provisional", async () => {
    mocks.auth.mockResolvedValue({ id: "admin", is_admin: true });
    const contact = query({ email: "winner@example.com" });
    const rpc = vi.fn().mockResolvedValue({ data: { state: "ready", winner: { user_id: "ready-winner", display_name: "Winner" } }, error: null });
    mocks.admin.mockReturnValue({ from: vi.fn().mockReturnValueOnce(query([])).mockReturnValueOnce(contact), rpc });
    const result = await adminGET(read(), adminContext);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(await result.json()).toEqual({ winners: [{ name: "Winner", email: "winner@example.com", delivered: false, provisional: true }] });
    expect(contact.eq).toHaveBeenCalledWith("user_id", "ready-winner");
  });

  it("settled winners do not depend on the preview RPC", async () => {
    mocks.auth.mockResolvedValue({ id: "admin", is_admin: true });
    const contacts = query([{ user_id: "winner", email: "winner@example.com" }]);
    const rpc = vi.fn();
    mocks.admin.mockReturnValue({ from: vi.fn().mockReturnValueOnce(query([{ user_id: "winner", delivered_at: null, users: { display_name: "Winner" } }])).mockReturnValueOnce(contacts), rpc });
    expect((await (await adminGET(read(), adminContext)).json()).winners[0].provisional).toBe(false);
    expect(contacts.in).toHaveBeenCalledWith("user_id", ["winner"]); expect(rpc).not.toHaveBeenCalled();
  });
});
