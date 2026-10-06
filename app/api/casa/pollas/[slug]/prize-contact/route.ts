import { getAuthenticatedUser } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { casaJson, requireCasaContract } from "@/lib/casa/operations";
import { getMyEntry, getPollaBySlug } from "@/lib/casa/queries";
import { isQuentroPolla, prizeContactSchema } from "@/lib/casa/prize-contact";
import { z } from "zod";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ slug: string }> };
const versionedContactSchema = prizeContactSchema.safeExtend({ requestId: z.string().uuid(), expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) });

function changedOwner(request: Request, userId: string) {
  const expectedOwner = request.headers.get("X-Casa-Owner");
  return expectedOwner && expectedOwner !== userId
    ? casaJson({ code: "SESSION_CHANGED", error: "Tu cuenta cambió. Vuelve a ingresar con la cuenta original; conservamos ambos correos." }, 412) : null;
}

async function participant(slug: string, userId: string) {
  const polla = await getPollaBySlug(slug);
  if (!polla || !isQuentroPolla(polla) || polla.status === "anulada") return null;
  if ((await getMyEntry(polla.id, userId))?.status !== "pagada") return null;
  return polla;
}

export async function GET(request: Request, { params }: Context) {
  const user = await getAuthenticatedUser();
  if (!user) return casaJson({ error: "No autenticado." }, 401);
  const ownerError = changedOwner(request, user.id);
  if (ownerError) return ownerError;
  try {
    const polla = await participant((await params).slug, user.id);
    if (!polla) return casaJson({ error: "Este formulario es para participantes de POLLA REGALO." }, 403);
    const db = createAdminClient();
    const [contact, payout] = await Promise.all([
      db.from("casa_prize_contacts").select("email, save_revision, last_request_id").eq("polla_id", polla.id).eq("user_id", user.id).maybeSingle(),
      db.from("casa_payouts").select("id, delivered_at").eq("polla_id", polla.id).eq("user_id", user.id).eq("prize_kind", "objeto").maybeSingle(),
    ]);
    if (contact.error || payout.error) throw new Error("read_failed");
    return casaJson({ owner_id: user.id, email: contact.data?.email ?? null, revision: contact.data?.save_revision ?? 0,
      request_id: contact.data?.last_request_id ?? null, winner: Boolean(payout.data),
      editable: !payout.data?.delivered_at && (polla.status !== "resuelta" || Boolean(payout.data)) });
  } catch {
    return casaJson({ error: "No se pudo cargar tu correo. Intenta de nuevo." }, 503);
  }
}

export async function POST(request: Request, { params }: Context) {
  const user = await getAuthenticatedUser();
  if (!user) return casaJson({ error: "No autenticado." }, 401);
  const ownerError = changedOwner(request, user.id);
  if (ownerError) return ownerError;
  const contractError = requireCasaContract(request);
  if (contractError) return contractError;
  const body: unknown = await request.json().catch(() => null);
  const versioned = typeof body === "object" && body !== null && ("requestId" in body || "expectedRevision" in body);
  const parsed = (versioned ? versionedContactSchema : prizeContactSchema).safeParse(body);
  if (!parsed.success) return casaJson({ error: "Escribe un correo válido y repítelo igual en ambos campos." }, 400);
  try {
    const polla = await participant((await params).slug, user.id);
    if (!polla) return casaJson({ error: "Este formulario es para participantes de POLLA REGALO." }, 403);
    const metadata = versionedContactSchema.safeParse(body);
    const { data, error } = await createAdminClient().rpc(versioned ? "casa_save_prize_contact_v2" : "casa_save_prize_contact", {
      p_polla_id: polla.id, p_user_id: user.id, p_email: parsed.data.email,
      ...(metadata.success ? { p_request_id: metadata.data.requestId, p_expected_revision: metadata.data.expectedRevision } : {}),
    });
    if (error) {
      if (["PRIZE_REQUEST_REUSED", "INVALID_PRIZE_REQUEST"].includes(error.message))
        return casaJson({ code: error.message, error: "No pudimos enviar este intento. Revisa ambos correos y vuelve a guardar." }, 400);
      if (["PRIZE_PARTICIPANT_REQUIRED", "PRIZE_WINNER_REQUIRED"].includes(error.message))
        return casaJson({ error: "Tu participación ya no permite cambiar el correo." }, 403);
      if (["PRIZE_CONTACT_NOT_AVAILABLE", "PRIZE_ALREADY_DELIVERED"].includes(error.message))
        return casaJson({ error: "La entrega ya no permite cambiar el correo. Comunícate con el administrador." }, 409);
      throw new Error("save_failed");
    }
    if (versioned && data?.conflict === true)
      return casaJson({ code: "PRIZE_CONTACT_CHANGED", error: "El correo cambió en otra pantalla. Revisa los datos antes de guardar." }, 409);
    if (!data || data.email !== parsed.data.email || typeof data.winner !== "boolean" || typeof data.editable !== "boolean") throw new Error("invalid_save_ack");
    if (metadata.success && (data.request_id !== metadata.data.requestId || !Number.isSafeInteger(data.revision) || data.revision <= metadata.data.expectedRevision))
      throw new Error("invalid_save_revision");
    return casaJson({ ...data, owner_id: user.id });
  } catch {
    return casaJson({ error: "No se pudo guardar tu correo. Intenta de nuevo." }, 503);
  }
}
