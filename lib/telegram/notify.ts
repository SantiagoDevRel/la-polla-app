// lib/telegram/notify.ts — lo que el bot le avisa a Tama.
//
// Best-effort SIEMPRE: si Telegram esta caido, la fila de la inscripcion ya
// quedo guardada y el pago se puede aprobar igual desde /pendientes. Nunca
// tumbamos la request del usuario por una notificacion.

import { createAdminClient } from "@/lib/supabase/admin";
import { esc, sendMessage, sendPhoto, type InlineButton } from "./bot";
import { listActiveAdminChats } from "./admin";
import { formatCop } from "@/lib/casa/format";

// Bucket privado que ya existia en el proyecto (10 MB por archivo). Se reusa
// en vez de crear uno nuevo: menos superficie que asegurar.
export const PROOF_BUCKET = "payment-proofs";

/** URL firmada del comprobante (1h). Telegram la descarga y se queda la copia. */
export async function signedProofUrl(path: string): Promise<string | null> {
  const db = createAdminClient();
  const { data, error } = await db.storage
    .from(PROOF_BUCKET)
    .createSignedUrl(path, 3600);
  if (error) {
    console.warn("[telegram] no pude firmar el comprobante:", error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}

interface ProofNotice {
  entryId: string;
  attemptId: string;
  prizeKind: "pozo" | "objeto";
  prizeObject: string | null;
  pollaName: string;
  pollaSlug: string;
  userName: string;
  userPhone?: string | null;
  amountCop: number;
  proofPath: string | null;
  ticketNumber?: number | null;
  potAfterCop: number;
}

/**
 * "Fulanito pago X en la polla Y" + la foto + [Aprobar] [Rechazar].
 * Se manda a TODOS los chats vinculados; el primero que decida, decide.
 */
export async function notifyNewProof(n: ProofNotice): Promise<void> {
  const chats = await listActiveAdminChats();
  if (chats.length === 0) {
    console.warn("[telegram] hay un pago pendiente pero no hay admin vinculado");
    return;
  }

  const buttons: InlineButton[][] = [
    [
      { text: "✅ Aprobar", callback_data: `ok2:${n.attemptId}` },
      { text: "❌ Rechazar", callback_data: `no2:${n.attemptId}` },
    ],
  ];

  const lineas = [
    `<b>💸 Pago nuevo por revisar</b>`,
    ``,
    `<b>${esc(n.userName)}</b>${n.userPhone ? ` · ${esc(n.userPhone)}` : ""}`,
    `Polla: <b>${esc(n.pollaName)}</b>`,
    n.ticketNumber != null ? `Boleta: <b>#${n.ticketNumber}</b>` : null,
    `Valor: <b>${formatCop(n.amountCop)}</b>`,
    ``,
    n.prizeKind === "objeto" ? `Participa por <b>${esc(n.prizeObject ?? "el premio en objeto")}</b>. No hay reparto de dinero.` : `Si lo apruebas, el pozo queda en <b>${formatCop(n.potAfterCop)}</b>.`,
  ]
    .filter(Boolean)
    .join("\n");

  const url = n.proofPath ? await signedProofUrl(n.proofPath) : null;

  for (const chat of chats) {
    // Si Telegram no puede bajar la foto (URL vencida, >5 MB, medidas fuera de
    // sus límites), sendPhoto devuelve null. Antes eso dejaba al admin sin
    // ningún aviso; ahora llega el texto con los mismos botones.
    const sent =
      (url ? await sendPhoto(chat, url, lineas, buttons) : null) ??
      (await sendMessage(
        chat,
        `${lineas}\n\n⚠️ ${url ? "No pude mostrar la foto del comprobante" : "No pude cargar el comprobante"}. Revísalo en la web.`,
        buttons,
      ));

    if (sent) {
      await createAdminClient()
        .from("telegram_outbox")
        .insert({
          kind: "proof_review",
          ref_id: n.entryId,
          chat_id: chat,
          message_id: sent.message_id,
        });
    }
  }
}

/** Aviso simple a todos los admins (cierres, resoluciones, errores de cron). */
export async function notifyAdmins(text: string): Promise<void> {
  const chats = await listActiveAdminChats();
  await Promise.all(chats.map((c) => sendMessage(c, text)));
}
