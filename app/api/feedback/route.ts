// app/api/feedback/route.ts — Recibe el feedback del bubble en BrandHeader.
// Flujo:
//   1) auth (401 si no hay user)
//   2) validar mensaje (1..4000 chars)
//   3) insert en feedback (RLS: user_id = auth.uid())
//   4) fan-out best-effort: WhatsApp + email al admin. Si alguno falla,
//      la request NO falla — el row queda guardado y lo revisamos en DB.
//      Lo importante para el user es ver "gracias, recibido".
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTextMessage } from "@/lib/whatsapp/bot";
import { sendFeedbackEmail } from "@/lib/email/feedback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  message: z.string().trim().min(1).max(4000),
  pageUrl: z.string().max(500).nullable().optional(),
});

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let parsed;
  try {
    parsed = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const userAgent = req.headers.get("user-agent");

  const { data: row, error: insertErr } = await supabase
    .from("feedback")
    .insert({
      user_id: user.id,
      message: parsed.message,
      page_url: parsed.pageUrl ?? null,
      user_agent: userAgent,
    })
    .select("id")
    .single();

  if (insertErr) {
    console.error("[feedback] insert error:", insertErr);
    return NextResponse.json(
      { error: "No pudimos guardar tu reporte" },
      { status: 500 },
    );
  }

  // Best-effort fan-out — fallas no rompen la request.
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("users")
    .select("whatsapp_number")
    .eq("id", user.id)
    .single();

  const notifyPhone = process.env.FEEDBACK_NOTIFY_WHATSAPP;
  const notifyEmail = process.env.FEEDBACK_NOTIFY_EMAIL;

  const summaryLines = [
    "Nuevo feedback en La Polla",
    `User: ${profile?.whatsapp_number ?? user.id}`,
    parsed.pageUrl ? `Página: ${parsed.pageUrl}` : null,
    "",
    parsed.message.slice(0, 900),
  ].filter(Boolean) as string[];
  const summary = summaryLines.join("\n");

  if (notifyPhone) {
    try {
      await sendTextMessage(notifyPhone, summary);
    } catch (err) {
      console.error("[feedback] WA notify failed:", err);
    }
  } else {
    console.warn("[feedback] FEEDBACK_NOTIFY_WHATSAPP not set — skip WA fan-out");
  }

  if (notifyEmail) {
    try {
      await sendFeedbackEmail({
        to: notifyEmail,
        fromUser: {
          id: user.id,
          whatsapp_number: profile?.whatsapp_number ?? null,
        },
        message: parsed.message,
        pageUrl: parsed.pageUrl ?? null,
        userAgent,
      });
    } catch (err) {
      console.error("[feedback] email notify failed:", err);
    }
  } else {
    console.warn("[feedback] FEEDBACK_NOTIFY_EMAIL not set — skip email fan-out");
  }

  return NextResponse.json({ ok: true, id: row.id });
}
