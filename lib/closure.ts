// lib/closure.ts — qué está retirado del producto viejo.
//
// ─── HISTORIA CORTA ───
// (2026-07-26) El Mundial terminó y no quedaba ningún torneo con partidos
// futuros. Como sin torneos el wizard de /pollas/crear renderizaba un form
// vacío y roto, se derivó un "modo temporada cerrada" de la lista
// CREATABLE_TOURNAMENT_SLUGS: lista vacía = cerrado. Un solo interruptor,
// sin flag propio que se pudiera desincronizar.
//
// (2026-08-25) Eso dejó de servir, y de una forma peligrosa. La app pivotó
// a la casa centralizada, y para eso hubo que volver a llenar
// CREATABLE_TOURNAMENT_SLUGS con las 8 ligas — porque la casa SÍ necesita
// esos torneos para armar sus pollas. Efecto colateral: `SEASON_CLOSED`
// pasó a false y **el wizard P2P viejo revivió**, dejando que cualquiera
// creara pollas propias. Justo lo contrario de la premisa del producto
// nuevo, donde solo la casa arma pollas.
//
// La lección: derivar un estado de producto de un dato de configuración
// funciona hasta que ese dato cambia por otra razón. Ahora son dos cosas
// distintas porque SON dos cosas distintas:
//
//   CREATABLE_TOURNAMENT_SLUGS → qué ligas puede usar la casa (dato)
//   P2P_CREATION_RETIRED       → si la gente puede crear pollas (producto)

import { CREATABLE_TOURNAMENT_SLUGS } from "@/lib/tournaments";

/**
 * El modelo viejo "cualquiera crea su polla e invita a sus amigos" está
 * RETIRADO. Lo reemplazó la casa centralizada: solo el admin arma pollas y
 * la gente entra pagando (ver /casa y las tablas casa_*).
 *
 * Con esto en true:
 *   · /pollas/crear no arma nada — manda a la casa.
 *   · POST /api/pollas responde 403 antes de tocar la DB.
 *   · El nav no ofrece crear ni unirse por código.
 *
 * Las pollas P2P que ya existen NO se tocan: se siguen pudiendo ver, con
 * sus tablas y su historia. Lo retirado es CREAR nuevas.
 *
 * Para revivir el modelo viejo (no deberías): poné esto en false.
 */
export const P2P_CREATION_RETIRED = true;

/**
 * @deprecated Quedó como alias para no romper los ~8 usos que ya existen.
 * Antes significaba "no hay torneos, no se puede crear nada"; hoy lo que
 * importa es que la creación P2P está retirada, sin importar los torneos.
 * En código nuevo usá `P2P_CREATION_RETIRED`.
 */
export const SEASON_CLOSED =
  P2P_CREATION_RETIRED || CREATABLE_TOURNAMENT_SLUGS.length === 0;

/**
 * Fecha del último partido verificado del Mundial 2026 (final), en ISO.
 * Solo se usa para copy/telemetría; no gatea nada.
 */
export const SEASON_CLOSED_SINCE = "2026-07-19";
