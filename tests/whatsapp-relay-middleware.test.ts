import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Machine callers (Zernio, the OpenWA relay) have no browser session. Their
// routes authenticate with HMAC themselves; a login redirect would silently
// break them (poll-sent shipped without this exemption on 2026-10-31).
describe("WhatsApp machine routes skip the login redirect", () => {
  it.each([
    "/api/whatsapp/zernio",
    "/api/whatsapp/openwa",
    "/api/whatsapp/openwa/outbox",
    "/api/whatsapp/openwa/poll-sent",
  ])("%s reaches its handler", async (path) => {
    const response = await updateSession(new NextRequest(`https://lapollacolombiana.com${path}`, { method: "POST" }));
    expect(response.headers.get("location")).toBeNull();
    expect(response.status).toBe(200);
  });
});
