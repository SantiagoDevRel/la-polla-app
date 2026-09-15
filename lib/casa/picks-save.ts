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
import { getMyEntry, getPollaMatches } from "./queries";
import { isPollaOpen, type CasaPolla } from "./types";
import { acceptsCasaMatchPicks, canEditCasaMatch } from "./match-rules";

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

export const casaPicksBodySchema = z.object({ picks: z.array(casaPickSchema).min(1).max(60) });

export type CasaPickInput = z.infer<typeof casaPickSchema>;

export type SaveCasaPicksResult =
  | { ok: true; guardados: number; avisos: string[] }
  | { ok: false; status: 400 | 403 | 409 | 500; error: string };

type PollaForPicks = Pick<CasaPolla, "id" | "kind" | "status" | "closes_at" | "opens_at" | "publication_mode" | "scoring_mode" | "draw_pending">;

/** ¿Esta polla sigue recibiendo pronósticos? Mismo criterio que la web. */
export function pollaAcceptsPicks(polla: PollaForPicks): boolean {
  return polla.kind === "partidos" ? acceptsCasaMatchPicks(polla.status, polla.draw_pending) : isPollaOpen(polla);
}

/** Inscripción que puede pronosticar: pagada, o pendiente con comprobante subido. */
export function entryCanPick(entry: { status: string; proof_path: string | null } | null): boolean {
  return Boolean(entry && (entry.status === "pagada" || (entry.status === "pendiente" && entry.proof_path)));
}

export async function saveCasaPicks(
  polla: PollaForPicks,
  userId: string,
  picks: CasaPickInput[],
  db: SupabaseClient = createAdminClient(),
): Promise<SaveCasaPicksResult> {
  if (!userId) return { ok: false, status: 403, error: "Primero tienes que inscribirte a la polla." };
  if (polla.status === "borrador") return { ok: false, status: 409, error: "Esta polla ya cerró. Los pronósticos quedaron como estaban." };
  if (!pollaAcceptsPicks(polla)) {
    return { ok: false, status: 409, error: "Esta polla ya cerró. Los pronósticos quedaron como estaban." };
  }

  const entry = await getMyEntry(polla.id, userId);
  if (!entryCanPick(entry)) {
    return { ok: false, status: 403, error: "Primero tienes que inscribirte a la polla." };
  }
  const entryId = entry!.id;

  // ── qué partidos siguen abiertos ───────────────────────────────────────
  const matches = await getPollaMatches(polla.id);
  const abiertos = new Set(matches.filter((m) => canEditCasaMatch(m)).map((m: { id: string }) => m.id));
  const deLaPolla = new Set(matches.map((m: { id: string }) => m.id));

  const { data: preguntas } = await db
    .from("casa_questions")
    .select("id, resolved_at")
    .eq("polla_id", polla.id);
  const preguntasAbiertas = new Set(
    (preguntas ?? [])
      .filter((q: { resolved_at: string | null }) => q.resolved_at === null)
      .map((q: { id: string }) => q.id),
  );

  // Una opción tiene que ser de SU pregunta: un id de otra pregunta nunca
  // sumaría, pero tampoco debe quedar guardado como si fuera una respuesta.
  const optionIds = picks.map((p) => p.optionId).filter((id): id is string => Boolean(id));
  const optionQuestion = new Map<string, string>();
  if (optionIds.length > 0 && preguntasAbiertas.size > 0) {
    const { data: options, error } = await db
      .from("casa_options")
      .select("id, question_id")
      .in("question_id", Array.from(preguntasAbiertas));
    if (error) {
      console.error("[casa/picks] opciones:", error.message);
      return { ok: false, status: 500, error: "No pude guardar." };
    }
    for (const o of (options ?? []) as Array<{ id: string; question_id: string }>) optionQuestion.set(o.id, o.question_id);
  }

  const filas = [];
  const rechazados: string[] = [];

  for (const p of picks) {
    if (p.matchId) {
      if (!deLaPolla.has(p.matchId)) {
        rechazados.push("Un partido no pertenece a esta polla.");
        continue;
      }
      if (!abiertos.has(p.matchId)) {
        rechazados.push("Un partido ya cerró sus pronósticos (5 minutos antes del inicio) o fue anulado.");
        continue;
      }
      // En modo 1X2 solo importa la opcion; en marcador, los dos numeros.
      if (polla.scoring_mode === "1x2" && !p.pick1x2) continue;
      if (polla.scoring_mode === "marcador" && (p.homeScore == null || p.awayScore == null)) continue;
    } else if (p.questionId) {
      if (!preguntasAbiertas.has(p.questionId)) {
        rechazados.push("Una pregunta ya fue resuelta.");
        continue;
      }
      if (p.optionId && optionQuestion.get(p.optionId) !== p.questionId) {
        rechazados.push("Una opción no pertenece a su pregunta.");
        continue;
      }
    }

    filas.push({
      entry_id: entryId,
      polla_id: polla.id,
      user_id: userId,
      match_id: p.matchId ?? null,
      question_id: p.questionId ?? null,
      pick_1x2: polla.scoring_mode === "1x2" ? (p.pick1x2 ?? null) : null,
      home_score: polla.scoring_mode === "marcador" ? (p.homeScore ?? null) : null,
      away_score: polla.scoring_mode === "marcador" ? (p.awayScore ?? null) : null,
      option_id: p.optionId ?? null,
      free_text: p.freeText ?? null,
      updated_at: new Date().toISOString(),
    });
  }

  if (filas.length === 0) {
    return { ok: false, status: 400, error: rechazados[0] ?? "No había nada para guardar." };
  }

  // Dos upserts: los indices unicos son parciales (uno para partidos, otro
  // para preguntas), asi que PostgREST necesita saber cual usar en cada caso.
  const dePartidos = filas.filter((f) => f.match_id);
  const dePreguntas = filas.filter((f) => f.question_id);

  for (const [lote, onConflict, etiqueta] of [
    [dePartidos, "entry_id,match_id", "partidos"],
    [dePreguntas, "entry_id,question_id", "preguntas"],
  ] as const) {
    if (lote.length === 0) continue;
    const { error } = await db.from("casa_picks").upsert(lote, { onConflict });
    if (error) {
      if (["55000", "55P03"].includes(error.code)) return { ok: false, status: 409, error: error.message };
      console.error(`[casa/picks] upsert ${etiqueta}:`, error.message);
      return { ok: false, status: 500, error: "No pude guardar." };
    }
  }

  return {
    ok: true,
    guardados: filas.length,
    // filter en vez de spread de un Set: target ES5 (ver tsconfig).
    avisos: rechazados.filter((a, i) => rechazados.indexOf(a) === i),
  };
}
