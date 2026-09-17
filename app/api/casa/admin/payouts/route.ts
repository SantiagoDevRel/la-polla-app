// app/api/casa/admin/payouts/route.ts — los premios en dinero de una polla
// resuelta, con la cuenta de cada ganador y su prueba de pago (migración 133).
//
// Lo lee el panel de administración para pagar uno a uno. La cuenta de pago
// del ganador (Nequi / Bancolombia) sale de `users` y SOLO viaja acá: es la
// única pantalla que la necesita y solo la ve el administrador.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPayouts } from "@/lib/casa/queries";
import { signPayoutProofs } from "@/lib/casa/payout-proofs";
import type { AdminPayoutRow } from "@/lib/casa/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return privateJson({ error: "No autenticado." }, 401);
  if (!user.is_admin) return privateJson({ error: "Solo el administrador." }, 403);
  const pollaId = request.nextUrl.searchParams.get("pollaId");
  if (!pollaId || !z.string().uuid().safeParse(pollaId).success) return privateJson({ error: "Polla inválida." }, 400);

  const db = createAdminClient();
  const { data: polla, error: pollaError } = await db
    .from("casa_pollas")
    .select("id, status, settlement_outcome, prize_kind, archived_at")
    .eq("id", pollaId)
    .maybeSingle();
  if (pollaError) return privateJson({ error: "No se pudo leer la polla." }, 500);
  if (!polla || polla.archived_at) return privateJson({ error: "No existe esa polla." }, 404);

  const payouts = (await getPayouts(pollaId)).filter((p) => (p.prize_kind ?? "pozo") === "pozo" && p.id);
  const [proofUrls, { data: users, error: usersError }] = await Promise.all([
    signPayoutProofs(payouts),
    payouts.length
      ? db.from("users")
        .select("id, default_payout_method, default_payout_account, default_payout_account_name, default_payout_account_type")
        .in("id", payouts.map((p) => p.user_id))
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (usersError) return privateJson({ error: "No se pudieron leer las cuentas de pago." }, 500);
  const accounts = new Map((users ?? []).map((u) => [u.id, u]));

  const rows: AdminPayoutRow[] = payouts.map((p) => {
    const account = accounts.get(p.user_id);
    return {
      id: p.id!,
      userId: p.user_id,
      displayName: p.display_name ?? "Sin nombre",
      avatarUrl: p.avatar_url,
      amountCop: p.amount_cop,
      points: p.points,
      note: p.note ?? null,
      paidAt: p.paid_at,
      paidReference: p.paid_reference ?? null,
      proofUrl: proofUrls[p.id!] ?? null,
      account: account?.default_payout_account
        ? { method: account.default_payout_method, number: account.default_payout_account, holder: account.default_payout_account_name, type: account.default_payout_account_type }
        : null,
    };
  });
  return privateJson({
    payable: polla.status === "resuelta" && polla.settlement_outcome === "money_awarded",
    rows,
    paidCount: rows.filter((r) => r.paidAt).length,
    totalCount: rows.length,
  });
}
