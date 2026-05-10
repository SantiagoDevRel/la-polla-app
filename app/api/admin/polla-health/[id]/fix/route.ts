// app/api/admin/polla-health/[id]/fix/route.ts
//
// POST → aplica el fix a un issue de salud:
//   - Si la polla está active y todos los matches son terminales:
//     UPDATE pollas SET status='ended' WHERE id=$1
//   - Si la polla está ended sin payouts: llamar materializePayoutsIfNeeded.
//
// Ambos casos son idempotentes — repetir el fix no hace daño.

import { NextResponse } from "next/server";
import { isCurrentUserAdmin } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { materializePayoutsIfNeeded } from "@/lib/pollas/materialize-payouts";

export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
) {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const admin = createAdminClient();

  const { data: polla } = await admin
    .from("pollas")
    .select("id, status, match_ids")
    .eq("id", params.id)
    .maybeSingle();

  if (!polla) {
    return NextResponse.json({ error: "Polla no encontrada" }, { status: 404 });
  }

  // Caso 1: polla active → cerrar si todos terminales.
  if (polla.status === "active") {
    const ids = (polla.match_ids ?? []) as string[];
    if (ids.length === 0) {
      return NextResponse.json(
        { error: "Polla sin matches — no se puede cerrar" },
        { status: 400 },
      );
    }
    const { count } = await admin
      .from("matches")
      .select("id", { count: "exact", head: true })
      .in("id", ids)
      .not("status", "in", "(finished,cancelled,postponed)");
    if ((count ?? 0) > 0) {
      return NextResponse.json(
        { error: "Todavía hay matches no-terminales — no se puede cerrar" },
        { status: 400 },
      );
    }
    const { error: updErr } = await admin
      .from("pollas")
      .update({ status: "ended" })
      .eq("id", polla.id);
    if (updErr) {
      return NextResponse.json(
        { error: "No se pudo cerrar", detail: updErr.message },
        { status: 500 },
      );
    }
  }

  // Caso 2 (también corre después del cierre): materializar payouts.
  const { materialized } = await materializePayoutsIfNeeded(admin, [polla.id]);

  return NextResponse.json({
    ok: true,
    closed: polla.status === "active",
    materialized,
  });
}
