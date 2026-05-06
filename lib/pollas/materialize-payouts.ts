// lib/pollas/materialize-payouts.ts
//
// Crea las filas en `polla_payouts` para una polla que ya cerró pero
// todavía no tiene transacciones materializadas. Idempotente: si la
// polla no esta ended o ya hay filas, no hace nada.
//
// Lo usa /api/pollas/[slug]/payout-summary (al abrir el modal de pagos
// dentro de la polla) y /api/users/me/pending-payouts (al cargar /inicio,
// para que el modal global aparezca al participante sin que el admin
// tenga que entrar a la polla primero).

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computePayout,
  type PaymentMode,
  type PrizeDistribution,
} from "@/lib/pollas/payout-allocation";

interface PollaForPayout {
  id: string;
  status: string;
  payment_mode: string | null;
  buy_in_amount: number | null;
  prize_distribution: PrizeDistribution | null;
  created_by: string;
}

interface ParticipantRow {
  user_id: string;
  rank: number | null;
  joined_at: string;
  paid: boolean;
  status: string;
  users: { display_name: string | null } | null;
}

/**
 * Para cada polla del array que esté ended y no tenga filas en
 * polla_payouts, computa allocations y las inserta. Devuelve cuántas
 * pollas materializó.
 *
 * No bloquea: errores se loguean. El caller no necesita esperar el
 * resultado para responder.
 */
export async function materializePayoutsIfNeeded(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  pollaIds: string[],
): Promise<{ materialized: number }> {
  if (pollaIds.length === 0) return { materialized: 0 };

  const { data: pollas } = await admin
    .from("pollas")
    .select(
      "id, status, payment_mode, buy_in_amount, prize_distribution, created_by",
    )
    .in("id", pollaIds)
    .eq("status", "ended");
  const endedPollas = (pollas ?? []) as PollaForPayout[];
  if (endedPollas.length === 0) return { materialized: 0 };

  // ¿Cuáles ya tienen filas? Las skipeamos.
  const endedIds = endedPollas.map((p) => p.id);
  const { data: existingRows } = await admin
    .from("polla_payouts")
    .select("polla_id")
    .in("polla_id", endedIds);
  const alreadyHas = new Set<string>(
    ((existingRows ?? []) as Array<{ polla_id: string }>).map((r) => r.polla_id),
  );

  let materialized = 0;
  for (const polla of endedPollas) {
    if (alreadyHas.has(polla.id)) continue;

    const { data: partsRaw } = await admin
      .from("polla_participants")
      .select(
        "user_id, rank, joined_at, paid, status, users:user_id ( display_name )",
      )
      .eq("polla_id", polla.id)
      .eq("status", "approved")
      .eq("paid", true);

    const parts = (partsRaw ?? []) as unknown as ParticipantRow[];
    const buyIn = Number(polla.buy_in_amount ?? 0);
    if (parts.length === 0 || buyIn <= 0) continue;

    const computation = computePayout({
      participants: parts.map((p) => ({
        user_id: p.user_id,
        display_name: p.users?.display_name ?? "—",
        rank: p.rank ?? 9999,
        joined_at: p.joined_at,
      })),
      prizeDistribution: polla.prize_distribution,
      pot: parts.length * buyIn,
      buyIn,
      paymentMode: (polla.payment_mode as PaymentMode | null) ?? "admin_collects",
      adminUserId: polla.created_by,
    });

    if (computation.errors.length > 0 || computation.transactions.length === 0) {
      continue;
    }

    const rows = computation.transactions.map((t) => ({
      polla_id: polla.id,
      from_user_id: t.from_user_id,
      to_user_id: t.to_user_id,
      amount: t.amount,
    }));

    const { error: insErr } = await admin.from("polla_payouts").insert(rows);
    if (insErr) {
      // Race condition probable — otro request lo escribió. Lo dejamos pasar.
      console.warn(
        `[materializePayouts] polla ${polla.id} insert error (probable race):`,
        insErr.message,
      );
      continue;
    }
    materialized++;
  }

  return { materialized };
}
