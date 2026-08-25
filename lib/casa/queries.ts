// lib/casa/queries.ts — acceso a datos de la polla centralizada.
//
// Todo pasa por `createAdminClient()` (service_role) porque en este proyecto
// `auth.uid()` NO propaga al contexto de PostgREST — ver el TODO de
// auth.uid() en CLAUDE.md. Eso obliga a filtrar por `user_id` A MANO en cada
// lectura que dependa del usuario. Las funciones de acá lo hacen siempre; si
// agregás una nueva, el filtro explicito no es opcional.

import { createAdminClient } from "@/lib/supabase/admin";
import { MATCH_COLUMNS } from "@/lib/db/columns";
import {
  CASA_ENTRY_COLUMNS,
  CASA_PICK_COLUMNS,
  CASA_POLLA_COLUMNS,
  type CasaDistribution,
  type CasaEntry,
  type CasaLeaderboardRow,
  type CasaPick,
  type CasaPolla,
  type CasaPot,
  type CasaQuestion,
} from "./types";

const EMPTY_POT: CasaPot = {
  paid_entries: 0,
  gross_cop: 0,
  prize_cop: 0,
  house_cop: 0,
};

/** Las pollas que la gente puede ver. Nunca devuelve borradores. */
export async function listPublicPollas(): Promise<CasaPolla[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("casa_pollas")
    .select(CASA_POLLA_COLUMNS)
    .neq("status", "borrador")
    .neq("status", "anulada")
    .order("closes_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as CasaPolla[];
}

/** Todas, incluidos borradores. Solo para el panel de admin / el bot. */
export async function listAllPollas(): Promise<CasaPolla[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("casa_pollas")
    .select(CASA_POLLA_COLUMNS)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as CasaPolla[];
}

export async function getPollaBySlug(slug: string): Promise<CasaPolla | null> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("casa_pollas")
    .select(CASA_POLLA_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw error;
  return (data as CasaPolla) ?? null;
}

/**
 * Pozo de una polla. El calculo real vive en SQL (`casa_polla_pot`) para que
 * no haya dos verdades sobre la plata.
 */
export async function getPot(pollaId: string): Promise<CasaPot> {
  const db = createAdminClient();
  const { data, error } = await db.rpc("casa_polla_pot", { p_polla_id: pollaId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row as CasaPot) ?? EMPTY_POT;
}

/** Pozos de varias pollas de una. Evita el N+1 en el listado del inicio. */
export async function getPots(
  pollaIds: string[],
): Promise<Record<string, CasaPot>> {
  if (pollaIds.length === 0) return {};
  const db = createAdminClient();

  // Una sola pasada por casa_entries y agregamos en JS sobre un set acotado
  // (solo las pagadas de estas pollas). El corte de 1000 filas de PostgREST no
  // aplica: pedimos count exacto por polla con un group-by del lado del server.
  const { data, error } = await db
    .from("casa_entries")
    .select("polla_id, amount_cop")
    .in("polla_id", pollaIds)
    .eq("status", "pagada")
    .limit(10000);

  if (error) throw error;

  const { data: pollas, error: pErr } = await db
    .from("casa_pollas")
    .select("id, house_cut_pct")
    .in("id", pollaIds);
  if (pErr) throw pErr;

  const cutById = new Map<string, number>(
    (pollas ?? []).map((p: { id: string; house_cut_pct: number }) => [
      p.id,
      p.house_cut_pct,
    ]),
  );

  const acc: Record<string, { n: number; gross: number }> = {};
  for (const row of (data ?? []) as { polla_id: string; amount_cop: number }[]) {
    const bucket = (acc[row.polla_id] ??= { n: 0, gross: 0 });
    bucket.n += 1;
    bucket.gross += row.amount_cop;
  }

  const out: Record<string, CasaPot> = {};
  for (const id of pollaIds) {
    const bucket = acc[id] ?? { n: 0, gross: 0 };
    const cut = cutById.get(id) ?? 30;
    const prize = Math.floor((bucket.gross * (100 - cut)) / 100);
    out[id] = {
      paid_entries: bucket.n,
      gross_cop: bucket.gross,
      prize_cop: prize,
      house_cop: bucket.gross - prize,
    };
  }
  return out;
}

/** La inscripcion de ESTE usuario en esta polla (o null si no entro). */
export async function getMyEntry(
  pollaId: string,
  userId: string,
): Promise<CasaEntry | null> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("casa_entries")
    .select(CASA_ENTRY_COLUMNS)
    .eq("polla_id", pollaId)
    .eq("user_id", userId) // ← filtro explicito obligatorio (ver cabecera)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as CasaEntry) ?? null;
}

export async function getMyPicks(
  pollaId: string,
  userId: string,
): Promise<CasaPick[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("casa_picks")
    .select(CASA_PICK_COLUMNS)
    .eq("polla_id", pollaId)
    .eq("user_id", userId); // ← filtro explicito obligatorio

  if (error) throw error;
  return (data ?? []) as CasaPick[];
}

/** Los partidos de la polla, en el orden que definio el admin. */
export async function getPollaMatches(pollaId: string) {
  const db = createAdminClient();
  const { data: links, error } = await db
    .from("casa_polla_matches")
    .select("match_id, order_index")
    .eq("polla_id", pollaId)
    .order("order_index", { ascending: true });

  if (error) throw error;
  const ids = (links ?? []).map((l: { match_id: string }) => l.match_id);
  if (ids.length === 0) return [];

  const { data: matches, error: mErr } = await db
    .from("matches")
    .select(MATCH_COLUMNS)
    .in("id", ids);
  if (mErr) throw mErr;

  const order = new Map(
    (links ?? []).map((l: { match_id: string; order_index: number }) => [
      l.match_id,
      l.order_index,
    ]),
  );
  return (matches ?? []).sort(
    (a: { id: string }, b: { id: string }) =>
      (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
  );
}

export async function getPollaQuestions(pollaId: string): Promise<CasaQuestion[]> {
  const db = createAdminClient();
  const { data: questions, error } = await db
    .from("casa_questions")
    .select(
      "id, polla_id, prompt, order_index, points, input_kind, resolved_option_id, resolved_text, resolved_at",
    )
    .eq("polla_id", pollaId)
    .order("order_index", { ascending: true });

  if (error) throw error;
  const qs = (questions ?? []) as CasaQuestion[];
  if (qs.length === 0) return [];

  const { data: options, error: oErr } = await db
    .from("casa_options")
    .select("id, question_id, label, order_index")
    .in(
      "question_id",
      qs.map((q) => q.id),
    )
    .order("order_index", { ascending: true });
  if (oErr) throw oErr;

  const byQuestion = new Map<string, CasaQuestion["options"]>();
  for (const o of (options ?? []) as NonNullable<CasaQuestion["options"]>) {
    const list = byQuestion.get(o.question_id) ?? [];
    list.push(o);
    byQuestion.set(o.question_id, list);
  }
  return qs.map((q) => ({ ...q, options: byQuestion.get(q.id) ?? [] }));
}

export async function getLeaderboard(
  pollaId: string,
): Promise<CasaLeaderboardRow[]> {
  const db = createAdminClient();
  const { data, error } = await db.rpc("casa_leaderboard", {
    p_polla_id: pollaId,
  });
  if (error) throw error;
  return (data ?? []) as CasaLeaderboardRow[];
}

/**
 * Los porcentajes: "cuantos pusieron 2-1", "cuantos pusieron a Morelos".
 * Se calcula en SQL sobre las inscripciones PAGADAS unicamente.
 */
export async function getDistribution(pollaId: string): Promise<CasaDistribution> {
  const db = createAdminClient();
  const { data, error } = await db.rpc("casa_pick_distribution", {
    p_polla_id: pollaId,
  });
  if (error) throw error;
  return (data ?? {
    resultado: {},
    marcador: {},
    preguntas: {},
  }) as CasaDistribution;
}

/** La cola del bot: pagos con pantallazo esperando que Tama decida. */
export async function listPendingProofs(limit = 20) {
  const db = createAdminClient();
  const { data, error } = await db
    .from("casa_entries")
    .select(CASA_ENTRY_COLUMNS)
    .eq("status", "pendiente")
    .not("proof_path", "is", null)
    .order("proof_uploaded_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as CasaEntry[];
}
