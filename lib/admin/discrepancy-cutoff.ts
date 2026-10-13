// lib/admin/discrepancy-cutoff.ts — Desde cuándo importa una discrepancia.
//
// (2026-10-13) Decisión del dueño: lo anterior a OFIGOLAZO, la primera polla
// de la casa v2 (creada el 13-sep-2026), no importa. El email diario repetía
// todos los días las 38 pollas P2P del Mundial (abril a julio) que quedaron
// `ended` sin filas en `polla_payouts`. El modelo P2P ya no se juega, así que
// esas filas nunca iban a cambiar y el correo nunca dejaba de llegar.
//
// Es 00:00 del 13-sep en Colombia (UTC-5). El email diario,
// /admin/discrepancias y /api/admin/polla-health filtran por esta fecha:
// pollas por `created_at`, partidos por `scheduled_at`.
export const DISCREPANCIAS_DESDE = "2026-09-13T05:00:00.000Z";
