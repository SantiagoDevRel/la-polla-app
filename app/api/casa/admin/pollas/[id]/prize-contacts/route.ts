import { getAuthenticatedUser } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { casaJson } from "@/lib/casa/operations";
import { QUENTRO_POLLA_ID } from "@/lib/casa/prize-contact";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return casaJson({ error: "No autenticado." }, 401);
  if (!user.is_admin) return casaJson({ error: "Solo el administrador." }, 403);
  const { id } = await params;
  if (id !== QUENTRO_POLLA_ID) return casaJson({ error: "No existe esta entrega." }, 404);
  try {
    const db = createAdminClient();
    const winners = await db.from("casa_payouts").select("user_id, delivered_at, users!casa_payouts_user_id_fkey(display_name)")
      .eq("polla_id", id).eq("prize_kind", "objeto").order("user_id");
    if (winners.error) throw new Error("read_failed");
    if (!winners.data?.length) {
      const preview = await db.rpc("casa_object_result_v1", { p_polla_id: id });
      if (preview.error) throw new Error("read_failed");
      if (preview.data?.state !== "ready" || !preview.data.winner) return casaJson({ winners: [] });
      const contact = await db.from("casa_prize_contacts").select("email")
        .eq("polla_id", id).eq("user_id", preview.data.winner.user_id).maybeSingle();
      if (contact.error) throw new Error("read_failed");
      return casaJson({ winners: [{ name: preview.data.winner.display_name ?? "Ganador calculado",
        email: contact.data?.email ?? null, delivered: false, provisional: true }] });
    }
    const contacts = await db.from("casa_prize_contacts").select("user_id, email")
      .eq("polla_id", id).in("user_id", winners.data.map((winner) => winner.user_id));
    if (contacts.error) throw new Error("read_failed");
    return casaJson({ winners: winners.data.map((winner) => {
      const profile = Array.isArray(winner.users) ? winner.users[0] : winner.users;
      return { name: profile?.display_name ?? "Ganador", email: contacts.data?.find((c) => c.user_id === winner.user_id)?.email ?? null,
        delivered: Boolean(winner.delivered_at), provisional: false };
    }) });
  } catch {
    return casaJson({ error: "No se pudo consultar el correo del ganador. Intenta de nuevo." }, 503);
  }
}
