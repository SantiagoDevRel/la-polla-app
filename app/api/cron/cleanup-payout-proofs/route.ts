// app/api/cron/cleanup-payout-proofs/route.ts — Cleanup diario de
// screenshots peer-to-peer que ya cumplieron 7 días.
//
// Borra del bucket `payout-proofs` y nullifica las columnas
// proof_storage_path / proof_uploaded_at de polla_payouts.
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

  const { data: stale, error: queryErr } = await admin
    .from("polla_payouts")
    .select("id, proof_storage_path")
    .lt("proof_uploaded_at", cutoff)
    .not("proof_storage_path", "is", null);

  if (queryErr) {
    return NextResponse.json(
      { error: "query failed", detail: queryErr.message },
      { status: 500 },
    );
  }

  const rows = (stale ?? []) as Array<{
    id: string;
    proof_storage_path: string | null;
  }>;
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, deleted: 0 });
  }

  const paths = rows.map((r) => r.proof_storage_path!).filter(Boolean);
  const ids = rows.map((r) => r.id);

  // Borrar del bucket. Si alguno ya no existe, supabase lo ignora sin
  // error.
  const { error: storageErr } = await admin.storage
    .from("payout-proofs")
    .remove(paths);
  if (storageErr) {
    console.warn("[cleanup-payout-proofs] storage remove warning:", storageErr.message);
    // Sigue adelante igual — nullificamos las columnas para no quedar
    // colgados con paths que apuntan a archivos perdidos.
  }

  const { error: updErr } = await admin
    .from("polla_payouts")
    .update({ proof_storage_path: null, proof_uploaded_at: null })
    .in("id", ids);
  if (updErr) {
    return NextResponse.json(
      { error: "update failed", detail: updErr.message, deleted_storage: paths.length },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    deleted: rows.length,
  });
}
