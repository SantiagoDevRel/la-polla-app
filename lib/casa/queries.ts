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

async function withDrawState(pollas: CasaPolla[]): Promise<CasaPolla[]> {
  const pending = new Set<string>();
  const ids = pollas.filter((p) => p.status === "cerrada" && p.prize_kind === "objeto").map((p) => p.id);
  for (let offset = 0; offset < ids.length; offset += 200) {
    const { data, error } = await createAdminClient().from("casa_object_draws").select("polla_id")
      .in("polla_id", ids.slice(offset, offset + 200)).eq("state", "pending");
    if (error) throw error;
    for (const draw of data ?? []) pending.add(draw.polla_id);
  }
  return pollas.map((polla) => ({ ...polla, draw_pending: pending.has(polla.id) }));
}

/** Las pollas que la gente puede ver. Nunca devuelve borradores. */
export async function listPublicPollas(): Promise<CasaPolla[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("casa_pollas")
    .select(CASA_POLLA_COLUMNS)
    .is("archived_at", null)
    .neq("status", "borrador")
    .neq("status", "anulada")
    .order("closes_at", { ascending: true });

  if (error) throw error;
  return withDrawState((data ?? []) as CasaPolla[]);
}

/** Todas, incluidos borradores. Solo para el panel de admin / el bot. */
export async function listAllPollas(): Promise<CasaPolla[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("casa_pollas")
    .select(CASA_POLLA_COLUMNS)
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return withDrawState((data ?? []) as CasaPolla[]);
}

export async function getPollaBySlug(slug: string): Promise<CasaPolla | null> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("casa_pollas")
    .select(CASA_POLLA_COLUMNS)
    .eq("slug", slug)
    .is("archived_at", null)
    .maybeSingle();

  if (error) throw error;
  return data ? (await withDrawState([data as CasaPolla]))[0] : null;
}

/**
 * Pozo de una polla. El calculo real vive en SQL (`casa_polla_pot`) para que
 * no haya dos verdades sobre la plata.
 */
export async function getPot(pollaId: string, projectionEntry?: string): Promise<CasaPot> {
  const { data, error } = await createAdminClient().rpc("casa_payment_details_v2", {
    p_polla_id: pollaId, p_projection_entry: projectionEntry ?? null,
  });
  if (error) throw error;
  if (!data) throw new Error("No se pudo leer el pozo.");
  return data as CasaPot;
}

/** One SQL aggregate per pool; entry volume cannot truncate the monetary total. */
export async function getPots(pollaIds: string[]): Promise<Record<string, CasaPot>> {
  const out: Record<string, CasaPot> = {};
  const ids = [...new Set(pollaIds)];
  for (let start = 0; start < ids.length; start += 200) {
    const batch = ids.slice(start, start + 200);
    const { data, error } = await createAdminClient().rpc("casa_pot_summaries_v2", { p_ids: batch });
    if (error) throw error;
    if (data?.length !== batch.length) throw new Error("No se pudieron leer todos los pozos.");
    for (const row of data as Array<CasaPot & { polla_id: string }>) out[row.polla_id] = row;
  }
  return out;
}

/** Paid > pending > rejected > cancelled, chosen in SQL before LIMIT. */
export async function getMyEntry(pollaId: string, userId: string): Promise<CasaEntry | null> {
  const { data, error } = await createAdminClient().rpc("casa_my_entry_v2", { p_polla_id: pollaId, p_user_id: userId });
  if (error) throw error;
  return data as CasaEntry | null;
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
    .is("archived_at", null)
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
    .select("id, user_id, place, points, amount_cop, paid_at, prize_kind, prize_object, delivered_at")
    .eq("polla_id", pollaId)
    .order("place", { ascending: true });
  if (error) throw error;

  const filas = (data ?? []) as Array<Omit<CasaPayout, "display_name" | "avatar_url">>;
  if (filas.length === 0) return [];

  const { data: users, error: usersError } = await db
    .from("users")
    .select("id, display_name, avatar_url")
    .in(
      "id",
      filas.map((f) => f.user_id),
    );
  if (usersError) throw usersError;
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
    .select(`${CASA_ENTRY_COLUMNS}, casa_pollas!inner(archived_at,status)`)
    .eq("status", "pendiente")
    .is("casa_pollas.archived_at", null)
    .in("casa_pollas.status", ["abierta", "cerrada"])
    .not("proof_path", "is", null)
    .order("proof_uploaded_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as CasaEntry[];
}

export async function getHouseTotal(pollaIds: string[]): Promise<number> {
  const { data, error } = await createAdminClient().rpc("casa_house_total_v2", { p_ids: pollaIds });
  if (error) throw error;
  if (typeof data !== "number") throw new Error("No se pudo leer la recaudación de la casa.");
  return data;
}

/** Owned, unexpired uploads; the database clock decides whether recovery is open. */
export async function getActiveProofs(pollaId: string, userId: string): Promise<Array<{ entry_id: string; ticket_number: number | null }>> {
  const { data, error } = await createAdminClient().rpc("casa_active_proofs_v2", { p_polla_id: pollaId, p_user_id: userId });
  if (error) throw error;
  return data ?? [];
}
