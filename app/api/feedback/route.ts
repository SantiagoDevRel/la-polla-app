// app/api/feedback/route.ts — Recibe el feedback del bubble en BrandHeader.
// Flujo:
//   1) auth (401 si no hay user)
//   2) validar mensaje (1..4000 chars)
//   3) insert en feedback (RLS: user_id = auth.uid())
//   4) fan-out best-effort: WhatsApp + email al admin. Si alguno falla,
//      la request NO falla — el row queda guardado y lo revisamos en DB.
//      Lo importante para el user es ver "gracias, recibido".
import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { notifyFeedback } from "@/lib/feedback/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  message: z.string().trim().min(1).max(4000),
  pageUrl: z.string().max(500).nullable().optional(),
  requestId: z.string().uuid().optional(),
});

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "Necesitas iniciar sesión." }, 401);
  if (!req.nextUrl.searchParams.has("requestId")) return json({ ok: true, owner_id: user.id });
  const parsed = z.string().uuid().safeParse(req.nextUrl.searchParams.get("requestId"));
  if (!parsed.success) return json({ error: "Solicitud inválida." }, 400);
  const { data: report, error } = await supabase.from("feedback").select("id, request_id, message, page_url")
    .eq("user_id", user.id).eq("request_id", parsed.data).maybeSingle();
  if (error) return json({ error: "No pudimos confirmar el reporte." }, 503);
  return json({ ok: true, owner_id: user.id, request_id: parsed.data, report });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return json({ error: "Necesitas iniciar sesión." }, 401);
  }

  const expectedOwner = req.headers.get("X-Feedback-Owner");
  if (expectedOwner && expectedOwner !== user.id) {
    return json({ code: "ACCOUNT_CHANGED", error: "Tu cuenta cambió. Revisa tu perfil e ingresa con la cuenta original; conservamos tu reporte." }, 412);
  }
  let parsed;
  try {
    parsed = Body.parse(await req.json());
  } catch {
    return json({ error: "Solicitud inválida." }, 400);
  }

  const userAgent = req.headers.get("user-agent");
  if (parsed.requestId && !expectedOwner) return json({ error: "Actualiza la app para enviar este reporte." }, 409);

  const { data: row, error: insertErr } = await supabase
    .from("feedback")
    .insert({
      user_id: user.id,
      message: parsed.message,
      page_url: parsed.pageUrl ?? null,
      user_agent: userAgent,
      request_id: parsed.requestId ?? null,
    })
    .select("id, request_id")
    .single();

  if (insertErr) {
    if (insertErr.code === "23505" && parsed.requestId) {
      const { data: existing, error } = await supabase.from("feedback").select("id, request_id, message, page_url")
        .eq("user_id", user.id).eq("request_id", parsed.requestId).maybeSingle();
      if (!error && existing) {
        if (existing.message !== parsed.message || existing.page_url !== (parsed.pageUrl ?? null)) {
          return json({ error: "Este intento corresponde a otro reporte. Conserva el mensaje original." }, 409);
        }
        return json({ ok: true, owner_id: user.id, id: existing.id, request_id: existing.request_id });
      }
    }
    console.error("[feedback] insert unavailable");
    return json({ error: "No pudimos confirmar tu reporte. Conservamos el mensaje para reintentar." }, 503);
  }

  if (!row?.id || (parsed.requestId && row.request_id !== parsed.requestId)) {
    return json({ error: "No pudimos confirmar tu reporte. Conservamos el mensaje para reintentar." }, 503);
  }
  after(() => notifyFeedback({ userId: user.id, message: parsed.message, pageUrl: parsed.pageUrl ?? null, userAgent }));
  return json({ ok: true, owner_id: user.id, id: row.id, request_id: row.request_id });
}
