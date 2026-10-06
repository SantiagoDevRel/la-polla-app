import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ outbound: vi.fn(), post: vi.fn(), db: vi.fn() }));
vi.mock("axios", () => ({ default: { post: mocks.post } }));
vi.mock("@/lib/whatsapp/outbound", () => ({ whatsappOutboundEnabled: mocks.outbound, WHATSAPP_OUTBOUND_DISABLED: "disabled" }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.db }));
import { sendButtonMessage, sendListMessage, sendTextMessage, sendWhatsAppMessage } from "@/lib/whatsapp/bot";
import { sendFeedbackEmail } from "@/lib/email/feedback";
import { notifyFeedback } from "@/lib/feedback/notify";
const email = { to: "test@example.invalid", fromUser: { id: "test-user", whatsapp_number: null }, message: "synthetic", pageUrl: "/test", userAgent: null };
beforeEach(() => {
  vi.clearAllMocks(); mocks.outbound.mockReturnValue(false);
  vi.stubEnv("RESEND_API_KEY", "synthetic-not-a-key"); vi.stubEnv("META_WA_ACCESS_TOKEN", "synthetic-not-a-token"); vi.stubEnv("META_WA_PHONE_NUMBER_ID", "synthetic");
  const chain = { from: () => chain, select: () => chain, eq: () => chain, abortSignal: () => chain, maybeSingle: async () => ({ data: { whatsapp_number: null }, error: null }) };
  mocks.db.mockReturnValue(chain);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("retains the no-op gate for every legacy WhatsApp wrapper even with a signal", async () => {
  const signal = new AbortController().signal;
  await sendTextMessage("synthetic", "text", { signal });
  await sendWhatsAppMessage("synthetic", "text", { signal });
  await sendButtonMessage("synthetic", "header", "body", [], { signal });
  await sendListMessage("synthetic", "header", "body", "open", [], { signal });
  expect(mocks.post).not.toHaveBeenCalled(); expect(mocks.db).not.toHaveBeenCalled();
});
it("passes cancellation through the actual installed Resend SDK without sending anything", async () => {
  const controller = new AbortController();
  const fetch = vi.fn((_url, init: RequestInit) => new Promise<Response>((_, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  })); vi.stubGlobal("fetch", fetch);
  const sending = sendFeedbackEmail({ ...email, signal: controller.signal });
  expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][1].signal).toBe(controller.signal);
  const failure = expect(sending).rejects.toThrow("not accepted"); controller.abort(); await failure;
});
it("aborts both stuck providers after eight seconds and performs no retry", async () => {
  vi.useFakeTimers(); mocks.outbound.mockReturnValue(true);
  vi.stubEnv("FEEDBACK_NOTIFY_WHATSAPP", "synthetic"); vi.stubEnv("FEEDBACK_NOTIFY_EMAIL", email.to);
  const signals: AbortSignal[] = [];
  mocks.post.mockImplementation((_url, _body, init) => new Promise((_, reject) => {
    signals.push(init.signal); init.signal.addEventListener("abort", () => reject(new Error("synthetic abort")), { once: true });
  }));
  const fetch = vi.fn((_url, init: RequestInit) => new Promise<Response>((_, reject) => {
    signals.push(init.signal as AbortSignal); init.signal?.addEventListener("abort", () => reject(new Error("synthetic abort")), { once: true });
  })); vi.stubGlobal("fetch", fetch);
  const work = notifyFeedback({ userId: "test-user", message: "synthetic", pageUrl: "/test", userAgent: null });
  await vi.advanceTimersByTimeAsync(0);
  expect(signals).toHaveLength(2); expect(signals.every((signal) => !signal.aborted)).toBe(true);
  await vi.advanceTimersByTimeAsync(8_000); await work;
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(mocks.post).toHaveBeenCalledTimes(1); expect(fetch).toHaveBeenCalledTimes(1);
});
