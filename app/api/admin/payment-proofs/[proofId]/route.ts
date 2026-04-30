// app/api/admin/payment-proofs/[proofId]/route.ts
//
// PATCH — el admin de la polla aprueba o revoca un payment_proof.
// Body: { decision: 'approve' | 'reject', notes?: string }.
//
// approve → admin_decision=true, mantiene paid=true (o lo setea si la AI
// no había auto-aprobado).
// reject  → admin_decision=false, paid=false. El user no puede pronosticar.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCurrentUserAdmin } from "@/lib/auth/admin";

const BodySchema = z.object({
  decision: z.enum(["approve", "reject"]),
  notes: z.string().trim().max(500).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: { proofId: string } },
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Cargar el proof y verificar permisos: viewer debe ser admin de la
  // polla, o admin global.
  const { data: proof } = await admin
    .from("payment_proofs")
    .select("id, polla_id, user_id, admin_decision")
    .eq("id", params.proofId)
    .maybeSingle();
  if (!proof) {
    return NextResponse.json({ error: "Proof no encontrado" }, { status: 404 });
  }

  const { data: polla } = await admin
    .from("pollas")
    .select("created_by")
    .eq("id", proof.polla_id)
    .maybeSingle();
  if (!polla) {
    return NextResponse.json({ error: "Polla no encontrada" }, { status: 404 });
  }

  const isGlobalAdmin = await isCurrentUserAdmin();
  if (polla.created_by !== user.id && !isGlobalAdmin) {
    return NextResponse.json({ error: "No sos admin de esta polla" }, { status: 403 });
  }

  const decision = parsed.data.decision === "approve";

  // Actualizar payment_proofs
  const { error: updateProofErr } = await admin
    .from("payment_proofs")
    .update({
      admin_decision: decision,
      admin_reviewed_at: new Date().toISOString(),
      admin_reviewed_by: user.id,
      admin_notes: parsed.data.notes ?? null,
    })
    .eq("id", proof.id);
  if (updateProofErr) {
    console.error("[admin/payment-proofs] update proof failed:", updateProofErr);
    return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  }

  // Sincronizar polla_participants.paid según la decisión
  await admin
    .from("polla_participants")
    .update({
      paid: decision,
      paid_at: decision ? new Date().toISOString() : null,
      payment_status: decision ? "approved" : "pending",
    })
    .eq("polla_id", proof.polla_id)
    .eq("user_id", proof.user_id);

  return NextResponse.json({ ok: true, decision });
}
