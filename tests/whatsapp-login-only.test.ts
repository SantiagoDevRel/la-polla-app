import { createHmac } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ incoming: vi.fn(), admin: vi.fn(), send: vi.fn(), optout: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/whatsapp/router", () => ({ processIncomingMessage: mocks.incoming }));
vi.mock("@/lib/whatsapp/bot", () => ({ sendTextMessage: mocks.send }));
vi.mock("@/lib/whatsapp/interactive", () => ({ sendCTAButton: mocks.send }));
vi.mock("@/lib/whatsapp/avisos", () => ({ isOptInText: vi.fn(), isOptOutText: vi.fn(), setOptOut: mocks.optout }));
import { POST } from "@/app/api/whatsapp/webhook/route";
import { whatsappOutboundEnabled } from "@/lib/whatsapp/outbound";

beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("META_WA_APP_SECRET", "test-secret"); });
afterEach(() => vi.unstubAllEnvs());
it.each(["quiero entrar a la polla", "2-1", "hola", "BAJA"])("does not reply or mutate accounts/predictions for %s", async text => {
  vi.stubEnv("WHATSAPP_OUTBOUND_ENABLED", "true");
  expect(whatsappOutboundEnabled()).toBe(false);
  const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { messages: [{ from: "573001234567", type: "text", text: { body: text } }] } }] }] });
  const signature = createHmac("sha256", "test-secret").update(raw).digest("hex");
  const res = await POST(new NextRequest("https://example.test/api/whatsapp/webhook", {
    method: "POST", body: raw, headers: { "x-hub-signature-256": `sha256=${signature}` },
  }));
  expect(res.status).toBe(200);
  expect(mocks.incoming).not.toHaveBeenCalled();
  expect(mocks.admin).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.optout).not.toHaveBeenCalled();
});
