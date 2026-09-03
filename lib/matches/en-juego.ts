// lib/matches/en-juego.ts — "¿este partido lo está jugando alguien?"
//
// ─── POR QUE EXISTE (2026-09-03) ──────────────────────────────────────────
// La app tiene DOS modelos de polla conviviendo:
//   · el P2P viejo, donde jugar deja filas en `predictions`
//   · la casa (casa_*), donde los partidos se atan por `casa_polla_matches`
//
// Cuatro lugares del repo decidían "este partido le importa a alguien" con
// `predictions!inner(id)`, o sea preguntándole SOLO al modelo viejo. Para una
// polla de la casa eso da vacío, y el efecto es una cadena que se rompe
// entera y en silencio:
//
//   el sync en vivo no lo actualiza  ->  nunca pasa a `finished`
//   -> el verificador no lo ve       ->  nunca se escribe final_verified_at
//   -> casa_score_polla devuelve 0   ->  NADIE puntúa, jamás
//
// Y no avisa: cada consulta devuelve 0 filas, que es indistinguible de "no
// hay nada que hacer".
//
// ⚠️ TRAMPA QUE YA COSTÓ UNA VUELTA: `casa_polla_matches` NO tiene columna
// `id` — su PK es compuesta (polla_id, match_id). Pedir `casa_polla_matches
// !inner(id)` falla con «column casa_polla_matches_1.id does not exist» y,
// como el error se suele loguear y seguir, el síntoma vuelve a ser el mismo
// silencio. Por eso acá se pide `polla_id`.
//
// PostgREST no sabe expresar "inner join con A O con B" en un solo select,
// así que son dos consultas que se fusionan por id. Vive en UN archivo para
// que la próxima superficie que necesite esto no vuelva a preguntarle solo al
// modelo viejo.

import type { SupabaseClient } from "@supabase/supabase-js";

/** Devuelve el mismo builder con los filtros comunes ya aplicados. */
type AplicarFiltros = (q: any) => any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface EnJuegoResult<T> {
  /** Filas únicas por id, de cualquiera de los dos modelos. */
  filas: T[];
  /** Mensajes de las consultas que fallaron. Vacío = las dos anduvieron. */
  errores: string[];
}

/**
 * Trae los `matches` que están en al menos una polla — vieja o de la casa.
 *
 * @param db        cliente con service_role
 * @param columnas  lista explícita de columnas (nunca `*`: regla del repo)
 * @param filtros   los filtros que comparten las dos consultas
 */
export async function matchesEnJuego<T extends { id: string }>(
  db: SupabaseClient,
  columnas: string,
  filtros: AplicarFiltros,
): Promise<EnJuegoResult<T>> {
  const [p2p, casa] = await Promise.all([
    filtros(db.from("matches").select(`${columnas}, predictions!inner(id)`)),
    // `polla_id` y no `id` — ver la trampa en la cabecera del archivo.
    filtros(
      db.from("matches").select(`${columnas}, casa_polla_matches!inner(polla_id)`),
    ),
  ]);

  const errores: string[] = [];
  if (p2p.error) errores.push(`p2p: ${p2p.error.message}`);
  if (casa.error) errores.push(`casa: ${casa.error.message}`);

  // Si UNA falla se sigue con la otra: perder los candidatos de un modelo es
  // malo, perder los de los dos porque uno se cayó es peor.
  const vistos = new Set<string>();
  const filas: T[] = [];
  for (const fila of [...(p2p.data ?? []), ...(casa.data ?? [])]) {
    const f = fila as T & { predictions?: unknown; casa_polla_matches?: unknown };
    if (vistos.has(f.id)) continue;
    vistos.add(f.id);
    // El embed viene solo para forzar el inner join; no se propaga.
    const { predictions: _p, casa_polla_matches: _c, ...resto } = f;
    void _p;
    void _c;
    filas.push(resto as T);
  }
  return { filas, errores };
}
