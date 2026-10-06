import { afterEach, expect, it, vi } from "vitest";
import { requestJson } from "@/lib/http/json-request";
const ack = (value: unknown): value is { ok: true } => typeof value === "object" && value !== null && "ok" in value && value.ok === true;
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it("does not acknowledge a login page or a malformed success body", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("<html>login</html>"))
    .mockResolvedValueOnce(Response.json({ ok: false })));
  expect(await requestJson("/api/test", {}, ack)).toMatchObject({ ok: false, kind: "uncertain" });
  expect(await requestJson("/api/test", {}, ack)).toMatchObject({ ok: false, kind: "uncertain" });
});
it("distinguishes session expiry from uncertain writes", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("login", { status: 401 }))
    .mockResolvedValueOnce(Response.json({ error: "Gateway failed" }, { status: 502 })));
  expect(await requestJson("/api/test", {}, ack)).toMatchObject({ kind: "auth", status: 401 });
  expect(await requestJson("/api/test", {}, ack)).toMatchObject({ kind: "uncertain", status: 502 });
});
it("preserves structured preconditions without classifying by user-facing wording", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code: "PROFILE_CHANGED", error: "Revisa tus cambios." }, { status: 409 })));
  expect(await requestJson("/api/test", {}, ack)).toMatchObject({ kind: "rejected", status: 409, code: "PROFILE_CHANGED" });
});
it("keeps non-JSON client rejections distinct from uncertain gateway responses", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("Forbidden", { status: 403 }))
    .mockResolvedValueOnce(new Response("Gateway timeout", { status: 504 })));
  expect(await requestJson("/api/test", {}, ack)).toMatchObject({ kind: "rejected", status: 403 });
  expect(await requestJson("/api/test", {}, ack)).toMatchObject({ kind: "uncertain", status: 504 });
});
it("bounds both fetch and a stalled response body", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => Promise.resolve({ ok: true, status: 200,
    json: () => new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted")))) })));
  const pending = requestJson("/api/test", {}, ack, 100);
  await vi.advanceTimersByTimeAsync(101);
  expect(await pending).toMatchObject({ ok: false, kind: "uncertain" });
});
it("accepts only the expected acknowledgement and never follows redirects", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true })); vi.stubGlobal("fetch", fetcher);
  expect(await requestJson("/api/test", {}, ack)).toEqual({ ok: true, data: { ok: true } });
  expect(fetcher).toHaveBeenCalledWith("/api/test", expect.objectContaining({ redirect: "error", cache: "no-store" }));
});
