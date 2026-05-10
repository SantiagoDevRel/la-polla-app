// app/api/cron/cleanup-payout-proofs/route.ts — Cleanup diario de
// TODOS los comprobantes que cumplieron 7 días. Mantiene Supabase Storage
// dentro del free tier — los screenshots no son source of truth (la
// confirmación es paid_at), solo evidencia ad-hoc para el contexto.
//
// Cubre 2 sistemas distintos:
//   1. payout-proofs (peer-to-peer): screenshots que el losers suben
//      en pollas pay_winner para mostrar al ganador. Borrar del bucket
//      `payout-proofs` y nullificar polla_payouts.proof_*.
//   2. payment-proofs (admin_collects): screenshots que los participantes
//      suben en pollas admin_collects para que el admin los apruebe.
//      Borrar del bucket `payment-proofs` y borrar la fila de payment_proofs
//      (esa tabla es 100% temporal, sin valor histórico una vez aprobado).
//
// Auth: header Authorization: Bearer ${CRON_SECRET}.
// Trigger: GitHub Actions cada día a las 4am Bogota (9 UTC).

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Cutoff: hace 7 días.
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // ============================================================
  // 1. Peer-to-peer: bucket payout-proofs + polla_payouts.proof_*
  // ============================================================
  let deletedPayoutProofs = 0;
  {
    const { data: stale, error: queryErr } = await admin
      .from("polla_payouts")
      .select("id, proof_storage_path")
      .lt("proof_uploaded_at", cutoff)
      .not("proof_storage_path", "is", null);

    if (queryErr) {
      return NextResponse.json(
        { error: "payout_proofs query failed", detail: queryErr.message },
        { status: 500 },
      );
    }
    const rows = (stale ?? []) as Array<{ id: string; proof_storage_path: string | null }>;
    if (rows.length > 0) {
      const paths = rows.map((r) => r.proof_storage_path!).filter(Boolean);
      const ids = rows.map((r) => r.id);
      const { error: storageErr } = await admin.storage
        .from("payout-proofs")
        .remove(paths);
      if (storageErr) {
        console.warn(
          "[cleanup-payout-proofs] payout-proofs storage remove warning:",
          storageErr.message,
        );
      }
      const { error: updErr } = await admin
        .from("polla_payouts")
        .update({ proof_storage_path: null, proof_uploaded_at: null })
        .in("id", ids);
      if (updErr) {
        return NextResponse.json(
          {
            error: "payout_proofs update failed",
            detail: updErr.message,
            deleted_storage: paths.length,
          },
          { status: 500 },
        );
      }
      deletedPayoutProofs = rows.length;
    }
  }

  // ============================================================
  // 2. admin_collects: bucket payment-proofs + tabla payment_proofs
  //    (la tabla es 100% temporal — la borramos completa, no solo
  //    nullificamos como en polla_payouts donde la fila tiene valor
  //    histórico aparte del proof).
  // ============================================================
  let deletedPaymentProofs = 0;
  {
    const { data: stale, error: queryErr } = await admin
      .from("payment_proofs")
      .select("id, storage_path")
      .lt("created_at", cutoff)
      .not("storage_path", "is", null);

    if (queryErr) {
      return NextResponse.json(
        {
          error: "payment_proofs query failed",
          detail: queryErr.message,
          deleted_payout_proofs: deletedPayoutProofs,
        },
        { status: 500 },
      );
    }
    const rows = (stale ?? []) as Array<{ id: string; storage_path: string | null }>;
    if (rows.length > 0) {
      const paths = rows.map((r) => r.storage_path!).filter(Boolean);
      const ids = rows.map((r) => r.id);
      const { error: storageErr } = await admin.storage
        .from("payment-proofs")
        .remove(paths);
      if (storageErr) {
        console.warn(
          "[cleanup-payout-proofs] payment-proofs storage remove warning:",
          storageErr.message,
        );
      }
      const { error: delErr } = await admin
        .from("payment_proofs")
        .delete()
        .in("id", ids);
      if (delErr) {
        return NextResponse.json(
          {
            error: "payment_proofs delete failed",
            detail: delErr.message,
            deleted_storage: paths.length,
            deleted_payout_proofs: deletedPayoutProofs,
          },
          { status: 500 },
        );
      }
      deletedPaymentProofs = rows.length;
    }
  }

  return NextResponse.json({
    ok: true,
    deleted_payout_proofs: deletedPayoutProofs,
    deleted_payment_proofs: deletedPaymentProofs,
  });
}
