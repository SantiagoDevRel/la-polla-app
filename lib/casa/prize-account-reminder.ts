// lib/casa/prize-account-reminder.ts — ¿a quién le falta decir dónde le pagamos?
//
// (2026-11-09) Pedidos del dueño, el mismo día:
// 1. Tatiana empató OFIGOLAZO6 sin cuenta de pago y no había a dónde
//    transferirle: un ganador sin cuenta ve el editor al entrar (PR #252).
// 2. «Ponlo obligatorio»: quien ya pagó una polla que sigue en juego tiene que
//    registrar su cuenta antes de seguir usando la app, así el pago nunca se
//    frena por eso. El aviso (components/casa/PremioCuentaAviso.tsx) no se
//    cierra hasta guardarla.
//
// Solo lectura, con el alcance por usuario explícito (ver el TODO de
// auth.uid() en AGENTS.md). La cuenta es la misma que usa el panel de pagos:
// users.default_payout_account (app/api/casa/admin/payouts/route.ts).
// Administradores y jugadores de la casa quedan fuera: la casa no se paga a sí
// misma y el aviso no puede tapar el panel.

import { createAdminClient } from "@/lib/supabase/admin";
import type { CuentaPendiente, PremioSinCuenta } from "./prize-account-reminder-shared";

type Polla = { id: string; slug: string; name: string; status: string; prize_kind: string | null };

export async function getCuentaPendiente(userId: string): Promise<CuentaPendiente | null> {
  const db = createAdminClient();
  const [{ data: user, error: userError }, { data: housePlayer, error: houseError }] = await Promise.all([
    db.from("users").select("default_payout_account, is_admin").eq("id", userId).maybeSingle(),
    db.from("casa_admin_players").select("user_id").eq("user_id", userId).maybeSingle(),
  ]);
  if (userError) throw userError;
  if (houseError) throw houseError;
  if (!user || user.default_payout_account || user.is_admin === true || housePlayer) return null;

  const [{ data: payouts, error: payoutsError }, { data: entries, error: entriesError }] = await Promise.all([
    db.from("casa_payouts")
      .select("polla_id, amount_cop, prize_kind")
      .eq("user_id", userId) // ← filtro explícito: ver el TODO de auth.uid()
      .is("paid_at", null)
      .gt("amount_cop", 0),
    db.from("casa_entries")
      .select("polla_id, status, proof_path")
      .eq("user_id", userId) // ← filtro explícito: ver el TODO de auth.uid()
      .in("status", ["pagada", "pendiente"]),
  ]);
  if (payoutsError) throw payoutsError;
  if (entriesError) throw entriesError;

  const premios = ((payouts ?? []) as { polla_id: string; amount_cop: number; prize_kind: string | null }[])
    .filter((p) => p.prize_kind !== "objeto");
  // Pagó = inscripción aprobada, o pendiente con el comprobante ya subido.
  const pagadas = ((entries ?? []) as { polla_id: string; status: string; proof_path: string | null }[])
    .filter((e) => e.status === "pagada" || Boolean(e.proof_path));
  const ids = [...new Set([...premios.map((p) => p.polla_id), ...pagadas.map((e) => e.polla_id)])];
  if (ids.length === 0) return null;

  const { data: pollas, error: pollasError } = await db
    .from("casa_pollas")
    .select("id, slug, name, status, prize_kind")
    .in("id", ids)
    .is("archived_at", null);
  if (pollasError) throw pollasError;
  const porId = new Map<string, Polla>(((pollas ?? []) as Polla[]).map((p) => [p.id, p]));

  const ganados: PremioSinCuenta[] = premios.flatMap((p) => {
    const polla = porId.get(p.polla_id);
    return polla ? [{ pollaId: polla.id, slug: polla.slug, nombre: polla.name, montoCop: p.amount_cop }] : [];
  });
  // Solo pollas con premio en dinero que todavía se pueden ganar.
  const enJuego = pagadas.some((e) => {
    const polla = porId.get(e.polla_id);
    return polla?.prize_kind !== "objeto" && (polla?.status === "abierta" || polla?.status === "cerrada");
  });
  return ganados.length > 0 || enJuego ? { premios: ganados, enJuego } : null;
}
