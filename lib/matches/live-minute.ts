// lib/matches/live-minute.ts — shared helper for the live match clock.
//
// Fuente preferida: `match.elapsed` poblado por ESPN cada minuto vía
// el cron sync-live. ESPN reporta el minuto del partido auténtico
// (con stoppage time del primer tiempo, descuento real, etc.) — más
// confiable que cualquier cálculo nuestro.
//
// Fallback: cuando elapsed no está disponible (match recién flippeado
// a live, ESPN aún no escribió, etc.) calculamos del kickoff con un
// allowance fijo de 15 min de descanso:
//
//   real elapsed ≤ 45 → first-half minute = real elapsed
//   real elapsed 46–60 → halftime (show 45')
//   real elapsed ≥ 60 → second-half minute = real elapsed − 15
//
// El fallback es impreciso (ignora delayed kickoffs, descansos
// extendidos, stoppage time del primer tiempo). Solo se usa como
// emergency hasta que ESPN llene el campo.

export type LiveMinute = number | "90+" | null;

/**
 * Devuelve el minuto del partido. Prioriza `dbElapsed` (autoritativo
 * de ESPN). Si no hay, cae al cálculo desde kickoff.
 *
 * @param scheduledAt - kickoff programado (fallback only)
 * @param dbElapsed   - matches.elapsed escrito por la sync (preferido)
 */
export function computeLiveMinute(
  scheduledAt: string | Date | null | undefined,
  dbElapsed?: number | null,
): LiveMinute {
  // Preferir el valor escrito por ESPN. Solo NULL/0 invalido — un 0
  // genuino significa "kickoff exacto" pero los feed lo reportan como
  // 1' inmediato, así que tratarlo como ausente es seguro.
  if (typeof dbElapsed === "number" && dbElapsed > 0) {
    if (dbElapsed >= 90) return "90+";
    return dbElapsed;
  }

  if (!scheduledAt) return null;
  const kickoffMs = new Date(scheduledAt).getTime();
  if (Number.isNaN(kickoffMs)) return null;

  const elapsedMs = Date.now() - kickoffMs;
  if (elapsedMs < 0) return null;

  const elapsed = Math.floor(elapsedMs / 60000);
  if (elapsed <= 45) return Math.max(1, elapsed);
  if (elapsed <= 60) return 45;

  const secondHalf = elapsed - 15;
  if (secondHalf >= 90) return "90+";
  return secondHalf;
}

export function formatLiveMinute(minute: LiveMinute): string | null {
  if (minute == null) return null;
  return typeof minute === "number" ? `${minute}'` : `${minute}'`;
}

/**
 * Mapea el status detail de ESPN a una etiqueta amistosa para los
 * casos donde NO queremos mostrar el minuto (descanso, fin de
 * tiempo regular, penales, etc). Cuando este helper devuelve string,
 * la UI lo usa en lugar del clock minute.
 *
 * Pasale `match.live_status_detail` (o equivalente). Si no está o no
 * matchea ningún caso especial, retorna null y la UI cae al minuto.
 */
export function specialStatusLabel(
  liveStatusDetail: string | null | undefined,
): string | null {
  if (!liveStatusDetail) return null;
  switch (liveStatusDetail) {
    case "STATUS_HALFTIME":
      return "Descanso";
    case "STATUS_END_OF_REGULATION":
      return "Fin 90'";
    case "STATUS_END_OF_PERIOD":
      return "Fin 1°T";
    case "STATUS_OVERTIME":
    case "STATUS_FIRST_HALF_EXTRA_TIME":
    case "STATUS_SECOND_HALF_EXTRA_TIME":
      return "Tiempo extra";
    case "STATUS_END_OF_EXTRA_TIME":
      return "Fin ET";
    case "STATUS_SHOOTOUT":
      return "Penales";
    case "STATUS_DELAYED":
      return "Demorado";
    default:
      return null;
  }
}
