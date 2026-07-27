// lib/closure.ts — Estado de "temporada cerrada" de La Polla.
//
// Contexto (2026-07-26): el Mundial 2026 terminó el 19 de julio (último
// partido verificado) y no queda NINGÚN torneo con partidos futuros en la
// DB. Las 62 pollas están en status='ended'. Sin torneos creables, el
// wizard de /pollas/crear renderizaba una lista de chips vacía — un form
// roto. Preferimos un cierre explícito y bien contado.
//
// ─── UN SOLO INTERRUPTOR ───
// El cierre NO tiene flag propio: se DERIVA de CREATABLE_TOURNAMENT_SLUGS.
// Lista vacía = temporada cerrada. Agregarle un slug (ej. "betplay_2026"
// cuando arranque la liga) reabre TODO de una: desaparece el banner, el
// wizard vuelve a funcionar y el POST /api/pollas deja de rechazar.
// Esto respeta la convención que ya estaba documentada en tournaments.ts
// ("Para reactivar una liga, agregá su slug a esta lista. No hace falta
// tocar nada más") en vez de sumar un segundo flag que se desincronice.
//
// Lo que el cierre NO toca (a propósito): login, /inicio, ver pollas,
// tablas, evolución, perfil, avisos y el bot de WhatsApp. La app sigue
// siendo de consulta — los datos de la gente se ven igual que siempre.
import { CREATABLE_TOURNAMENT_SLUGS } from "@/lib/tournaments";

/** true = no hay torneos para armar pollas nuevas → temporada cerrada. */
export const SEASON_CLOSED = CREATABLE_TOURNAMENT_SLUGS.length === 0;

/**
 * Fecha del último partido verificado del Mundial 2026 (final), en ISO.
 * Solo se usa para copy/telemetría; no gatea nada.
 */
export const SEASON_CLOSED_SINCE = "2026-07-19";
