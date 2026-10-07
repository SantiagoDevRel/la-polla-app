import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
import { casaPost } from "@/lib/casa/upload-client";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const url = "/api/casa/pollas/test/join";
const body = { action: "confirm", attemptId: "same-attempt" };

describe("Casa upload transport", () => {
  it("recovers Safari's lost response using the identical request", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError("Load failed")).mockResolvedValueOnce(response({ ok: true, state: "confirmed" }));
    vi.stubGlobal("fetch", fetch);
    const onRetry = vi.fn();
    const result = casaPost(url, body, { retrySafe: true, onRetry });
    await vi.advanceTimersByTimeAsync(500);
    await expect(result).resolves.toMatchObject({ ok: true, state: "confirmed" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map((call) => call[1].body)).toEqual([JSON.stringify(body), JSON.stringify(body)]);
    expect(onRetry).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  });

  it("bounds recovery and preserves an uncertain result without raw browser errors", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockRejectedValue(new TypeError("Load failed"));
    vi.stubGlobal("fetch", fetch);
    const result = casaPost(url, body, { retrySafe: true });
    const check = expect(result).rejects.toMatchObject({ code: "REQUEST_UNCERTAIN", message: expect.stringContaining("mismo comprobante") });
    await vi.advanceTimersByTimeAsync(1_500);
    await check;
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("never retries other mutations by default", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("Load failed"));
    vi.stubGlobal("fetch", fetch);
    await expect(casaPost("/api/casa/admin/regalos", { action: "create" })).rejects.toMatchObject({ code: "REQUEST_UNCERTAIN" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("aborts a request that cannot complete", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    const result = casaPost(url, body);
    const check = expect(result).rejects.toMatchObject({ code: "REQUEST_UNCERTAIN" });
    await vi.advanceTimersByTimeAsync(60_000);
    await check;
  });

  it.each([409, 401, 403])("keeps business/auth errors without retries (HTTP %s)", async (status) => {
    const fetch = vi.fn().mockResolvedValue(response({ error: "Necesitas iniciar sesión.", code: "USER_REQUIRED" }, status));
    vi.stubGlobal("fetch", fetch);
    await expect(casaPost(url, body, { retrySafe: true })).rejects.toMatchObject({ code: "USER_REQUIRED", status, message: "Necesitas iniciar sesión." });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([null, [], { error: "No se pudo leer la respuesta." }, { ok: false }, {}])("rejects an unconfirmed 200 response: %j", async (data) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(data)));
    await expect(casaPost(url, body)).rejects.toMatchObject({ code: "REQUEST_UNCERTAIN" });
  });

  it("recovers an incomplete JSON response instead of announcing success", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce(new Response('{"ok":')).mockResolvedValueOnce(response({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    const result = casaPost(url, body, { retrySafe: true });
    await vi.advanceTimersByTimeAsync(500);
    await expect(result).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("recovers a temporary gateway error with the same request", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce(response({ error: "Unavailable" }, 503)).mockResolvedValueOnce(response({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    const result = casaPost(url, body, { retrySafe: true });
    await vi.advanceTimersByTimeAsync(500);
    await expect(result).resolves.toEqual({ ok: true });
  });
});

describe("signed receipt uploads", () => {
  it("uses only the signed authorization, keeps the original bytes and forbids overwrite", async () => {
    const { uploadSignedFile } = await import("@/lib/casa/upload-client");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    const fetch = vi.fn().mockResolvedValue(response({ Key: "payment-proofs/casa/proof.png" }));
    vi.stubGlobal("fetch", fetch);
    const blob = new Blob(["receipt"], { type: "image/png" });
    await expect(uploadSignedFile({ bucket: "payment-proofs", path: "casa/proof.png", token: "signed-token" }, blob)).resolves.toBeNull();
    const [url, options] = fetch.mock.calls[0];
    expect(url.toString()).toBe("https://project.supabase.co/storage/v1/object/upload/sign/payment-proofs/casa/proof.png?token=signed-token");
    expect(options.body).toBe(blob);
    expect(options).toMatchObject({ method: "PUT", credentials: "omit", headers: { "Content-Type": "image/png", "x-upsert": "false" } });
    expect(options.headers).not.toHaveProperty("Authorization");
  });

  it("skips uploading an existing immutable file", async () => {
    const { uploadSignedFile } = await import("@/lib/casa/upload-client");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(uploadSignedFile({ bucket: "payment-proofs", path: "proof.png", token: null }, new Blob())).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("bounds a hanging upload so that server verification can recover it", async () => {
    const { uploadSignedFile } = await import("@/lib/casa/upload-client");
    vi.useFakeTimers(); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubGlobal("fetch", vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    const result = uploadSignedFile({ bucket: "payment-proofs", path: "proof.png", token: "signed-token" }, new Blob());
    await vi.advanceTimersByTimeAsync(90_000);
    await expect(result).resolves.toMatchObject({ code: "REQUEST_UNCERTAIN" });
  });
});
