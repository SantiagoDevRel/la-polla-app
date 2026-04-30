// app/api/users/me/unpaid-pollas/route.ts
//
// GET — pollas activas en modo admin_collects donde el viewer es
// participante y todavía NO está paid=true. Cada row trae los datos
// estructurados del cobro (método/cuenta/nombre/monto) + el último
// proof si lo hay (rejected indicates AI/admin lo rechazó y el user
// puede subir de nuevo).
//
// Se usa en /inicio para mostrar un modal/banner urgente: "Pagá X en
// la polla Y para empezar a pronosticar".

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Pollas donde sos participante approved + no pagado.
  const { data: parts } = await admin
    .from("polla_participants")
    .select(
      "polla_id, status, paid, role, pollas:polla_id (slug, name, status, payment_mode, buy_in_amount, admin_payout_method, admin_payout_account, admin_payout_account_name, admin_payment_instructions)",
    )
    .eq("user_id", user.id)
    .eq("status", "approved")
    .eq("paid", false);

  // Filtrar solo pollas activas en admin_collects (no organizador).
  type PartRow = {
    polla_id: string;
    role: string;
    pollas: {
      slug: string;
      name: string;
      status: string;
      payment_mode: string;
      buy_in_amount: number;
      admin_payout_method: string | null;
      admin_payout_account: string | null;
      admin_payout_account_name: string | null;
      admin_payment_instructions: string | null;
    } | Array<{
      slug: string;
      name: string;
      status: string;
      payment_mode: string;
      buy_in_amount: number;
      admin_payout_method: string | null;
      admin_payout_account: string | null;
      admin_payout_account_name: string | null;
      admin_payment_instructions: string | null;
    }> | null;
  };

  const unwrap = <T,>(v: T | T[] | null): T | null =>
    !v ? null : Array.isArray(v) ? v[0] ?? null : v;

  const candidates = ((parts ?? []) as PartRow[])
    .map((p) => ({ row: p, polla: unwrap(p.pollas) }))
    .filter(
      (x) =>
        x.polla &&
        x.polla.status === "active" &&
        x.polla.payment_mode === "admin_collects" &&
        x.row.role !== "admin",
    );

  if (candidates.length === 0) {
    return NextResponse.json({ unpaid: [] });
  }

  // Para cada polla, traer el último proof — si está rejected mostramos
  // ese estado, si está pending mostramos "esperando review".
  const pollaIds = candidates.map((c) => c.row.polla_id);
  const { data: proofs } = await admin
    .from("payment_proofs")
    .select("polla_id, admin_decision, ai_valid, ai_rejection_reason, created_at")
    .eq("user_id", user.id)
    .in("polla_id", pollaIds)
    .order("created_at", { ascending: false });

  const lastProofByPolla = new Map<
    string,
    { admin_decision: boolean | null; ai_valid: boolean | null; ai_rejection_reason: string | null }
  >();
  for (const pr of proofs ?? []) {
    if (!lastProofByPolla.has(pr.polla_id)) {
      lastProofByPolla.set(pr.polla_id, {
        admin_decision: pr.admin_decision,
        ai_valid: pr.ai_valid,
        ai_rejection_reason: pr.ai_rejection_reason,
      });
    }
  }

  const unpaid = candidates.map(({ row, polla }) => {
    const last = lastProofByPolla.get(row.polla_id) ?? null;
    let proofStatus: "none" | "pending_review" | "rejected" = "none";
    if (last) {
      if (last.admin_decision === false) proofStatus = "rejected";
      else if (last.admin_decision === null) proofStatus = "pending_review";
    }
    return {
      pollaSlug: polla!.slug,
      pollaName: polla!.name,
      buyInAmount: polla!.buy_in_amount,
      adminPayoutMethod: polla!.admin_payout_method,
      adminPayoutAccount: polla!.admin_payout_account,
      adminPayoutAccountName: polla!.admin_payout_account_name,
      adminPaymentInstructions: polla!.admin_payment_instructions,
      proofStatus,
      lastRejectionReason: last?.ai_rejection_reason ?? null,
    };
  });

  return NextResponse.json({ unpaid });
}
