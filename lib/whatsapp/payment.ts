// lib/whatsapp/payment.ts — WhatsApp-native payment method capture.
//
// Triggered after user joins su primera polla con buy-in > 0 (sea
// admin_collects o pay_winner). Le pedimos su método de pago una sola
// vez — se guarda en users.default_payout_* y se reusa para todas las
// pollas futuras. Editable después con el comando "pago".
//
// UX estructurado (no texto libre por defecto): lista de bancos, selecciona
// uno, input numérico. Decisión del user 2026-05-04: free-text genera typos
// tipo "niqui" en vez de "nequi" y rompe matching downstream.

import { createAdminClient } from "@/lib/supabase/admin";
import { sendTextMessage } from "./bot";
import { sendListMessage } from "./interactive";
import { setState, getState, clearState } from "./state";
import { downloadWhatsAppMedia } from "./media";
import {
  verifyPaymentScreenshot,
  type PayoutMethod,
} from "@/lib/vision/verify-payment";
import { logClaudeUsage } from "@/lib/vision/log-usage";

const FOOTER = "La Polla Colombiana 🐥";

const MAX_PROOFS_PER_POLLA = 2;
const MAX_UPLOADS_PER_USER_24H = 10;

// Catálogo de métodos de pago. El `id` se guarda en
// users.default_payout_method como slug canónico.
export const PAYMENT_METHODS: { id: string; label: string }[] = [
  { id: "nequi", label: "Nequi" },
  { id: "daviplata", label: "Daviplata" },
  { id: "bancolombia", label: "Bancolombia" },
  { id: "davivienda", label: "Davivienda" },
  { id: "bbva", label: "BBVA" },
  { id: "banco_bogota", label: "Banco de Bogotá" },
  { id: "caja_social", label: "Caja Social" },
  { id: "av_villas", label: "AV Villas" },
  { id: "otro", label: "Otro" },
];

/**
 * Returns true cuando el user todavía no tiene método de pago guardado.
 * Lo usamos como gate después de joinear primera polla con buy-in > 0.
 */
export async function userNeedsPaymentInfo(userId: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("users")
    .select("default_payout_method, default_payout_account")
    .eq("id", userId)
    .maybeSingle();
  if (!data) return true;
  return !data.default_payout_method || !data.default_payout_account;
}

// ─── Step 1: pedir banco ───

export async function askPaymentMethod(phone: string): Promise<void> {
  await setState(phone, { action: "waiting_payment_method" });

  const rows = PAYMENT_METHODS.map((m) => ({
    id: `paymeth_${m.id}`,
    title: m.label.slice(0, 24),
  }));

  await sendListMessage(
    phone,
    "Si ganas una polla, ¿cómo te transfieren? 💸\n\n" +
      "Esto se guarda una sola vez y lo reusamos para todas las pollas.",
    "Elegir banco",
    [{ title: "💳 Elige tu medio de pago", rows }],
    "💳 Medio de pago",
    FOOTER,
  );
}

// ─── Step 2: usuario seleccionó banco → pedir número/cuenta ───

export async function handlePaymentMethodSelected(
  phone: string,
  methodId: string,
): Promise<void> {
  const method = PAYMENT_METHODS.find((m) => m.id === methodId);
  if (!method) {
    await sendTextMessage(
      phone,
      "No reconocí esa opción parce. Escribe *pago* para empezar de nuevo.",
    );
    await clearState(phone);
    return;
  }

  // Guardamos el método en state.joinCode (reutilizando el campo varchar
  // para no migrar). Lo leemos al recibir el número en el siguiente step.
  await setState(phone, {
    action: "waiting_payment_account",
    joinCode: methodId, // overload: contiene el método elegido
  });

  if (methodId === "otro") {
    await sendTextMessage(
      phone,
      "Mándame los detalles de tu cuenta (banco, tipo, número).\n\n" +
        "Ejemplo: *Bancolombia ahorros 37949312312*",
    );
    return;
  }

  // Para Nequi/Daviplata/etc: pedir solo el número.
  await sendTextMessage(
    phone,
    `Mándame tu número de *${method.label}* (solo números).\n\n` +
      `Ejemplo: *3001234567*`,
  );
}

// ─── Step 3: usuario mandó el número → validar + guardar ───

export async function handlePaymentAccountSubmit(
  phone: string,
  userId: string,
  body: string,
): Promise<void> {
  const state = await getState(phone);
  const methodId = state?.joinCode;
  if (!methodId) {
    // State perdido — re-iniciar.
    await askPaymentMethod(phone);
    return;
  }
  const method = PAYMENT_METHODS.find((m) => m.id === methodId);
  if (!method) {
    await askPaymentMethod(phone);
    return;
  }

  const trimmed = body.trim();

  if (methodId === "otro") {
    // Texto libre — solo validamos longitud razonable.
    if (trimmed.length < 6 || trimmed.length > 120) {
      await sendTextMessage(
        phone,
        "Eso no parece info válida parce. Mandame algo como *Bancolombia ahorros 379...*",
        { userId },
      );
      return;
    }
    await savePayoutInfo(userId, methodId, trimmed, null);
    await clearState(phone);
    await sendTextMessage(
      phone,
      `✅ Listo. Guardé tu info de pago:\n*${trimmed}*\n\n` +
        `_Para cambiarla, escribe_ *pago* _en cualquier momento._\n` +
        `_Escribe_ *menu* _para volver al menú principal._`,
      { userId },
    );
    return;
  }

  // Bancos estructurados: solo dígitos, 8-15 chars (cubre Nequi 10,
  // Daviplata 10, cuentas de ahorros 8-13).
  const digits = trimmed.replace(/[\s-]/g, "");
  if (!/^\d{8,15}$/.test(digits)) {
    await sendTextMessage(
      phone,
      `Necesito solo *números*, sin espacios ni letras (entre 8 y 15 dígitos).\n\n` +
        `Mandame tu número de *${method.label}* otra vez.`,
      { userId },
    );
    return;
  }

  await savePayoutInfo(userId, methodId, digits, null);
  await clearState(phone);
  await sendTextMessage(
    phone,
    `✅ Listo parce. Guardé tu *${method.label}* al *${digits}*.\n\n` +
      `_Para cambiarla, escribe_ *pago* _en cualquier momento._\n` +
      `_Escribe_ *menu* _para volver al menú principal._`,
    { userId },
  );
}

async function savePayoutInfo(
  userId: string,
  method: string,
  account: string,
  accountName: string | null,
): Promise<void> {
  const supabase = createAdminClient();
  await supabase
    .from("users")
    .update({
      default_payout_method: method,
      default_payout_account: account,
      default_payout_account_name: accountName,
      default_payout_set_at: new Date().toISOString(),
    })
    .eq("id", userId);
}

// ─── Payment PROOF (admin_collects polla): pedir + procesar screenshot ───

/**
 * Pide al user que mande la foto del comprobante de pago. Setea state
 * waiting_payment_proof con el pollaId para saber a qué polla aplicar
 * cuando llegue la imagen.
 */
export async function askPaymentProof(
  phone: string,
  pollaId: string,
  pollaName: string,
  buyInAmount: number,
  payoutMethod: string,
  payoutAccount: string,
  payoutAccountName: string | null,
): Promise<void> {
  await setState(phone, {
    action: "waiting_payment_proof",
    pollaId,
  });

  const methodLabel =
    PAYMENT_METHODS.find((m) => m.id === payoutMethod)?.label ?? payoutMethod;

  const formattedAmount = new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(buyInAmount);

  await sendTextMessage(
    phone,
    `💸 *Para empezar a pronosticar en ${pollaName}*\n\n` +
      `Transfiere *${formattedAmount}* al organizador:\n\n` +
      `🏦 ${methodLabel}\n` +
      `🔢 ${payoutAccount}` +
      (payoutAccountName ? `\n👤 ${payoutAccountName}` : "") +
      `\n\nCuando hayas pagado, *mándame la foto del comprobante* aquí mismo 📸\n\n` +
      `_El comprobante se guarda 7 días y solo lo ve el organizador._`,
  );
}

/**
 * Procesa una imagen recibida cuando state.action === "waiting_payment_proof".
 * Baja la imagen de Meta CDN, la sube a Supabase Storage, llama al verifier
 * AI, persiste en payment_proofs, y marca paid=true si AI valida.
 *
 * Lógica idéntica a la del endpoint /api/pollas/[slug]/payment-proof —
 * compartida via lib/vision/verify-payment + lib/vision/log-usage.
 */
export async function handlePaymentProofImage(
  phone: string,
  userId: string,
  mediaId: string,
): Promise<void> {
  const state = await getState(phone);
  const pollaId = state?.pollaId;
  if (!pollaId) {
    await sendTextMessage(
      phone,
      "No tengo claro a qué polla pertenece este comprobante, parce. Escribe *menu* y elige tu polla primero.",
      { userId },
    );
    await clearState(phone);
    return;
  }

  const supabase = createAdminClient();

  // 1. Polla sanity checks
  const { data: polla } = await supabase
    .from("pollas")
    .select(
      "id, slug, name, payment_mode, buy_in_amount, admin_payout_method, admin_payout_account, admin_payout_account_name",
    )
    .eq("id", pollaId)
    .maybeSingle();
  if (!polla) {
    await sendTextMessage(phone, "No encontré esa polla.", { userId });
    await clearState(phone);
    return;
  }
  if (polla.payment_mode !== "admin_collects") {
    await sendTextMessage(phone, "Esta polla no necesita comprobante.", { userId });
    await clearState(phone);
    return;
  }
  if (
    !polla.admin_payout_method ||
    !polla.admin_payout_account ||
    !polla.buy_in_amount
  ) {
    await sendTextMessage(
      phone,
      "El organizador no terminó de configurar la cuenta. Pídele que la complete.",
      { userId },
    );
    await clearState(phone);
    return;
  }

  // 2. Participant check
  const { data: participant } = await supabase
    .from("polla_participants")
    .select("id, paid")
    .eq("polla_id", pollaId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!participant) {
    await sendTextMessage(phone, "No estás como participante de esta polla.", { userId });
    await clearState(phone);
    return;
  }
  if (participant.paid) {
    await sendTextMessage(phone, "Tu pago ya está aprobado. ¡Ya puedes pronosticar!", { userId });
    await clearState(phone);
    return;
  }

  // 3. Cap por polla (max 2 intentos por user) — mismo cap que el endpoint web
  const { data: existing } = await supabase
    .from("payment_proofs")
    .select("id")
    .eq("polla_id", pollaId)
    .eq("user_id", userId);
  if ((existing?.length ?? 0) >= MAX_PROOFS_PER_POLLA) {
    await sendTextMessage(
      phone,
      `Ya mandaste ${MAX_PROOFS_PER_POLLA} comprobantes de esta polla. Pídele al organizador que apruebe el pago manual.`,
      { userId },
    );
    await clearState(phone);
    return;
  }

  // 4. Throttle global 10/24h
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: recentCount } = await supabase
    .from("claude_api_usage")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("endpoint", "wa/payment-proof")
    .gte("created_at", since);
  if ((recentCount ?? 0) >= MAX_UPLOADS_PER_USER_24H) {
    await sendTextMessage(
      phone,
      "Mandaste muchos comprobantes hoy. Si es un error, contacta al organizador para que apruebe manual.",
      { userId },
    );
    await clearState(phone);
    return;
  }

  // 5. Bajar la imagen de Meta CDN
  let media;
  try {
    media = await downloadWhatsAppMedia(mediaId);
  } catch (err) {
    console.error("[wa/payment-proof] download failed:", err);
    await sendTextMessage(
      phone,
      "No pude descargar la foto, parce. Intenta enviarla de nuevo.",
      { userId },
    );
    return;
  }

  // Validar formato
  let mediaType: "image/jpeg" | "image/png" | "image/webp";
  if (media.mediaType === "image/jpeg" || media.mediaType === "image/jpg")
    mediaType = "image/jpeg";
  else if (media.mediaType === "image/png") mediaType = "image/png";
  else if (media.mediaType === "image/webp") mediaType = "image/webp";
  else {
    await sendTextMessage(
      phone,
      "Solo acepto fotos JPG, PNG o WebP. Manda el comprobante en otro formato.",
      { userId },
    );
    return;
  }
  if (media.size > 10 * 1024 * 1024) {
    await sendTextMessage(phone, "La foto es muy pesada (>10 MB). Intenta otra.", { userId });
    return;
  }

  // 6. Subir a Supabase Storage
  const ext = mediaType === "image/png" ? "png" : mediaType === "image/webp" ? "webp" : "jpg";
  const proofId = crypto.randomUUID();
  const storagePath = `pollas/${polla.id}/${userId}/${proofId}.${ext}`;
  const { error: uploadErr } = await supabase.storage
    .from("payment-proofs")
    .upload(storagePath, media.buffer, {
      contentType: mediaType,
      upsert: false,
    });
  if (uploadErr) {
    console.error("[wa/payment-proof] storage upload failed:", uploadErr);
    await sendTextMessage(
      phone,
      "No pude guardar el comprobante. Intenta de nuevo.",
      { userId },
    );
    return;
  }

  // (sin mensaje "verificando..." — el user ya ve la indicación de typing
  // del bot mientras procesamos. Ahorra spam.)

  // 8. Llamar al verifier AI
  const expected = {
    method: polla.admin_payout_method as PayoutMethod,
    account: polla.admin_payout_account,
    recipientName: polla.admin_payout_account_name ?? undefined,
    amountCOP: Number(polla.buy_in_amount),
  };

  let verifyResult;
  try {
    verifyResult = await verifyPaymentScreenshot({
      imageBase64: media.buffer.toString("base64"),
      imageMediaType: mediaType,
      expected,
    });
  } catch (err) {
    console.error("[wa/payment-proof] verifier failed:", err);
    void logClaudeUsage({
      userId,
      pollaId: polla.id,
      endpoint: "wa/payment-proof",
      model: "claude-sonnet-4-6",
      tokensIn: 0,
      tokensOut: 0,
      imageBytes: media.size,
      costUSD: 0,
      success: false,
      errorMessage: err instanceof Error ? err.message : "verifier error",
    });
    await supabase.from("payment_proofs").insert({
      id: proofId,
      polla_id: polla.id,
      user_id: userId,
      storage_path: storagePath,
      ai_valid: null,
      ai_rejection_reason: "Verificador AI no disponible — admin debe revisar manualmente.",
    });
    await clearState(phone);
    await sendTextMessage(
      phone,
      "El verificador automático no está disponible ahora. El organizador revisará tu comprobante manualmente.\n\n" +
        "_Escribe_ *menu* _para volver al menú principal._",
      { userId },
    );
    return;
  }

  // 9. Persistir resultado
  await supabase.from("payment_proofs").insert({
    id: proofId,
    polla_id: polla.id,
    user_id: userId,
    storage_path: storagePath,
    ai_source_type: verifyResult.sourceType,
    ai_valid: verifyResult.valid,
    ai_confidence: verifyResult.confidence,
    ai_detected_amount: verifyResult.detectedAmount,
    ai_detected_account: verifyResult.detectedAccount,
    ai_detected_recipient_name: verifyResult.detectedRecipientName,
    ai_detected_date: verifyResult.detectedDate,
    ai_rejection_reason: verifyResult.rejectionReason,
    ai_evidence: verifyResult.sourceEvidence,
    ai_tokens_in: verifyResult.tokensIn,
    ai_tokens_out: verifyResult.tokensOut,
    ai_cost_usd: verifyResult.costUSD,
  });

  void logClaudeUsage({
    userId,
    pollaId: polla.id,
    endpoint: "wa/payment-proof",
    model: verifyResult.model,
    tokensIn: verifyResult.tokensIn,
    tokensOut: verifyResult.tokensOut,
    imageBytes: media.size,
    costUSD: verifyResult.costUSD,
    success: true,
  });

  await clearState(phone);

  // 10. Si AI auto-aprueba, marcar paid y abrir polla menu
  if (verifyResult.valid) {
    await supabase
      .from("polla_participants")
      .update({
        paid: true,
        paid_at: new Date().toISOString(),
        payment_status: "approved",
      })
      .eq("id", participant.id);

    // SOLO el menú de la polla. Sin "comprobante aprobado!" + sin
    // ask de payment method (eso se hace cuando hagan su primera
    // predicción, no acá). El polla menu en sí ya tiene "🏆 nombre"
    // + Pronosticar/Tabla/Resultados — eso es la confirmación.
    const { handlePollaMenu } = await import("./flows");
    await handlePollaMenu(phone, userId, polla.id);
    return;
  }

  // 11. AI rechazó. Mensaje corto: pedile al organizador que apruebe.
  // Limpiamos el state — si quiere reintentar puede mandar otra foto y
  // el cap por polla lo deja hasta MAX_PROOFS_PER_POLLA.
  await clearState(phone);
  await sendTextMessage(
    phone,
    `❌ No pude aprobar el comprobante.\n\n` +
      `Pídele al organizador de *${polla.name}* que apruebe tu pago manualmente.\n\n` +
      `_Escribe_ *menu* _para volver al menú principal._`,
    { userId },
  );
}

// ─── Comando "pago": ver/cambiar info actual ───

export async function handleShowPaymentInfo(
  phone: string,
  userId: string,
): Promise<void> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("users")
    .select(
      "default_payout_method, default_payout_account, default_payout_account_name",
    )
    .eq("id", userId)
    .maybeSingle();

  const method = data?.default_payout_method;
  const account = data?.default_payout_account;

  if (!method || !account) {
    await askPaymentMethod(phone);
    return;
  }

  const label =
    PAYMENT_METHODS.find((m) => m.id === method)?.label ?? method;
  const display = method === "otro" ? account : `${label} ${account}`;

  await sendTextMessage(
    phone,
    `💳 *Tu medio de pago actual:*\n\n${display}\n\n` +
      `_Para cambiarlo, escribe_ *cambiar pago*`,
    { userId },
  );
}
