// app/api/pollas/[slug]/payout-confirm/[transactionId]/route.ts
//
// POST — marca una transacción de polla_payouts como pagada.
//
// Quién puede confirmar:
//   - el admin de la polla (sobre cualquier transacción — override total).
//   - el from_user_id (auto-confirma "ya pagué").
//   - el to_user_id (confirma "ya me llegó", también válido).
//
// Idempotente: si paid_at ya está seteado, no hace nada (200 OK).
//
// DELETE — sobre la misma transacción: deshace el confirme. Solo el
// admin o quien confirmó originalmente puede deshacerlo. Útil si el
// admin marcó algo como pagado por error.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

interface Params {
  params: { slug: string; transactionId: string };
}

export async function POST(_request: NextRequest, { params }: Params) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: polla } = await admin
    .from("pollas")
    .select("id, created_by")
    .eq("slug", params.slug)
    .maybeSingle();
  if (!polla) {
    return NextResponse.json({ error: "Polla no encontrada" }, { status: 404 });
  }

  const { data: tx } = await admin
    .from("polla_payouts")
    .select("id, polla_id, from_user_id, to_user_id, paid_at")
    .eq("id", params.transactionId)
    .maybeSingle();
  if (!tx || tx.polla_id !== polla.id) {
    return NextResponse.json(
      { error: "Transacción no encontrada" },
      { status: 404 },
    );
  }

  // Permisos: admin de la polla, el que paga, o el que recibe.
  const { data: membership } = await admin
    .from("polla_participants")
    .select("role")
    .eq("polla_id", polla.id)
    .eq("user_id", user.id)
    .maybeSingle();
  const isAdmin =
    membership?.role === "admin" || polla.created_by === user.id;
  const isFrom = tx.from_user_id === user.id;
  const isTo = tx.to_user_id === user.id;
  if (!isAdmin && !isFrom && !isTo) {
    return NextResponse.json(
      { error: "No podés confirmar esta transacción" },
      { status: 403 },
    );
  }

  // Idempotente.
  if (tx.paid_at) {
    return NextResponse.json({ ok: true, already: true });
  }

  const { error: updErr } = await admin
    .from("polla_payouts")
    .update({
      paid_at: new Date().toISOString(),
      paid_by_user_id: user.id,
    })
    .eq("id", tx.id);
  if (updErr) {
    console.error("[payout-confirm POST] failed:", updErr);
    return NextResponse.json(
      { error: "No se pudo marcar como pagado" },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: polla } = await admin
    .from("pollas")
    .select("id, created_by")
    .eq("slug", params.slug)
    .maybeSingle();
  if (!polla) {
    return NextResponse.json({ error: "Polla no encontrada" }, { status: 404 });
  }

  const { data: tx } = await admin
    .from("polla_payouts")
    .select("id, polla_id, paid_by_user_id, paid_at")
    .eq("id", params.transactionId)
    .maybeSingle();
  if (!tx || tx.polla_id !== polla.id) {
    return NextResponse.json(
      { error: "Transacción no encontrada" },
      { status: 404 },
    );
  }

  const { data: membership } = await admin
    .from("polla_participants")
    .select("role")
    .eq("polla_id", polla.id)
    .eq("user_id", user.id)
    .maybeSingle();
  const isAdmin =
    membership?.role === "admin" || polla.created_by === user.id;

  // Solo admin o el que confirmó pueden deshacer.
  if (!isAdmin && tx.paid_by_user_id !== user.id) {
    return NextResponse.json(
      { error: "Solo admin o quien confirmó puede deshacerlo" },
      { status: 403 },
    );
  }

  if (!tx.paid_at) {
    return NextResponse.json({ ok: true, already: true });
  }

  const { error: updErr } = await admin
    .from("polla_payouts")
    .update({ paid_at: null, paid_by_user_id: null })
    .eq("id", tx.id);
  if (updErr) {
    console.error("[payout-confirm DELETE] failed:", updErr);
    return NextResponse.json({ error: "No se pudo deshacer" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
