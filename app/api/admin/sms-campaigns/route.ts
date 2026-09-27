import { NextResponse } from "next/server";
import { z } from "zod";
import { getSmsOwner } from "@/lib/sms/campaigns/access";
import { campaignCatalog, campaignHistory, campaignSchema, previewCampaign, sendCampaign } from "@/lib/sms/campaigns/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { audienceUser } from "@/lib/sms/campaigns/shared";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers });

export async function GET(request: Request) {
  const owner = await getSmsOwner();
  if (new URL(request.url).searchParams.get("access") === "1") return json({ allowed: !!owner });
  if (!owner) return json({ error: "Acceso exclusivo del titular autorizado." }, 403);
  try {
    const [catalog, history] = await Promise.all([campaignCatalog(owner.id), campaignHistory(owner.id)]);
    return json({ ...catalog, history });
  } catch { return json({ error: "No se pudo cargar el panel SMS. Intenta nuevamente." }, 503); }
}

export async function POST(request: Request) {
  // No CRON_SECRET bypass, no phone/name supplied by the client, no generic admin permission.
  const owner = await getSmsOwner();
  if (!owner) return json({ error: "Acceso exclusivo del titular autorizado." }, 403);
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Origen no permitido." }, 403);
  if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "Formato no permitido." }, 415);
  try {
    const raw = await request.text();
    if (raw.length > 1_000_000) return json({ error: "La solicitud es demasiado grande." }, 413);
    const body = JSON.parse(raw);
    if (body.action === "preview") return json(await previewCampaign(owner.id, campaignSchema.parse(body.input)));
    if (body.action === "send") {
      const { id } = z.object({ id: z.uuid(), confirmed: z.literal(true) }).parse(body);
      return json(await sendCampaign(owner.id, id));
    }
    if (body.action === "suppress") {
      const { userId } = z.object({ userId: z.uuid() }).parse(body);
      const db = createAdminClient();
      const { data, error } = await db.from("users").select("id,display_name,whatsapp_number").eq("id", userId).maybeSingle();
      if (error || !data) return json({ error: "Usuario no encontrado." }, 404);
      const user = audienceUser(data);
      if (!user) return json({ error: "Número no válido." }, 400);
      const { error: saveError } = await db.from("sms_marketing_suppressions").upsert({ phone: user.phone, created_by: owner.id }, { onConflict: "phone", ignoreDuplicates: true });
      if (saveError) throw new Error("No se pudo registrar la baja.");
      return json({ ok: true });
    }
    return json({ error: "Acción no reconocida." }, 400);
  } catch (error) {
    const message = error instanceof z.ZodError || error instanceof SyntaxError ? "Revisa los datos del formulario." : error instanceof Error ? error.message : "No se pudo completar la operación.";
    return json({ error: message }, 400);
  }
}
