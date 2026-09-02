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
  type CasaPayout,
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
 * Las pollas donde ya pagaste (o estas esperando aprobacion) y TE FALTAN
 * pronosticos, con cuantos faltan y cuanto queda para el cierre.
 *
 * (2026-09-02) El unico aviso que existia era el numerito del BottomNav, y
 * un badge no dice ni en cual polla ni cuanto falta. No hay recordatorio por
 * SMS ni por WhatsApp para las pollas de la casa: el cron de recordatorios
 * (app/api/cron/match-reminders) lee `pollas`/`predictions`, o sea el modelo
 * P2P viejo, y no sabe que existe `casa_*`.
 *
 * Un SMS de recordatorio ademas costaria creditos por cada persona y cada
 * polla; dentro de la app es gratis y llega igual, porque para pronosticar
 * hay que abrirla de todas formas.
 */
export async function listPollasConPicksPendientes(
  userId: string,
): Promise<Array<{ polla: CasaPolla; faltan: number; total: number }>> {
  const db = createAdminClient();

  // Filtro explicito por user_id ademas de RLS — ver el TODO de auth.uid().
  const { data: entries } = await db
    .from("casa_entries")
    .select("id, polla_id")
    .eq("user_id", userId)
    .in("status", ["pagada", "pendiente"]);
  if (!entries || entries.length === 0) return [];

  const { data: pollas } = await db
    .from("casa_pollas")
    .select(CASA_POLLA_COLUMNS)
    .in(
      "id",
      entries.map((e: { polla_id: string }) => e.polla_id),
    )
    .eq("status", "abierta")
    .gt("closes_at", new Date().toISOString())
    .order("closes_at", { ascending: true });
  if (!pollas || pollas.length === 0) return [];

  const porId = new Map(
    (pollas as CasaPolla[]).map((p) => [p.id, p]),
  );

  const salida: Array<{ polla: CasaPolla; faltan: number; total: number }> = [];
  for (const entry of entries as Array<{ id: string; polla_id: string }>) {
    const polla = porId.get(entry.polla_id);
    if (!polla) continue;

    const [{ count: total }, { count: hechos }] = await Promise.all([
      db
        .from("casa_polla_matches")
        .select("match_id", { count: "exact", head: true })
        .eq("polla_id", polla.id),
      db
        .from("casa_picks")
        .select("id", { count: "exact", head: true })
        .eq("entry_id", entry.id),
    ]);

    const faltan = (total ?? 0) - (hechos ?? 0);
    if (faltan > 0) salida.push({ polla, faltan, total: total ?? 0 });
  }
  return salida;
}

/**
 * Quien gano y cuanto, cuando la polla ya se repartio.
 *
 * (2026-09-02) `casa_settle_polla` escribia estas filas desde el dia uno y
 * ningun archivo de la app las leia — la unica forma de saber el resultado
 * era que el admin mirara la respuesta del bot de Telegram. Esto lo arregla.
 *
 * Adorna con nombre y pollito igual que el leaderboard. Se enumeran las
 * columnas a mano (regla dura del repo: nunca `select("*")` sobre tablas con
 * datos de usuario).
 */
export async function getPayouts(pollaId: string): Promise<CasaPayout[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("casa_payouts")
    .select("user_id, place, points, amount_cop, paid_at")
    .eq("polla_id", pollaId)
    .order("place", { ascending: true });
  if (error) throw error;

  const filas = (data ?? []) as Array<Omit<CasaPayout, "display_name" | "avatar_url">>;
  if (filas.length === 0) return [];

  const { data: users } = await db
    .from("users")
    .select("id, display_name, avatar_url")
    .in(
      "id",
      filas.map((f) => f.user_id),
    );
  const porId = new Map(
    (users ?? []).map((u: { id: string; display_name: string | null; avatar_url: string | null }) => [
      u.id,
      u,
    ]),
  );

  return filas.map((f) => ({
    ...f,
    display_name: porId.get(f.user_id)?.display_name ?? null,
    avatar_url: porId.get(f.user_id)?.avatar_url ?? null,
  }));
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
