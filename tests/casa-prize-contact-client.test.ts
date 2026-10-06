import { afterEach, describe, expect, it, vi } from "vitest";
import { isOwnedPrizeContactData, isPrizeContactData, readPrizeContact, savePrizeContact, verifyPrizeContact } from "@/lib/casa/prize-contact-client";

const endpoint = "/api/casa/pollas/gift/prize-contact";
const email = "recipient@example.com";
const ownerId = "owner-a";
const operation = { email, confirmation: email, requestId: "91b95911-724a-4dd3-bf5f-8c3ca740f72b", expectedRevision: 0 };
const saved = { email, editable: true, winner: false, owner_id: ownerId, revision: 1, request_id: operation.requestId };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Quentro authoritative save confirmation", () => {
  it("requires both delivery flags and rejects malformed and negative acknowledgements", () => {
    for (const value of [null, {}, { email }, { ...saved, email: "not-an-address" }, { ...saved, email: " recipient@example.com " }, { ...saved, winner: "false" }, { ...saved, error: "failed" }, { ...saved, ok: false }])
      expect(isPrizeContactData(value)).toBe(false);
    expect(isPrizeContactData(saved)).toBe(true);
    expect(isPrizeContactData({ ...saved, email: null })).toBe(true);
    expect(isOwnedPrizeContactData({ email, editable: true, winner: false })).toBe(false);
    expect(isOwnedPrizeContactData({ ...saved, owner_id: "" })).toBe(false);
  });

  it("accepts only the submitted email and uses the existing Casa contract", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(saved)); vi.stubGlobal("fetch", fetcher);
    expect(await savePrizeContact(endpoint, operation, ownerId)).toEqual({ ok: true, data: saved });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(endpoint, expect.objectContaining({ method: "POST", cache: "no-store", redirect: "error",
      headers: expect.objectContaining({ "X-Casa-Owner": ownerId }), body: JSON.stringify(operation) }));
  });

  it.each(["drop", "html", "wrong_email", "malformed", "server_failure"])("reconciles %s by reading, with no automatic POST retry", async (fault) => {
    const fetcher = vi.fn();
    if (fault === "drop") fetcher.mockRejectedValueOnce(new TypeError("Failed to fetch private-provider-detail"));
    else fetcher.mockResolvedValueOnce(fault === "html" ? new Response("<html>login</html>")
      : fault === "wrong_email" ? Response.json({ ...saved, email: "previous@example.com" })
      : fault === "server_failure" ? Response.json({ error: "raw database detail" }, { status: 503 })
      : Response.json({ email }));
    fetcher.mockResolvedValueOnce(Response.json(saved)); vi.stubGlobal("fetch", fetcher);
    expect(await savePrizeContact(endpoint, operation, ownerId)).toEqual({ ok: true, data: saved });
    expect(fetcher.mock.calls.map(([, init]) => init.method ?? "GET")).toEqual(["POST", "GET"]);
  });

  it("keeps uncertainty if reconciliation fails, without parser or provider details", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("Unexpected token private@example.com")); vi.stubGlobal("fetch", fetcher);
    const result = await savePrizeContact(endpoint, operation, ownerId);
    expect(result).toMatchObject({ ok: false, kind: "uncertain", retrySameEmail: false });
    expect(JSON.stringify(result)).not.toMatch(/Unexpected|private@/);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("permits only a manual same-email resend after a valid read that does not confirm it", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("drop")).mockResolvedValueOnce(Response.json({ ...saved, email: null, revision: 0, request_id: null }));
    vi.stubGlobal("fetch", fetcher);
    expect(await savePrizeContact(endpoint, operation, ownerId)).toMatchObject({ ok: false, kind: "uncertain", retrySameEmail: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("offers session recovery without readback or a false saved state after a rejected unauthenticated write", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("login", { status: 401 })); vi.stubGlobal("fetch", fetcher);
    expect(await savePrizeContact(endpoint, operation, ownerId)).toMatchObject({ ok: false, kind: "auth", retrySameEmail: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([400, 403, 409])("does not expose arbitrary error bodies or repeat rejected writes (%s)", async (status) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: "raw provider secret@example.com" }, { status })); vi.stubGlobal("fetch", fetcher);
    const result = await savePrizeContact(endpoint, operation, ownerId);
    expect(result).toMatchObject({ ok: false, kind: "rejected" });
    expect(JSON.stringify(result)).not.toContain("secret@example.com"); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("bounds a stalled mutation and reconciliation so the dialog can become dismissible", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    const result = savePrizeContact(endpoint, operation, ownerId, 100);
    await vi.advanceTimersByTimeAsync(201);
    expect(await result).toMatchObject({ ok: false, kind: "uncertain", retrySameEmail: false });
  });

  it("bounds initial reads and preserves a distinct auth result during later verification", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("<html>login</html>"))
      .mockResolvedValueOnce(new Response("login", { status: 401 })));
    expect(await readPrizeContact(endpoint)).toMatchObject({ ok: false, kind: "uncertain" });
    expect(await verifyPrizeContact(endpoint, operation, ownerId)).toMatchObject({ ok: false, kind: "auth", retrySameEmail: false });
  });

  it("never acknowledges another account even if it has exactly the intended email", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("lost response")).mockResolvedValueOnce(Response.json({ ...saved, owner_id: "owner-b" }));
    vi.stubGlobal("fetch", fetcher);
    expect(await savePrizeContact(endpoint, operation, ownerId)).toMatchObject({ ok: false, kind: "account", retrySameEmail: false });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("cannot enable a resend after account changed during verification", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...saved, owner_id: "owner-b", email: null })));
    expect(await verifyPrizeContact(endpoint, operation, ownerId)).toMatchObject({ ok: false, kind: "account", retrySameEmail: false });
  });

  it("retains the account change rejection without a blind retry or false confirmation", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ code: "SESSION_CHANGED", error: "Copy can change safely." }, { status: 412 }));
    vi.stubGlobal("fetch", fetcher);
    expect(await savePrizeContact(endpoint, operation, ownerId)).toMatchObject({ ok: false, kind: "account", retrySameEmail: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not confirm a pre-existing identical value while its POST may still be pending", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("lost response")).mockResolvedValueOnce(Response.json({ ...saved, revision: 0, request_id: null }));
    vi.stubGlobal("fetch", fetcher);
    expect(await savePrizeContact(endpoint, operation, ownerId)).toMatchObject({ ok: false, kind: "uncertain", retrySameEmail: true });
  });

  it("confirms a fresh same-email revision fence while retaining request metadata", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...saved, request_id: null })));
    expect(await verifyPrizeContact(endpoint, operation, ownerId)).toEqual({ ok: true, data: { ...saved, request_id: null } });
  });

  it("keeps the exact operation identity during a manual retry", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("lost response"))
      .mockResolvedValueOnce(Response.json({ ...saved, revision: 0, request_id: null })).mockResolvedValueOnce(Response.json(saved));
    vi.stubGlobal("fetch", fetcher);
    expect(await savePrizeContact(endpoint, operation, ownerId)).toMatchObject({ ok: false, kind: "uncertain" });
    expect(await savePrizeContact(endpoint, operation, ownerId)).toEqual({ ok: true, data: saved });
    const writes = fetcher.mock.calls.filter(([, init]) => init.method === "POST");
    expect(writes.map(([, init]) => JSON.parse(init.body))).toEqual([operation, operation]);
  });

  it("preserves a newer different value as a conflict instead of blindly overwriting it", async () => {
    const current = { ...saved, email: "newer@example.com", revision: 2 };
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ code: "PRIZE_CONTACT_CHANGED", error: "changed" }, { status: 409 }))
      .mockResolvedValueOnce(Response.json(current)); vi.stubGlobal("fetch", fetcher);
    expect(await savePrizeContact(endpoint, operation, ownerId)).toMatchObject({ ok: false, kind: "changed", current, retrySameEmail: false });
    expect(fetcher.mock.calls.map(([, init]) => init.method ?? "GET")).toEqual(["POST", "GET"]);
  });

  it("identifies a changed nonparticipant account before reading any prize content", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ code: "SESSION_CHANGED", error: "changed" }, { status: 412 }));
    vi.stubGlobal("fetch", fetcher);
    expect(await verifyPrizeContact(endpoint, operation, ownerId)).toMatchObject({ ok: false, kind: "account", retrySameEmail: false });
    expect(fetcher).toHaveBeenCalledWith(endpoint, expect.objectContaining({ headers: { "X-Casa-Owner": ownerId } }));
  });

  it("never offers another write after the delivery is no longer editable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...saved, revision: 0, request_id: null, editable: false })));
    expect(await verifyPrizeContact(endpoint, operation, ownerId)).toMatchObject({ ok: false, kind: "uncertain", retrySameEmail: false });
  });

  it("does not suggest resaving when a newer contact also closed editing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...saved, email: "newer@example.com", revision: 2, editable: false })));
    const result = await verifyPrizeContact(endpoint, operation, ownerId);
    expect(result).toMatchObject({ ok: false, kind: "changed", retrySameEmail: false });
    if (!result.ok) expect(result.error).toContain("Comunícate con el administrador");
  });
});
