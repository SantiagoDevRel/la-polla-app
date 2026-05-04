// lib/predictions/pending.ts — Resumen de predicciones pendientes
// para el viewer logueado. Usado por:
//   - app/(app)/layout.tsx       → badge del bottom nav "Pollas"
//   - app/(app)/inicio/page.tsx  → CTA flotante "PRONOSTICAR (N)"
//
// Definición de "pending":
//   El user es participante approved + paid (o la polla es pay_winner)
//   en una polla active, hay un match scheduled cuyo kickoff es
//   estrictamente posterior a NOW + 5 min (lock window) y no existe
//   prediction guardada para (user, polla, match).
//
// Cacheado con React `cache` — múltiples llamadas dentro del mismo
// request server-side se deduplican (layout + página comparten el
// mismo round-trip a DB).

import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolvePollaMatchIds, type PollaForResolve } from "@/lib/matches/resolve-scope";

export interface PendingFirst {
  pollaSlug: string;
  pollaName: string;
  matchId: string;
  scheduledAt: string;
}

export interface PendingSummary {
  count: number;
  first: PendingFirst | null;
}

const LOCK_WINDOW_MS = 5 * 60 * 1000;

async function _getPendingPredictionsSummary(userId: string | null): Promise<PendingSummary> {
  if (!userId) return { count: 0, first: null };
  const admin = createAdminClient();

  // 1) Pollas activas donde el user está approved + paid (o pay_winner).
  const { data: parts } = await admin
    .from("polla_participants")
    .select(
      `polla_id,
       paid,
       role,
       pollas:polla_id (
         id, slug, name, status, payment_mode, scope,
         tournament, match_ids, starts_at, created_at
       )`,
    )
    .eq("user_id", userId)
    .eq("status", "approved");

  type PollaRow = {
    id: string;
    slug: string;
    name: string;
    status: string;
    payment_mode: string;
    scope: string;
    tournament: string;
    match_ids: string[] | null;
    starts_at: string | null;
    created_at: string;
  };
  type PartRow = {
    polla_id: string;
    paid: boolean | null;
    role: string;
    pollas: PollaRow | PollaRow[] | null;
  };
  const unwrap = <T,>(v: T | T[] | null | undefined): T | null =>
    !v ? null : Array.isArray(v) ? (v[0] ?? null) : v;

  const eligible: PollaRow[] = [];
  for (const p of (parts ?? []) as PartRow[]) {
    const polla = unwrap(p.pollas);
    if (!polla) continue;
    if (polla.status !== "active") continue;
    // Pago opcional: pay_winner no requiere paid=true para pronosticar.
    if (polla.payment_mode === "admin_collects" && !p.paid) continue;
    eligible.push(polla);
  }
  if (eligible.length === 0) return { count: 0, first: null };

  // 2) Resolver matches por polla (custom o por scope dinámico).
  const matchIdsByPolla = new Map<string, string[]>();
  for (const polla of eligible) {
    const ids = await resolvePollaMatchIds(admin, polla as PollaForResolve);
    if (ids.length > 0) matchIdsByPolla.set(polla.id, ids);
  }
  if (matchIdsByPolla.size === 0) return { count: 0, first: null };

  // 3) Cargar matches scheduled futuros (con lock window) en una sola query.
  const allMatchIds = Array.from(new Set(Array.from(matchIdsByPolla.values()).flat()));
  const cutoff = new Date(Date.now() + LOCK_WINDOW_MS).toISOString();
  const { data: matches } = await admin
    .from("matches")
    .select("id, status, scheduled_at")
    .in("id", allMatchIds)
    .eq("status", "scheduled")
    .gt("scheduled_at", cutoff)
    .order("scheduled_at", { ascending: true });
  const matchById = new Map<string, { scheduled_at: string }>();
  for (const m of matches ?? []) {
    matchById.set(m.id, { scheduled_at: m.scheduled_at });
  }
  if (matchById.size === 0) return { count: 0, first: null };

  // 4) Cargar predictions existentes del user para cualquiera de esos matches.
  const { data: preds } = await admin
    .from("predictions")
    .select("polla_id, match_id")
    .eq("user_id", userId)
    .in("match_id", Array.from(matchById.keys()));
  const predSet = new Set<string>();
  for (const pr of preds ?? []) {
    predSet.add(`${pr.polla_id}|${pr.match_id}`);
  }

  // 5) Construir lista de (polla, match) pendientes y ordenar por kickoff.
  const pending: Array<PendingFirst & { pollaId: string }> = [];
  for (const polla of eligible) {
    const ids = matchIdsByPolla.get(polla.id);
    if (!ids) continue;
    for (const matchId of ids) {
      const m = matchById.get(matchId);
      if (!m) continue;
      const key = `${polla.id}|${matchId}`;
      if (predSet.has(key)) continue;
      pending.push({
        pollaId: polla.id,
        pollaSlug: polla.slug,
        pollaName: polla.name,
        matchId,
        scheduledAt: m.scheduled_at,
      });
    }
  }
  pending.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));

  if (pending.length === 0) return { count: 0, first: null };
  const f = pending[0];
  return {
    count: pending.length,
    first: {
      pollaSlug: f.pollaSlug,
      pollaName: f.pollaName,
      matchId: f.matchId,
      scheduledAt: f.scheduledAt,
    },
  };
}

/**
 * Cached wrapper. React `cache` deduplica llamadas con el MISMO argumento
 * dentro del mismo render-request — el layout y la página /inicio
 * comparten el cómputo sin duplicar round-trips.
 */
export const getPendingPredictionsSummary = cache(_getPendingPredictionsSummary);
