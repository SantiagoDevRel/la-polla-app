// lib/casa/prize-account-reminder.ts — premios en dinero sin cuenta para pagarlos.
//
// (2026-11-09) Pedido del dueño: Tatiana empató OFIGOLAZO6 y no tenía cuenta
// de pago registrada, así que Carlos no tenía a dónde transferirle. Al entrar
// a la app, un ganador con premio en dinero sin pagar y sin cuenta guardada ve
// un aviso con el editor de su cuenta (components/casa/PremioCuentaAviso.tsx).
//
// Solo lectura, con el alcance por usuario explícito (ver el TODO de
// auth.uid() en AGENTS.md). La cuenta es la misma que usa el panel de pagos:
// users.default_payout_account (app/api/casa/admin/payouts/route.ts).

import { createAdminClient } from "@/lib/supabase/admin";
import type { PremioSinCuenta } from "./prize-account-reminder-shared";

export async function listPremiosSinCuenta(userId: string): Promise<PremioSinCuenta[]> {
  const db = createAdminClient();
  const { data: user, error: userError } = await db
    .from("users")
    .select("default_payout_account")
    .eq("id", userId)
    .maybeSingle();
  if (userError) throw userError;
  if (!user || user.default_payout_account) return [];

  const { data: payouts, error } = await db
    .from("casa_payouts")
    .select("polla_id, amount_cop, prize_kind")
    .eq("user_id", userId) // ← filtro explícito: ver el TODO de auth.uid()
    .is("paid_at", null)
    .gt("amount_cop", 0);
  if (error) throw error;
  const enDinero = (payouts ?? []).filter((p: { prize_kind: string | null }) => p.prize_kind !== "objeto") as
    { polla_id: string; amount_cop: number }[];
  if (enDinero.length === 0) return [];

  const { data: pollas, error: pollasError } = await db
    .from("casa_pollas")
    .select("id, slug, name")
    .in("id", [...new Set(enDinero.map((p) => p.polla_id))])
    .is("archived_at", null);
  if (pollasError) throw pollasError;
  type Polla = { id: string; slug: string; name: string };
  const porId = new Map<string, Polla>(((pollas ?? []) as Polla[]).map((p) => [p.id, p]));

  return enDinero.flatMap((p) => {
    const polla = porId.get(p.polla_id);
    return polla ? [{ pollaId: polla.id, slug: polla.slug, nombre: polla.name, montoCop: p.amount_cop }] : [];
  });
}
