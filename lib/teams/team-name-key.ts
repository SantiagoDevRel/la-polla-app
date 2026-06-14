// lib/teams/team-name-key.ts — clave normalizada para COMPARAR nombres de equipo.
//
// Por qué existe: los proveedores de fixtures escriben el mismo equipo distinto
// ("Curaçao" vs "Curacao", "Türkiye" vs "Turkiye"). upsert_match_safe dedup por
// contenido al insertar, pero el DISPLAY name que queda en `matches` depende de
// qué proveedor escribió último — y los lookups por nombre exacto (facts,
// planteles horneados, tabla de grupo) se rompen con ese drift: una "Curaçao"
// (cedilla) no matchea una "Curacao" (plana) → la tabla del grupo descarta el
// partido y muestra 0 pts (bug real cazado 2026-06-14, Grupo E del Mundial).
//
// Regla: TODA comparación de nombres de equipo en lookups pasa por acá. NO
// cambia el texto que se muestra al usuario — solo la clave de comparación.
export function teamNameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita diacríticos (ç→c, ü→u, í→i)
    .toLowerCase()
    .trim();
}
