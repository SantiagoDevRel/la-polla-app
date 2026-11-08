// tests/preview-guard.test.ts — A Vercel preview never reaches a real provider:
// messaging/payment fetches are skipped with a log, crons and webhooks answer 404.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

import {
  installPreviewFetchGuard,
  isPreviewDeployment,
  isPreviewRefusedPath,
  previewBlockedProvider,
  previewRefusal,
} from "@/lib/preview-guard";
import { requireCronSecret } from "@/lib/auth/cron-secret";

const PREVIEW = { VERCEL_ENV: "preview" };

describe("preview detection", () => {
  it("is true only for VERCEL_ENV=preview", () => {
    expect(isPreviewDeployment(PREVIEW)).toBe(true);
    expect(isPreviewDeployment({ VERCEL_ENV: "production" })).toBe(false);
    expect(isPreviewDeployment({ VERCEL_ENV: "development" })).toBe(false);
    expect(isPreviewDeployment({})).toBe(false);
  });
});

describe("previewBlockedProvider", () => {
  it.each([
    ["https://api.resend.com/emails", "resend"],
    ["https://api.telegram.org/bot123:abc/sendMessage", "telegram"],
    ["https://api.labsmobile.com/json/send", "labsmobile"],
    ["https://zernio.com/api/v1/inbox/conversations/x/messages", "zernio"],
    ["https://graph.facebook.com/v21.0/1/messages", "whatsapp"],
    ["https://api.twilio.com/2010-04-01/Accounts/x/Messages.json", "twilio"],
    ["https://production.wompi.co/v1/transactions", "wompi"],
  ])("%s -> %s", (url, provider) => {
    expect(previewBlockedProvider(url)).toBe(provider);
    expect(previewBlockedProvider(new URL(url))).toBe(provider);
    expect(previewBlockedProvider(new Request(url))).toBe(provider);
  });

  it.each([
    "https://xmulfazzjaxbslcrenpg.supabase.co/rest/v1/users",
    "https://v3.football.api-sports.io/status",
    "https://notresend.com/emails",
    "https://api.resend.com.evil.example/emails",
    "/api/casa/mis-pollas",
  ])("lets %s through", (url) => {
    expect(previewBlockedProvider(url)).toBeNull();
  });
});

describe("installPreviewFetchGuard", () => {
  let original: ReturnType<typeof vi.fn>;
  let target: { fetch: typeof fetch };
  let logs: string[];

  beforeEach(() => {
    original = vi.fn(async () => new Response("real", { status: 200 }));
    target = { fetch: original as unknown as typeof fetch };
    logs = [];
  });

  it("does nothing outside a preview", async () => {
    expect(installPreviewFetchGuard({ VERCEL_ENV: "production" }, target, (m) => logs.push(m))).toBe(false);
    await target.fetch("https://api.resend.com/emails", { method: "POST" });
    expect(original).toHaveBeenCalledTimes(1);
    expect(logs).toEqual([]);
  });

  it("skips provider calls with a fake success and a log without the URL", async () => {
    installPreviewFetchGuard(PREVIEW, target, (m) => logs.push(m));
    const res = await target.fetch("https://api.telegram.org/bot123456:SECRET/sendMessage", { method: "post" });
    expect(original).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, success: true, id: "preview-skipped", code: "0" });
    expect(logs).toEqual(["preview: skipped telegram POST"]);
    expect(logs.join(" ")).not.toContain("SECRET");
  });

  it("passes other hosts through and installs once", async () => {
    installPreviewFetchGuard(PREVIEW, target, (m) => logs.push(m));
    const once = target.fetch;
    installPreviewFetchGuard(PREVIEW, target, (m) => logs.push(m));
    expect(target.fetch).toBe(once);
    await target.fetch("https://xmulfazzjaxbslcrenpg.supabase.co/auth/v1/user");
    expect(original).toHaveBeenCalledTimes(1);
  });
});

describe("real senders under the guard", () => {
  const realFetch = globalThis.fetch;
  let network: ReturnType<typeof vi.fn>;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    network = vi.fn(async () => new Response("{}", { status: 500 }));
    globalThis.fetch = network as unknown as typeof fetch;
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("RESEND_API_KEY", "re_test_not_real");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123456:not-real");
    installPreviewFetchGuard(PREVIEW);
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    warn.mockRestore();
    vi.unstubAllEnvs();
  });

  it("feedback email (Resend SDK) never reaches the network", async () => {
    const { sendFeedbackEmail } = await import("@/lib/email/feedback");
    const result = await sendFeedbackEmail({
      to: "owner@preview.invalid",
      fromUser: { id: "u1", whatsapp_number: null },
      message: "hola",
      pageUrl: null,
      userAgent: null,
    });
    expect(result.error).toBeNull();
    expect(network).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("preview: skipped resend POST");
  });

  it("Telegram admin bot never reaches the network", async () => {
    const { sendMessage } = await import("@/lib/telegram/bot");
    await sendMessage(1, "hola");
    expect(network).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("preview: skipped telegram POST");
  });
});

describe("crons and webhooks in a preview", () => {
  it.each([
    "/api/cron/match-reminders",
    "/api/cron",
    "/api/telegram/webhook",
    "/api/telegram/login",
    "/api/whatsapp/webhook",
    "/api/whatsapp/zernio",
    "/api/whatsapp/openwa/outbox",
    "/api/auth/sms-hook",
    "/api/sms/ack/",
  ])("refuses %s", async (path) => {
    expect(isPreviewRefusedPath(path)).toBe(true);
    const res = previewRefusal(path, PREVIEW);
    expect(res?.status).toBe(404);
    expect(await res?.json()).toEqual({ error: "disabled_in_preview" });
    expect(previewRefusal(path, { VERCEL_ENV: "production" })).toBeNull();
  });

  it.each(["/", "/login", "/api/casa/mis-pollas", "/api/feedback", "/api/cronista", "/api/auth/telegram/request"])(
    "keeps %s",
    (path) => {
      expect(isPreviewRefusedPath(path)).toBe(false);
      expect(previewRefusal(path, PREVIEW)).toBeNull();
    },
  );

  it("requireCronSecret answers 404 in a preview even with the right secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.stubEnv("VERCEL_ENV", "preview");
    try {
      const req = new NextRequest("https://x.vercel.app/api/cron/x", { headers: { authorization: "Bearer s3cret" } });
      const res = requireCronSecret(req);
      expect(res?.status).toBe(404);
      vi.stubEnv("VERCEL_ENV", "production");
      expect(requireCronSecret(req)).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("proxy and instrumentation are wired and shipped to Vercel", () => {
    expect(readFileSync("proxy.ts", "utf8")).toMatch(/const refused = previewRefusal\(request\.nextUrl\.pathname\);\s*if \(refused\) return refused;/);
    expect(readFileSync("instrumentation.ts", "utf8")).toContain("installPreviewFetchGuard()");
    expect(readFileSync(".vercelignore", "utf8")).toMatch(/^!\/instrumentation\.ts$/m);
  });
});
