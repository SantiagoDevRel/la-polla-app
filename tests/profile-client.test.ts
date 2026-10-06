import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmProfilePatch, loadProfile, retryProfilePatch, saveProfilePatch } from "@/lib/users/profile-client";

const profile = {
  id: "00000000-0000-4000-8000-000000000001",
  profile_revision: 0,
  display_name: "Ana", whatsapp_number: "+573001234567", avatar_url: "millos", is_admin: false,
  default_payout_method: null, default_payout_account: null, default_payout_account_name: null,
  default_payout_account_type: null,
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("persisted profile acknowledgements", () => {
  it("accepts only the persisted fields matching the intended patch", async () => {
    fetchMock.mockResolvedValueOnce(json({ profile })).mockResolvedValueOnce(json({ success: true, profile: { ...profile, profile_revision: 1, display_name: "Sofía" } }));
    expect(await saveProfilePatch({ display_name: " Sofía " }, profile.id)).toMatchObject({ ok: true, data: { display_name: "Sofía" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ display_name: "Sofía", expected_user_id: profile.id, expected_revision: 0 });
  });
  it("recovers a committed PATCH whose response was lost with one GET", async () => {
    fetchMock.mockResolvedValueOnce(json({ profile })).mockRejectedValueOnce(new TypeError("connection lost"))
      .mockResolvedValueOnce(json({ profile: { ...profile, profile_revision: 1, avatar_url: "junior" } }));
    expect(await saveProfilePatch({ avatar_url: "junior" }, profile.id)).toMatchObject({ ok: true });
    expect(fetchMock.mock.calls.map(call => call[1].method)).toEqual(["GET", "PATCH", "GET"]);
  });
  it.each(["html", "empty", "wrong-profile"])("does not confirm a %s HTTP 200 response", async mode => {
    const bad = mode === "html" ? new Response("<html>Login</html>")
      : json(mode === "empty" ? { success: true } : { success: true, profile });
    fetchMock.mockResolvedValueOnce(json({ profile })).mockResolvedValueOnce(bad).mockResolvedValueOnce(json({ profile }));
    expect(await saveProfilePatch({ display_name: "Sofía" }, profile.id)).toMatchObject({ ok: false, kind: "uncertain" });
    expect(fetchMock.mock.calls.map(call => call[1].method)).toEqual(["GET", "PATCH", "GET"]);
  });
  it("reports an expired session without attempting another write", async () => {
    fetchMock.mockResolvedValue(json({ error: "No autorizado" }, 401));
    expect(await saveProfilePatch({ display_name: "Sofía" }, profile.id)).toMatchObject({ ok: false, kind: "auth" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("keeps an unknown write pending if the readback encounters an expired session", async () => {
    fetchMock.mockResolvedValueOnce(json({ profile })).mockRejectedValueOnce(new TypeError("connection lost"))
      .mockResolvedValueOnce(json({ error: "No autorizado" }, 401));
    expect(await saveProfilePatch({ display_name: "Sofía" }, profile.id)).toMatchObject({ ok: false, kind: "auth", pending: { baselineRevision: 0, ownerId: profile.id } });
    expect(fetchMock.mock.calls.map(call => call[1].method)).toEqual(["GET", "PATCH", "GET"]);
  });
  it("keeps the server's validation rejection", async () => {
    fetchMock.mockResolvedValueOnce(json({ profile })).mockResolvedValueOnce(json({ error: "Nombre inválido" }, 400));
    expect(await saveProfilePatch({ display_name: "123" }, profile.id)).toMatchObject({ ok: false, kind: "rejected", error: "Nombre inválido" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("normalizes payout fields exactly as the server", async () => {
    fetchMock.mockResolvedValueOnce(json({ profile })).mockResolvedValueOnce(json({ success: true, profile: { ...profile, profile_revision: 1, default_payout_method: "nequi", default_payout_account: "3001234567" } }));
    expect(await saveProfilePatch({ default_payout_method: "nequi", default_payout_account: " 3001234567 ", default_payout_account_name: "Unused" }, profile.id)).toMatchObject({ ok: true });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      default_payout_method: "nequi", default_payout_account: "3001234567",
      default_payout_account_name: null, default_payout_account_type: null,
      expected_user_id: profile.id,
      expected_revision: 0,
    });
  });
  it("automatic confirmation only checks persisted state", async () => {
    fetchMock.mockResolvedValue(json({ profile }));
    expect(await confirmProfilePatch({ patch: { display_name: "Sofía" }, ownerId: profile.id, baselineRevision: 0 })).toMatchObject({ ok: false, kind: "uncertain" });
    expect(fetchMock.mock.calls.map(call => call[1].method)).toEqual(["GET"]);
  });
  it("recovers a lost payout-clear response only after all persisted fields are null", async () => {
    fetchMock.mockResolvedValueOnce(json({ profile: { ...profile, default_payout_method: "nequi", default_payout_account: "3001234567" } }))
      .mockRejectedValueOnce(new TypeError("connection lost")).mockResolvedValueOnce(json({ profile: { ...profile, profile_revision: 1 } }));
    expect(await saveProfilePatch({ default_payout_method: null, default_payout_account: null,
      default_payout_account_name: null, default_payout_account_type: null }, profile.id)).toMatchObject({ ok: true });
  });
  it("makes null or incomplete profile reads an actionable failure", async () => {
    fetchMock.mockResolvedValue(json({ profile: null }));
    expect(await loadProfile()).toMatchObject({ ok: false, kind: "uncertain" });
  });
  it("does not send a PATCH after a different account signs in", async () => {
    fetchMock.mockResolvedValue(json({ profile: { ...profile, id: "00000000-0000-4000-8000-000000000002" } }));
    expect(await saveProfilePatch({ display_name: "Sofía" }, profile.id)).toMatchObject({ ok: false, kind: "rejected", code: "SESSION_CHANGED" });
    expect(fetchMock.mock.calls.map(call => call[1].method)).toEqual(["GET"]);
  });
  it("does not reconcile an unknown write against a different account with the same fields", async () => {
    fetchMock.mockResolvedValue(json({ profile: { ...profile, id: "00000000-0000-4000-8000-000000000002", display_name: "Sofía" } }));
    expect(await confirmProfilePatch({ patch: { display_name: "Sofía" }, ownerId: profile.id, baselineRevision: 0 })).toMatchObject({ ok: false, kind: "rejected", code: "SESSION_CHANGED", pending: { baselineRevision: 0 } });
  });
  it("honors the server owner fence if the account changes between GET and PATCH", async () => {
    fetchMock.mockResolvedValueOnce(json({ profile })).mockResolvedValueOnce(json({ code: "SESSION_CHANGED", error: "Cambiaste de cuenta." }, 412));
    expect(await saveProfilePatch({ display_name: "Sofía" }, profile.id)).toMatchObject({ ok: false, kind: "rejected", code: "SESSION_CHANGED" });
  });
  it("bounds a stalled PATCH and its readback without automatically resending", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(json({ profile })).mockImplementation((_endpoint, init) =>
      new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))));
    const pending = saveProfilePatch({ display_name: "Sofía" }, profile.id);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(await pending).toMatchObject({ ok: false, kind: "uncertain", pending: { baselineRevision: 0 } });
    expect(fetchMock.mock.calls.map(call => call[1].method)).toEqual(["GET", "PATCH", "GET"]);
  });
  it("does not send a mutation if the intended state already exists", async () => {
    fetchMock.mockResolvedValue(json({ profile }));
    expect(await saveProfilePatch({ avatar_url: "millos" }, profile.id)).toMatchObject({ ok: true });
    expect(fetchMock.mock.calls.map(call => call[1].method)).toEqual(["GET"]);
  });
  it("does not confirm an old matching snapshot until the revision advances", async () => {
    const mutation = { patch: { display_name: "Sofía" }, ownerId: profile.id, baselineRevision: 2 };
    fetchMock.mockResolvedValueOnce(json({ profile: { ...profile, display_name: "Sofía", profile_revision: 2 } }))
      .mockResolvedValueOnce(json({ profile: { ...profile, display_name: "Sofía", profile_revision: 3 } }));
    expect(await confirmProfilePatch(mutation)).toMatchObject({ ok: false, kind: "uncertain", pending: mutation });
    expect(await confirmProfilePatch(mutation)).toMatchObject({ ok: true });
  });
  it("keeps a concurrent profile revision conflict as a rejected write", async () => {
    fetchMock.mockResolvedValueOnce(json({ profile })).mockResolvedValueOnce(json({ error: "Tu perfil cambió mientras guardabas." }, 409));
    expect(await saveProfilePatch({ display_name: "Sofía" }, profile.id)).toMatchObject({ ok: false, kind: "rejected", status: 409 });
    expect(fetchMock.mock.calls.map(call => call[1].method)).toEqual(["GET", "PATCH"]);
  });
  it("releases an unknown old write when a newer revision proves its CAS can no longer commit", async () => {
    fetchMock.mockResolvedValue(json({ profile: { ...profile, display_name: "Beatriz", profile_revision: 2 } }));
    const result = await confirmProfilePatch({ patch: { display_name: "Sofía" }, ownerId: profile.id, baselineRevision: 0 });
    expect(result).toMatchObject({ ok: false, kind: "rejected", status: 409, code: "PROFILE_CHANGED", latestProfile: { display_name: "Beatriz", profile_revision: 2 } });
    expect(result.pending).toBeUndefined();
  });
  it("explicitly retries an uncommitted write with exactly the original owner, revision and fields", async () => {
    const pending = { patch: { display_name: "Sofía" }, ownerId: profile.id, baselineRevision: 0 };
    fetchMock.mockResolvedValueOnce(json({ profile }))
      .mockResolvedValueOnce(json({ success: true, profile: { ...profile, display_name: "Sofía", profile_revision: 1 } }));
    expect(await retryProfilePatch(pending)).toMatchObject({ ok: true });
    expect(fetchMock.mock.calls.map(call => call[1].method)).toEqual(["GET", "PATCH"]);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ display_name: "Sofía", expected_user_id: profile.id, expected_revision: 0 });
  });
  it("confirms the original request if it wins between the explicit retry read and conditional write", async () => {
    fetchMock.mockResolvedValueOnce(json({ profile }))
      .mockResolvedValueOnce(json({ code: "PROFILE_CHANGED", error: "Revision changed" }, 409))
      .mockResolvedValueOnce(json({ profile: { ...profile, display_name: "Sofía", profile_revision: 1 } }));
    expect(await retryProfilePatch({ patch: { display_name: "Sofía" }, ownerId: profile.id, baselineRevision: 0 })).toMatchObject({ ok: true });
    expect(fetchMock.mock.calls.map(call => call[1].method)).toEqual(["GET", "PATCH", "GET"]);
  });
  it("shows the latest profile after a conditional write conflicts while preserving the edited intent", async () => {
    fetchMock.mockResolvedValueOnce(json({ profile }))
      .mockResolvedValueOnce(json({ code: "PROFILE_CHANGED", error: "Revision changed" }, 409))
      .mockResolvedValueOnce(json({ profile: { ...profile, display_name: "Beatriz", profile_revision: 1 } }));
    expect(await saveProfilePatch({ display_name: "Sofía" }, profile.id)).toMatchObject({ ok: false, code: "PROFILE_CHANGED", latestProfile: { display_name: "Beatriz" } });
  });
  it("does not explicitly retry while its owner cannot be verified", async () => {
    const pending = { patch: { display_name: "Sofía" }, ownerId: profile.id, baselineRevision: 0 };
    fetchMock.mockRejectedValue(new TypeError("offline"));
    expect(await retryProfilePatch(pending)).toMatchObject({ ok: false, kind: "uncertain", pending });
    expect(fetchMock.mock.calls.map(call => call[1].method)).toEqual(["GET"]);
  });
  it("retains the unresolved original write if the explicit resend encounters a changed session", async () => {
    const pending = { patch: { display_name: "Sofía" }, ownerId: profile.id, baselineRevision: 0 };
    fetchMock.mockResolvedValueOnce(json({ profile }))
      .mockResolvedValueOnce(json({ code: "SESSION_CHANGED", error: "Account changed" }, 412));
    expect(await retryProfilePatch(pending)).toMatchObject({ ok: false, code: "SESSION_CHANGED", pending });
  });
});
