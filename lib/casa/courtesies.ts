// lib/casa/courtesies.ts — lecturas y escrituras de las cortesías (migración 136).
//
// Todo pasa por createAdminClient() como el resto de Casa (auth.uid() no
// propaga a PostgREST, ver el TODO de CLAUDE.md). Acá nunca se escribe con
// .from(...).insert/update: cada operación es una función SQL que bloquea la
// polla, exige contrato v2 y valida quién puede hacerla. El alcance por usuario
// va SIEMPRE explícito en los argumentos.

import { createAdminClient } from "@/lib/supabase/admin";
import { CASA_CONTRACT } from "./contract";
import type { AdminCourtesy, CourtesyPreview, MyCourtesy } from "./courtesies-shared";

/** Las cortesías de quien las reparte. Vacío también cuando nunca le dieron. */
export async function listMyCourtesies(userId: string): Promise<MyCourtesy[]> {
  const { data, error } = await createAdminClient().rpc("casa_my_courtesies_v1", { p_user_id: userId });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    code: row.code as string,
    status: row.status as MyCourtesy["status"],
    slug: row.slug as string,
    polla: row.name as string,
    closes_at: row.closes_at as string,
    polla_status: row.polla_status as string,
    redeemed_name: (row.redeemed_name as string | null) ?? null,
    redeemed_at: (row.redeemed_at as string | null) ?? null,
  }));
}

/** Las cortesías de una polla o de una persona, para el panel. SQL exige admin. */
export async function listCourtesiesAdmin(
  actorId: string,
  filter: { pollaId?: string | null; holderId?: string | null } = {},
): Promise<AdminCourtesy[]> {
  const { data, error } = await createAdminClient().rpc("casa_courtesies_admin_v1", {
    p_actor_id: actorId,
    p_polla_id: filter.pollaId ?? null,
    p_holder_id: filter.holderId ?? null,
  });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    code: row.code as string,
    status: row.status as AdminCourtesy["status"],
    polla_id: row.polla_id as string,
    slug: row.slug as string,
    polla: row.polla_name as string,
    polla_status: row.polla_status as string,
    closes_at: row.closes_at as string,
    holder_id: row.holder_id as string,
    holder_name: (row.holder_name as string | null) ?? null,
    granted_at: row.granted_at as string,
    redeemed_name: (row.redeemed_name as string | null) ?? null,
    redeemed_at: (row.redeemed_at as string | null) ?? null,
  }));
}

/**
 * De qué polla es un enlace y si todavía sirve. Se lee en el servidor con el
 * código que guardó la cookie; no hay endpoint público que reciba códigos.
 */
export async function courtesyPreview(code: string, userId?: string | null): Promise<CourtesyPreview | null> {
  const { data, error } = await createAdminClient().rpc("casa_courtesy_preview_v1", {
    p_code: code, p_user_id: userId ?? null,
  });
  if (error) throw error;
  return (data as CourtesyPreview | null) ?? null;
}

export interface CourtesyRedeemResult {
  ok: boolean;
  error?: string;
  slug?: string;
  polla?: string;
  entry_id?: string;
  entry_number?: number;
}

/** Canje. SQL decide: cuenta nueva, una sola vez en la vida, y solo en esa polla. */
export async function redeemCourtesy(code: string, userId: string): Promise<CourtesyRedeemResult> {
  const { data, error } = await createAdminClient().rpc("casa_redeem_courtesy_v1", {
    p_code: code, p_user_id: userId, p_contract: CASA_CONTRACT,
  });
  if (error) throw error;
  return data as CourtesyRedeemResult;
}
