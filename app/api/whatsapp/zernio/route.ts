import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { setMarketingPreference } from "@/lib/whatsapp/marketing-preferences";
import { confirmPreference, parsePreferenceEvent, verifyZernioSignature } from "@/lib/whatsapp/zernio-preferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (Number(request.headers.get("content-length")) > 65536) return new NextResponse(null, { status: 413 });
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 65536) return new NextResponse(null, { status: 413 });
  if (!verifyZernioSignature(raw, request.headers.get("x-zernio-signature"), process.env.ZERNIO_WEBHOOK_SECRET)) {
    return new NextResponse(null, { status: 401 });
  }
  let payload;
  try { payload = JSON.parse(raw); } catch { return new NextResponse(null, { status: 400 }); }
  if (payload.event === "webhook.test") return NextResponse.json({ ok: true });
  try {
    const event = parsePreferenceEvent(payload, process.env.ZERNIO_WHATSAPP_ACCOUNT_ID);
    if (!event) return NextResponse.json({ ok: true, ignored: true });
    const db = createAdminClient();
    const state = await setMarketingPreference(db, { ...event, source: "whatsapp" });
    // Late delivery still saves BAJA, but must not send outside the service window.
    if (state.current && !state.replySent && Date.now() - Date.parse(event.occurredAt) < 23 * 60 * 60_000) {
      if (!(await confirmPreference(event.conversationId, state.enabled, event.eventId))) {
        return NextResponse.json({ error: "confirmation_pending" }, { status: 503 });
      }
      const { error } = await db.from("wa_marketing_events").update({ reply_sent: true })
        .eq("event_id", event.eventId).eq("phone", event.phone);
      if (error) return new NextResponse(null, { status: 503 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    // No phone numbers, message bodies, tokens or provider errors in logs.
    return NextResponse.json({ error: "preference_unavailable" }, { status: 503 });
  }
}
