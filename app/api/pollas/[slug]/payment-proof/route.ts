// app/api/pollas/[slug]/payment-proof/route.ts
//
// POST — el participante (modo admin_collects) sube el screenshot
// del pago al admin. Server hace:
//
//   1. Auth + valida que el viewer es participante de la polla
//      con paid=false todavía.
//   2. Cap: máximo 1 screenshot por (polla, user) — defensa anti-abuso.
//   3. Throttle global: máximo 10 uploads por user en las últimas 24h
//      (cualquier polla). Si pasa, flaggeamos en claude_api_usage.
//   4. Preprocesa la imagen client-side ya — el endpoint trustea que
//      vino al ~1568px JPEG (puede caer fallback a server-side resize
//      cuando arme sharp, pero por ahora trust al cliente).
//   5. Sube el file a Supabase Storage bucket payment-proofs.
//   6. Llama a Sonnet vision con la cuenta del admin de esa polla.
//   7. Si valid=true Y source=bank_app/wallet → marca paid=true
//      en polla_participants. El user puede pronosticar al instante.
//   8. Persiste el resultado en payment_proofs (audit trail + admin
//      review queue).
//   9. Loggea en claude_api_usage.
//
// El admin tiene una review queue separada (/admin/payment-proofs)
// donde puede revertir cualquier auto-aprobación si detecta algo raro.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  verifyPaymentScreenshot,
  type PayoutMethod,
} from "@/lib/vision/verify-payment";
import { logClaudeUsage } from "@/lib/vision/log-usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOADS_PER_USER_24H = 10;
const ENDPOINT_NAME = "pollas/payment-proof";

export async function POST(
  request: NextRequest,
  { params }: { params: { slug: string } },
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const admin = createAdminClient();

  // 1. Polla + sanity checks
  const { data: polla } = await admin
    .from("pollas")
    .select(
      "id, slug, payment_mode, buy_in_amount, admin_payout_method, admin_payout_account, admin_payout_account_name, created_by",
    )
    .eq("slug", params.slug)
    .maybeSingle();
  if (!polla) {
    return NextResponse.json({ error: "Polla no encontrada" }, { status: 404 });
  }
  if (polla.payment_mode !== "admin_collects") {
    return NextResponse.json(
      { error: "Esta polla no usa pago al principio." },
      { status: 400 },
    );
  }
  if (!polla.admin_payout_method || !polla.admin_payout_account) {
    return NextResponse.json(
      {
        error:
          "El organizador todavía no configuró su cuenta de cobro. Pídele que la complete antes de que puedas subir comprobante.",
      },
      { status: 409 },
    );
  }
  if (!polla.buy_in_amount || polla.buy_in_amount <= 0) {
    return NextResponse.json({ error: "Polla sin cuota" }, { status: 400 });
  }

  // 2. Participant exists + not yet paid
  const { data: participant } = await admin
    .from("polla_participants")
    .select("id, paid")
    .eq("polla_id", polla.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!participant) {
    return NextResponse.json(
      { error: "No sos participante de esta polla" },
      { status: 403 },
    );
  }
  if (participant.paid) {
    return NextResponse.json(
      { error: "Tu pago ya está aprobado." },
      { status: 409 },
    );
  }

  // 3. Cap: 1 proof por (polla, user)
  const { data: existingProof } = await admin
    .from("payment_proofs")
    .select("id, admin_decision")
    .eq("polla_id", polla.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (existingProof && existingProof.admin_decision !== false) {
    // Si admin ya rechazó (admin_decision=false), permitimos un segundo
    // upload. Si está pendiente o aprobado, no.
    return NextResponse.json(
      {
        error:
          "Ya subiste un comprobante. Esperá a que el organizador lo revise.",
      },
      { status: 409 },
    );
  }

  // 4. Throttle global por user — 10 uploads en 24h.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: recentCount } = await admin
    .from("claude_api_usage")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("endpoint", ENDPOINT_NAME)
    .gte("created_at", since);
  if ((recentCount ?? 0) >= MAX_UPLOADS_PER_USER_24H) {
    return NextResponse.json(
      {
        error:
          "Subiste demasiados comprobantes hoy. Si es un error de la AI, contactá al organizador para que apruebe manual.",
      },
      { status: 429 },
    );
  }

  // 5. Form data
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const image = formData.get("image");
  if (!(image instanceof File) || image.size === 0) {
    return NextResponse.json({ error: "Falta la imagen" }, { status: 400 });
  }
  if (image.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "Imagen mayor a 10 MB" }, { status: 413 });
  }
  let mediaType: "image/jpeg" | "image/png" | "image/webp";
  if (image.type === "image/jpeg" || image.type === "image/jpg")
    mediaType = "image/jpeg";
  else if (image.type === "image/png") mediaType = "image/png";
  else if (image.type === "image/webp") mediaType = "image/webp";
  else {
    return NextResponse.json(
      { error: "Formato no soportado. Usá JPG, PNG o WebP." },
      { status: 400 },
    );
  }

  // 6. Subir a Storage bucket
  const ext = mediaType === "image/png" ? "png" : mediaType === "image/webp" ? "webp" : "jpg";
  const proofId = crypto.randomUUID();
  const storagePath = `pollas/${polla.id}/${user.id}/${proofId}.${ext}`;
  const buf = Buffer.from(await image.arrayBuffer());

  const { error: uploadErr } = await admin.storage
    .from("payment-proofs")
    .upload(storagePath, buf, {
      contentType: mediaType,
      upsert: false,
    });
  if (uploadErr) {
    console.error("[payment-proof] storage upload failed:", uploadErr);
    return NextResponse.json(
      { error: "No se pudo guardar el screenshot" },
      { status: 500 },
    );
  }

  // 7. Llamar al verifier AI
  const base64 = buf.toString("base64");
  const expected = {
    method: polla.admin_payout_method as PayoutMethod,
    account: polla.admin_payout_account,
    recipientName: polla.admin_payout_account_name ?? undefined,
    amountCOP: Number(polla.buy_in_amount),
  };

  let verifyResult;
  try {
    verifyResult = await verifyPaymentScreenshot({
      imageBase64: base64,
      imageMediaType: mediaType,
      expected,
    });
  } catch (err) {
    console.error("[payment-proof] verifier failed:", err);
    // Si falla la AI, mantenemos el upload pero marcamos pendiente
    // de revisión manual del admin. NO marcamos paid.
    void logClaudeUsage({
      userId: user.id,
      pollaId: polla.id,
      endpoint: ENDPOINT_NAME,
      model: "claude-sonnet-4-6",
      tokensIn: 0,
      tokensOut: 0,
      imageBytes: image.size,
      costUSD: 0,
      success: false,
      errorMessage: err instanceof Error ? err.message : "verifier error",
    });
    await admin.from("payment_proofs").insert({
      id: proofId,
      polla_id: polla.id,
      user_id: user.id,
      storage_path: storagePath,
      ai_valid: null,
      ai_rejection_reason: "Verificador AI no disponible — admin debe revisar manualmente.",
    });
    return NextResponse.json({
      ok: true,
      autoApproved: false,
      reason: "El verificador automático no está disponible ahora. El organizador revisará tu comprobante manualmente.",
    });
  }

  // 8. Persistir el resultado
  await admin.from("payment_proofs").insert({
    id: proofId,
    polla_id: polla.id,
    user_id: user.id,
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
    userId: user.id,
    pollaId: polla.id,
    endpoint: ENDPOINT_NAME,
    model: verifyResult.model,
    tokensIn: verifyResult.tokensIn,
    tokensOut: verifyResult.tokensOut,
    imageBytes: image.size,
    costUSD: verifyResult.costUSD,
    success: true,
  });

  // 9. Si AI auto-aprueba, marcar paid=true. Admin tiene 7 días para
  //    revertir desde /admin/payment-proofs.
  let autoApproved = false;
  if (verifyResult.valid) {
    const { error: updateErr } = await admin
      .from("polla_participants")
      .update({
        paid: true,
        paid_at: new Date().toISOString(),
        payment_status: "approved",
      })
      .eq("id", participant.id);
    if (updateErr) {
      console.error("[payment-proof] failed to mark paid:", updateErr);
    } else {
      autoApproved = true;
    }
  }

  return NextResponse.json({
    ok: true,
    autoApproved,
    valid: verifyResult.valid,
    confidence: verifyResult.confidence,
    rejectionReason: verifyResult.rejectionReason,
    sourceType: verifyResult.sourceType,
    detectedAmount: verifyResult.detectedAmount,
    detectedAccount: verifyResult.detectedAccount,
    warning: verifyResult.warning,
  });
}
