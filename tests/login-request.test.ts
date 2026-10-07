import { afterEach, describe, expect, it, vi } from "vitest";
import { loginRequest, readLoginStorage, writeLoginStorage } from "@/lib/auth/login-request";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("bounded login requests", () => {
  it("preserves authentication errors instead of describing an expired session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Código inválido" }), { status: 401 })));
    expect(await loginRequest("/api/auth/verify-otp", { token: "000000" })).toEqual({ ok: false, status: 401, body: { error: "Código inválido" } });
  });
  it("aborts a stalled network request and permits the caller to recover", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((_endpoint, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    vi.stubGlobal("fetch", fetch);
    const request = loginRequest("/api/auth/start-otp", {}, 200);
    const assertion = expect(request).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(201);
    await assertion;
    expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: "include", cache: "no-store", redirect: "error" });
  });
  it.each(["<html>signed out</html>", "null", "[]"])("does not acknowledge an invalid success body: %s", async body => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    await expect(loginRequest("/api/auth/start-otp", {})).rejects.toThrow();
  });
  it("storage denied by privacy settings does not throw", () => {
    vi.stubGlobal("window", { get sessionStorage() { throw new Error("SecurityError"); } });
    expect(readLoginStorage("returnTo")).toBeNull();
    expect(() => writeLoginStorage("returnTo", "/polla/test")).not.toThrow();
    expect(() => writeLoginStorage("returnTo", null)).not.toThrow();
  });
});
