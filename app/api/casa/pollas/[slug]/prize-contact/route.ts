import { getAuthenticatedUser } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { casaJson, requireCasaContract } from "@/lib/casa/operations";
import { getMyEntry, getPollaBySlug } from "@/lib/casa/queries";
import { isQuentroPolla, prizeContactSchema } from "@/lib/casa/prize-contact";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ slug: string }> };

async function participant(slug: string, userId: string) {
  const polla = await getPollaBySlug(slug);
  if (!polla || !isQuentroPolla(polla) || polla.status === "anulada") return null;
  if ((await getMyEntry(polla.id, userId))?.status !== "pagada") return null;
  return polla;
}

export async function GET(_request: Request, { params }: Context) {
  const user = await getAuthenticatedUser();
  if (!user) return casaJson({ error: "No autenticado." }, 401);
  try {
    const polla = await participant((await params).slug, user.id);
    if (!polla) return casaJson({ error: "Este formulario es para participantes de POLLA REGALO." }, 403);
    const db = createAdminClient();
    const [contact, payout] = await Promise.all([
      db.from("casa_prize_contacts").select("email").eq("polla_id", polla.id).eq("user_id", user.id).maybeSingle(),
      db.from("casa_payouts").select("id, delivered_at").eq("polla_id", polla.id).eq("user_id", user.id).eq("prize_kind", "objeto").maybeSingle(),
    ]);
    if (contact.error || payout.error) throw new Error("read_failed");
    return casaJson({ email: contact.data?.email ?? null, winner: Boolean(payout.data),
      editable: !payout.data?.delivered_at && (polla.status !== "resuelta" || Boolean(payout.data)) });
  } catch {
    return casaJson({ error: "No se pudo cargar tu correo. Intenta de nuevo." }, 503);
  }
}

export async function POST(request: Request, { params }: Context) {
  const user = await getAuthenticatedUser();
  if (!user) return casaJson({ error: "No autenticado." }, 401);
  const contractError = requireCasaContract(request);
  if (contractError) return contractError;
  const parsed = prizeContactSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return casaJson({ error: "Escribe un correo válido y repítelo igual en ambos campos." }, 400);
  try {
    const polla = await participant((await params).slug, user.id);
    if (!polla) return casaJson({ error: "Este formulario es para participantes de POLLA REGALO." }, 403);
    const { data, error } = await createAdminClient().rpc("casa_save_prize_contact", {
      p_polla_id: polla.id, p_user_id: user.id, p_email: parsed.data.email,
    });
    if (error) {
      if (["PRIZE_PARTICIPANT_REQUIRED", "PRIZE_WINNER_REQUIRED"].includes(error.message))
        return casaJson({ error: "Tu participación ya no permite cambiar el correo." }, 403);
      if (["PRIZE_CONTACT_NOT_AVAILABLE", "PRIZE_ALREADY_DELIVERED"].includes(error.message))
        return casaJson({ error: "La entrega ya no permite cambiar el correo. Comunícate con el administrador." }, 409);
      throw new Error("save_failed");
    }
    return casaJson(data);
  } catch {
    return casaJson({ error: "No se pudo guardar tu correo. Intenta de nuevo." }, 503);
  }
}
