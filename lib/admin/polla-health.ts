// lib/admin/polla-health.ts
//
// Lógica compartida para los checks de salud de pollas. Antes vivía en
// app/api/admin/polla-health/route.ts, pero Next.js 14 no permite
// exports que no sean handlers HTTP / metadata desde route.ts. Cuando
// el cron de email diario empezó a importar collectPollaHealth desde
// el route, el build de prod falló con "X is not a valid Route export
// field". Movimos la función acá y los dos consumidores (el route y
// el cron) la importan desde lib.
//
// Cero cambio de lógica vs el original — solo cambio de ubicación.

import { createAdminClient } from "@/lib/supabase/admin";

export interface StuckPolla {
  id: string;
  slug: string;
  name: string;
  matchCount: number;
  participantCount: number;
  buyIn: number;
}

export interface EndedNoPayouts {
  id: string;
  slug: string;
  name: string;
  paymentMode: string;
  buyIn: number;
  participantCount: number;
}

/**
 * Colecciona los issues de salud de las pollas:
 *
 *   1. stuckPollas — pollas con status='active' donde TODOS los matches
 *      ya están en estado terminal (finished/cancelled/postponed).
 *      Deberían estar 'ended' pero el trigger no las cerró.
 *      Defense-in-depth para el bug que arreglamos en migration 051.
 *
 *   2. endedNoPayouts — pollas en status='ended' con payment_mode
 *      pay_winner o admin_collects, buy_in > 0, ≥1 participante pago,
 *      pero 0 filas en polla_payouts. La materialización debería correr
 *      al primer /inicio de un participante; si pasaron horas y sigue
 *      vacío, algo se rompió.
 */
export async function collectPollaHealth(): Promise<{
  stuckPollas: StuckPolla[];
  endedNoPayouts: EndedNoPayouts[];
}> {
  const admin = createAdminClient();

  // 1. Pollas active que deberían estar ended.
  const { data: actives } = await admin
    .from("pollas")
    .select("id, slug, name, match_ids, buy_in_amount")
    .eq("status", "active");

  const stuckPollas: StuckPolla[] = [];
  for (const p of (actives ?? []) as Array<{
    id: string;
    slug: string;
    name: string;
    match_ids: string[] | null;
    buy_in_amount: number | null;
  }>) {
    const ids = p.match_ids ?? [];
    if (ids.length === 0) continue;
    const { count } = await admin
      .from("matches")
      .select("id", { count: "exact", head: true })
      .in("id", ids)
      .not("status", "in", "(finished,cancelled,postponed)");
    if (count !== 0) continue; // hay al menos 1 no-terminal → polla activa real

    const { count: partCount } = await admin
      .from("polla_participants")
      .select("id", { count: "exact", head: true })
      .eq("polla_id", p.id)
      .eq("status", "approved")
      .eq("paid", true);

    stuckPollas.push({
      id: p.id,
      slug: p.slug,
      name: p.name,
      matchCount: ids.length,
      participantCount: partCount ?? 0,
      buyIn: Number(p.buy_in_amount ?? 0),
    });
  }

  // 2. Pollas ended sin payouts materializados.
  const { data: ended } = await admin
    .from("pollas")
    .select("id, slug, name, payment_mode, buy_in_amount")
    .eq("status", "ended")
    .gt("buy_in_amount", 0)
    .in("payment_mode", ["pay_winner", "admin_collects"]);

  const endedNoPayouts: EndedNoPayouts[] = [];
  for (const p of (ended ?? []) as Array<{
    id: string;
    slug: string;
    name: string;
    payment_mode: string;
    buy_in_amount: number | null;
  }>) {
    const { count: payoutCount } = await admin
      .from("polla_payouts")
      .select("id", { count: "exact", head: true })
      .eq("polla_id", p.id);
    if ((payoutCount ?? 0) > 0) continue;

    const { count: partCount } = await admin
      .from("polla_participants")
      .select("id", { count: "exact", head: true })
      .eq("polla_id", p.id)
      .eq("status", "approved")
      .eq("paid", true);
    if ((partCount ?? 0) === 0) continue; // sin participantes pagados — no aplica

    endedNoPayouts.push({
      id: p.id,
      slug: p.slug,
      name: p.name,
      paymentMode: p.payment_mode,
      buyIn: Number(p.buy_in_amount ?? 0),
      participantCount: partCount ?? 0,
    });
  }

  return { stuckPollas, endedNoPayouts };
}
