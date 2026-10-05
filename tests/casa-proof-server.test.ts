import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({
  user: vi.fn(), admin: vi.fn(), polla: vi.fn(), pot: vi.fn(), verify: vi.fn(),
  notify: vi.fn(), watchers: vi.fn(), after: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: mocks.after }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.user } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/casa/queries", () => ({ getPollaBySlug: mocks.polla, getPot: mocks.pot }));
vi.mock("@/lib/casa/uploads", () => ({ verifyCasaUpload: mocks.verify, signedCasaUpload: vi.fn() }));
vi.mock("@/lib/casa/referrals", () => ({ linkReferralFromCookie: vi.fn() }));
vi.mock("@/lib/telegram/notify", () => ({ PROOF_BUCKET: "payment-proofs", notifyNewProof: mocks.notify }));
vi.mock("@/lib/telegram-player/proof-watchers", () => ({ notifyProofWatchers: mocks.watchers }));

import { confirmCasaProof } from "@/lib/casa/proof-server";
import { POST } from "@/app/api/casa/pollas/[slug]/join/route";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const userId = id(1);
const polla = { id: id(2), name: "Polla de prueba", slug: "prueba", prize_kind: "pozo" as const, prize_object: null, status: "abierta", kind: "partidos" };
const attempt = { id: id(3), entry_id: id(4), proof_path: "casa/proof.png", state: "uploading", content_sha256: "a".repeat(64), content_type: "image/png", content_bytes: 123 };
const confirmed = { entry_id: attempt.entry_id, attempt_id: attempt.id, state: "confirmed", changed: true, entry_status: "pendiente" };
const entry = { amount_cop: 10_000, ticket_number: null, entry_number: 2 };
const fetchDb = vi.fn<typeof fetch>();
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const db = createClient("http://localhost:54321", "test-only-key", {
  auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchDb },
});
const request = () => new Request("http://localhost/api/casa/pollas/prueba/join", {
  method: "POST", headers: { "Content-Type": "application/json", "X-Casa-Contract": "2" },
  body: JSON.stringify({ action: "confirm", attemptId: attempt.id }),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ data: { user: { id: userId } } });
  mocks.admin.mockReturnValue(db);
  mocks.polla.mockResolvedValue(polla);
  mocks.pot.mockResolvedValue({ projected_prize_cop: 7_000, prize_cop: 0 });
  mocks.verify.mockResolvedValue(undefined);
  mocks.notify.mockResolvedValue(undefined);
  mocks.watchers.mockResolvedValue(1);
});

function confirmationReads(changed = true) {
  fetchDb.mockResolvedValueOnce(response({ ...confirmed, changed }))
    .mockResolvedValueOnce(response(entry));
}

describe("payment proof confirmation", () => {
  it("returns the confirmed receipt while scheduled notifications are still pending", async () => {
    confirmationReads();
    fetchDb.mockResolvedValueOnce(response({ display_name: "Persona" }));
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    mocks.notify.mockReturnValue(pending);
    let background: Promise<void> | undefined;
    let receipt: Awaited<ReturnType<typeof confirmCasaProof>> | undefined;
    const result = confirmCasaProof(db, polla, userId, attempt, (notify) => { background = notify(); })
      .then((value) => { receipt = value; });
    try {
      await vi.waitFor(() => expect(receipt).toMatchObject({ ok: true, data: { ...confirmed, entry_number: 2 } }));
      await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalledTimes(1));
      expect(mocks.watchers).toHaveBeenCalledTimes(1);
      expect(mocks.verify).toHaveBeenCalledExactlyOnceWith("payment-proofs", attempt.proof_path, attempt);
      const query = new URL(String(fetchDb.mock.calls[1][0]));
      expect(query.searchParams.get("user_id")).toBe(`eq.${userId}`);
    } finally {
      release();
      await Promise.all([result, background]);
    }
  });

  it("schedules HTTP notifications after returning the authenticated receipt", async () => {
    fetchDb.mockResolvedValueOnce(response(attempt));
    confirmationReads();
    const result = await POST(request(), { params: Promise.resolve({ slug: polla.slug }) });
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true, ...confirmed, entry_number: 2 });
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.watchers).not.toHaveBeenCalled();
    const owned = new URL(String(fetchDb.mock.calls[0][0]));
    expect(owned.searchParams.get("user_id")).toBe(`eq.${userId}`);
    expect(owned.searchParams.get("casa_entries.polla_id")).toBe(`eq.${polla.id}`);
    fetchDb.mockResolvedValueOnce(response({ display_name: "Persona" }));
    await mocks.after.mock.calls[0][0]();
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    expect(mocks.watchers).toHaveBeenCalledTimes(1);
  });

  it("does not schedule or resend notices for a repeated confirmation", async () => {
    confirmationReads(false);
    const schedule = vi.fn();
    expect(await confirmCasaProof(db, polla, userId, { ...attempt, state: "confirmed" }, schedule))
      .toMatchObject({ ok: true, data: { changed: false, entry_number: 2 } });
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.watchers).not.toHaveBeenCalled();
  });

  it("keeps Telegram callers waiting for notifications by default", async () => {
    confirmationReads();
    fetchDb.mockResolvedValueOnce(response({ display_name: "Persona" }));
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    mocks.notify.mockReturnValue(pending);
    let settled = false;
    const result = confirmCasaProof(db, polla, userId, attempt).then((value) => { settled = true; return value; });
    try {
      await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalledTimes(1));
      expect(settled).toBe(false);
    } finally { release(); }
    expect(await result).toMatchObject({ ok: true, data: { entry_number: 2 } });
  });

  it("does not confirm or notify when the file fails integrity verification", async () => {
    mocks.verify.mockRejectedValue(Object.assign(new Error("Archivo distinto"), { code: "UPLOAD_MISMATCH" }));
    const schedule = vi.fn();
    expect(await confirmCasaProof(db, polla, userId, attempt, schedule))
      .toEqual({ ok: false, stage: "verify", message: "Archivo distinto", code: "UPLOAD_MISMATCH" });
    expect(fetchDb).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it.each([
    new TypeError("Load failed"),
    Object.assign(new Error("The operation was aborted"), { name: "AbortError" }),
    Object.assign(new Error("The operation timed out"), { name: "TimeoutError" }),
  ])("maps transient verification %s to a retryable Spanish response", async (error) => {
    mocks.verify.mockRejectedValue(error);
    const result = await confirmCasaProof(db, polla, userId, attempt);
    expect(result).toEqual({
      ok: false, stage: "verify", code: "UPLOAD_NOT_READY",
      message: "No pudimos verificar el comprobante por un problema de conexión. Conserva la imagen e intenta de nuevo.",
    });
    expect(fetchDb).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("keeps an unavailable file recoverable without announcing receipt", async () => {
    mocks.verify.mockRejectedValue(new Error("La carga aún no está disponible. Intenta confirmar de nuevo."));
    expect(await confirmCasaProof(db, polla, userId, attempt)).toEqual({
      ok: false, stage: "verify", code: "UPLOAD_NOT_READY",
      message: "La carga aún no está disponible. Intenta confirmar de nuevo.",
    });
    expect(fetchDb).not.toHaveBeenCalled();
  });

  it("requires a session before reading or confirming any receipt", async () => {
    mocks.user.mockResolvedValue({ data: { user: null } });
    const result = await POST(request(), { params: Promise.resolve({ slug: polla.slug }) });
    expect(result.status).toBe(401);
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(fetchDb).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("does not schedule notifications when SQL rejects confirmation", async () => {
    fetchDb.mockResolvedValueOnce(response({ message: "UPLOAD_EXPIRED", code: "55000" }, 409));
    const schedule = vi.fn();
    expect(await confirmCasaProof(db, polla, userId, attempt, schedule))
      .toMatchObject({ ok: false, stage: "rpc", error: { message: "UPLOAD_EXPIRED" } });
    expect(schedule).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
