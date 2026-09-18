import { createAdminClient } from "@/lib/supabase/admin";
import { getPot } from "@/lib/casa/queries";
import { formatCop } from "@/lib/casa/format";
import { sendTextMessage } from "@/lib/whatsapp/bot";
import { notifyPlayerReviewByTelegram } from "@/lib/telegram-player/notify";
import { notifyReferralGifts } from "@/lib/casa/referrals";

/** Both admin channels send the same best-effort notice after a new decision. */
export async function notifyCasaReview(entryId: string, pollaId: string, approved: boolean) {
  try {
    const db = createAdminClient();
    const [{ data: entry }, { data: polla }, pot] = await Promise.all([
      db.from("casa_entries").select("user_id, reject_reason, ticket_number, entry_number").eq("id", entryId).eq("polla_id", pollaId).single(),
      db.from("casa_pollas").select("name, slug, prize_kind, prize_object, kind").eq("id", pollaId).single(),
      getPot(pollaId),
    ]);
    if (entry && polla) {
      // Telegram primero: WhatsApp está apagado (lib/whatsapp/outbound.ts) y el
      // bot de jugadores es por donde la gente se inscribe sin la web.
      await notifyPlayerReviewByTelegram(db, {
        userId: entry.user_id, pollaId, pollaName: polla.name, kind: polla.kind, approved,
        prizeKind: polla.prize_kind, prizeObject: polla.prize_object, pozoCop: pot.prize_cop,
        rejectReason: entry.reject_reason ?? null, ticketNumber: entry.ticket_number ?? null,
        entryNumber: entry.entry_number ?? null,
      });
      const numbered = entry.entry_number != null && entry.entry_number > 1;
      await notifyPlayer({ userId: entry.user_id, aprobado: approved,
        pollaName: numbered ? `${polla.name} (cupo ${entry.entry_number})` : polla.name,
        pollaSlug: numbered ? `${polla.slug}?p=${entry.entry_number}` : polla.slug, pozoCop: pot.prize_cop,
        prizeKind: polla.prize_kind, prizeObject: polla.prize_object, kind: polla.kind });
    }
    // Una aprobación puede completar los invitados de alguien (migración 135):
    // SQL ya creó el cupo de regalo; aquí solo se avisa.
    if (approved) await notifyReferralGifts(db);
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

    const url = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://lapollacolombiana.com"}/polla/${n.pollaSlug}`;

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

