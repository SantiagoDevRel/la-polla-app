import { createAdminClient } from "@/lib/supabase/admin";
import { getPot } from "@/lib/casa/queries";
import { formatCop } from "@/lib/casa/format";
import { sendTextMessage } from "@/lib/whatsapp/bot";

/** Both admin channels send the same best-effort notice after a new decision. */
export async function notifyCasaReview(entryId: string, pollaId: string, approved: boolean) {
  try {
    const db = createAdminClient();
    const [{ data: entry }, { data: polla }, pot] = await Promise.all([
      db.from("casa_entries").select("user_id").eq("id", entryId).eq("polla_id", pollaId).single(),
      db.from("casa_pollas").select("name, slug, prize_kind, prize_object, kind").eq("id", pollaId).single(),
      getPot(pollaId),
    ]);
    if (entry && polla) await notifyPlayer({ userId: entry.user_id, aprobado: approved,
      pollaName: polla.name, pollaSlug: polla.slug, pozoCop: pot.prize_cop,
      prizeKind: polla.prize_kind, prizeObject: polla.prize_object, kind: polla.kind });
  } catch { console.warn("[casa] Revisión registrada; no se pudo enviar el aviso al jugador."); }
}

async function notifyPlayer(n: {
  userId: string;
  aprobado: boolean;
  pollaName: string;
  pollaSlug: string;
  pozoCop: number;
  prizeKind: "pozo" | "objeto";
  prizeObject: string | null;
  kind: string;
}) {
  try {
    const db = createAdminClient();
    const { data: u } = await db
      .from("users")
      .select("whatsapp_number")
      .eq("id", n.userId)
      .maybeSingle();
    if (!u?.whatsapp_number) return;

    const url = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://lapollacolombiana.com"}/casa/${n.pollaSlug}`;

    const texto = n.aprobado
      ? [
          `✅ *Quedaste dentro de ${n.pollaName}*`,
          "",
          n.prizeKind === "objeto" ? `Tu pago quedó confirmado. Participas por ${n.prizeObject ?? "el premio en objeto"}.` : `Tu pago quedó confirmado. El pozo va en ${formatCop(n.pozoCop)}.`,
          "",
          n.kind === "rifa" ? `Consulta tu boleta 👉 ${url}` : `Guarda tus pronósticos antes del cierre 👉 ${url}`,
        ].join("\n")
      : [
          `❌ *No pude confirmar tu pago de ${n.pollaName}*`,
          "",
          "Revisa el comprobante y vuelve a subirlo, o escríbeme para resolverlo.",
          "",
          url,
        ].join("\n");

    await sendTextMessage(u.whatsapp_number, texto, { userId: n.userId });
  } catch (err) {
    console.warn("[telegram] no pude avisarle al jugador:", (err as Error).message);
  }
}

