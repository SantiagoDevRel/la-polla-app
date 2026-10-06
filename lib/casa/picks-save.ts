// lib/casa/picks-save.ts — guardar los pronósticos de UNA persona en UNA polla.
//
// Vive fuera de app/api/casa/pollas/[slug]/picks/route.ts porque la web y el
// bot de Telegram para jugadores guardan por el MISMO camino: una sola verdad
// sobre qué se puede pronosticar y cuándo (reglas duras de ese route).
//
//  * Solo se pronostica con inscripción pagada o con comprobante en revisión.
//  * Se bloquea cuando la polla ya no recibe pronósticos y, además, partido por
//    partido: un partido que ya arrancó (o a menos de 5 minutos) no se toca.
//    El trigger casa_guard_pick_lifecycle (migración 107) lo vuelve a validar.
//  * Los picks NUNCA se borran; se sobrescriben con upsert por (entry, target).
//
// El llamador ya validó la sesión (web) o la cuenta vinculada (Telegram) y
// pasa el user_id: todas las lecturas y escrituras filtran por él.

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { CASA_ENTRY_COLUMNS, type CasaEntry } from "./types";
import { isPickSaveAck, normalizedPick, type PickSaveAck, type PickSaveOperation, type PickSaveState } from "./picks-protocol";
import { randomUUID } from "node:crypto";
import { isPollaOpen, type CasaPolla } from "./types";
import { acceptsCasaMatchPicks } from "./match-rules";

export const casaPickSchema = z
  .object({
    matchId: z.string().uuid().optional(),
    questionId: z.string().uuid().optional(),
    pick1x2: z.enum(["L", "E", "V"]).nullable().optional(),
    homeScore: z.number().int().min(0).max(30).nullable().optional(),
    awayScore: z.number().int().min(0).max(30).nullable().optional(),
    optionId: z.string().uuid().nullable().optional(),
    freeText: z.string().trim().max(120).nullable().optional(),
  })
  .refine((p) => Boolean(p.matchId) !== Boolean(p.questionId), {
    message: "Cada pronóstico apunta a un partido O a una pregunta, no a los dos.",
  });

export const casaPicksBodySchema = z.object({
  picks: z.array(casaPickSchema).min(1).max(60),
  /** Participación a la que van los pronósticos (migración 131). Ausente = la principal. */
  entryNumber: z.number().int().min(1).max(50).optional(),
  entryId: z.string().uuid().optional(),
  requestId: z.string().uuid().optional(),
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
}).refine(b => (b.requestId === undefined) === (b.expectedRevision === undefined), {
  message: "La confirmación del envío está incompleta.",
}).refine(b => b.requestId === undefined || b.entryId !== undefined, {
  message: "La participación del envío está incompleta.",
}).refine(b => new Set(b.picks.map(p => p.matchId ?? p.questionId)).size === b.picks.length, {
  message: "Un pronóstico no puede repetirse en el mismo envío.",
});

export type CasaPickInput = z.infer<typeof casaPickSchema>;

export type SaveCasaPicksResult =
  | PickSaveAck
  | { ok: false; status: 400 | 403 | 409 | 500 | 503; error: string; conflict?: boolean; retryable?: boolean };

type PollaForPicks = Pick<CasaPolla, "id" | "kind" | "status" | "closes_at" | "opens_at" | "publication_mode" | "scoring_mode" | "draw_pending">;

/** ¿Esta polla sigue recibiendo pronósticos? Mismo criterio que la web. */
export function pollaAcceptsPicks(polla: PollaForPicks): boolean {
  return polla.kind === "partidos" ? acceptsCasaMatchPicks(polla.status, polla.draw_pending) : isPollaOpen(polla);
}

/** Inscripción que puede pronosticar: pagada, o pendiente con comprobante subido. */
export function entryCanPick(entry: { status: string; proof_path: string | null } | null): boolean {
  return Boolean(entry && (entry.status === "pagada" || (entry.status === "pendiente" && entry.proof_path)));
}


/** Every entry lookup uses the injected database and explicit owner scope. */
export async function getOwnedPickEntry(pollaId: string, userId: string, db: SupabaseClient, entryNumber?: number): Promise<CasaEntry | null> {
  if (entryNumber === undefined) {
    const { data, error } = await db.rpc("casa_my_entry_v2", { p_polla_id: pollaId, p_user_id: userId });
    if (error) throw error;
    return data as CasaEntry | null;
  }
  const { data, error } = await db.from("casa_entries").select(CASA_ENTRY_COLUMNS)
    .eq("polla_id", pollaId).eq("user_id", userId).is("ticket_number", null)
    .eq("entry_number", entryNumber).or("origin.eq.compra,status.eq.pagada").maybeSingle();
  if (error) throw error;
  return data as CasaEntry | null;
}

export async function getPickSaveState(pollaId: string, userId: string, entryId: string, db: SupabaseClient = createAdminClient()): Promise<PickSaveState | null> {
  const { data, error } = await db.rpc("casa_pick_save_state_v1", { p_polla_id: pollaId, p_user_id: userId, p_entry_id: entryId });
  if (error) throw error;
  return data ? { ...data, entryId, ownerId: userId } as PickSaveState : null;
}

export async function saveCasaPicks(
  polla: PollaForPicks, userId: string, picks: CasaPickInput[],
  db: SupabaseClient = createAdminClient(), entryNumber?: number,
  operation?: Pick<PickSaveOperation, "requestId" | "expectedRevision" | "entryId">,
): Promise<SaveCasaPicksResult> {
  if (!userId) return { ok: false, status: 403, error: "Primero tienes que inscribirte a la polla." };
  if (!operation && !pollaAcceptsPicks(polla)) return { ok: false, status: 409, error: "Esta polla ya cerró. Los pronósticos quedaron como estaban." };
  try {
    const entry = await getOwnedPickEntry(polla.id, userId, db, entryNumber);
    if (!entry || (operation?.entryId && operation.entryId !== entry.id)) {
      return { ok: false, status: 403, error: "La sesión o el cupo cambió. Vuelve a abrir esta polla para guardar." };
    }
    // Versioned requests reach SQL even after closure so completed operations
    // can return their original confirmation. Legacy calls keep their preflight.
    if (!operation && !entryCanPick(entry)) return { ok: false, status: 403, error: "Primero tienes que inscribirte a la polla." };
    const input = picks.map(p => ({ ...normalizedPick(p), ...(p.matchId ? { matchId: p.matchId } : { questionId: p.questionId }) }));
    const requestId = operation?.requestId ?? randomUUID();
    const { data, error } = await db.rpc("casa_save_picks_v1", {
      p_polla_id: polla.id, p_user_id: userId, p_entry_id: entry.id,
      p_request_id: requestId, p_expected_revision: operation?.expectedRevision ?? null, p_picks: input,
    });
    if (error) {
      if (["55P03", "40P01", "57014"].includes(error.code)) return {
        ok: false, status: 503, retryable: true, error: "La polla se está actualizando. Conservamos tus cambios; puedes volver a comprobarlos.",
      };
      if (error.code === "42501") return { ok: false, status: 403, error: "Primero tienes que inscribirte a la polla." };
      if (error.code === "22023") return { ok: false, status: 400, error: "El envío no es válido. Conservamos tus cambios." };
      if (error.code === "55000") return { ok: false, status: 409, error: error.message === "OPERATIONS_PAUSED"
        ? "La polla se está actualizando. Conservamos tus cambios." : "Esta polla ya no recibe pronósticos. Los anteriores se conservaron." };
      return { ok: false, status: 500, error: "No pudimos confirmar el guardado. Conservamos tus cambios." };
    }
    if (data?.ok === false && data.conflict === true) return { ok: false, status: 409, conflict: true, error: "Hay pronósticos más recientes. Revisa tus cambios antes de volver a guardar." };
    if (!isPickSaveAck(data) || data.requestId !== requestId) return { ok: false, status: 500, error: "No pudimos confirmar el guardado. Conservamos tus cambios." };
    if (!operation && data.guardados === 0) return { ok: false, status: 400, error: data.avisos[0] ?? "No había nada para guardar." };
    return data;
  } catch {
    return { ok: false, status: 500, error: "No pudimos confirmar el guardado. Conservamos tus cambios." };
  }
}
