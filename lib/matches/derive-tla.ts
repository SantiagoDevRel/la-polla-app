// lib/matches/derive-tla.ts — Código de 3 letras desde el nombre del equipo,
// último recurso cuando la fila no trae `*_team_abbr`. Movido desde
// lib/football-api.ts (cliente de football-data retirado el 2026-09-13).
//
// Toma iniciales de las primeras 3 palabras significativas (descartando FC,
// CF, AC, etc.), o las primeras 3 letras si el nombre es de una sola palabra.
export function deriveTla(name: string | undefined | null): string {
  if (!name) return "TBD";
  const stop = new Set(["FC", "CF", "AC", "SC", "AFC", "VFL", "VFB", "FK", "BK", "CD", "RC", "SD", "SS", "TSG", "USL"]);
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-zÀ-ÿ]/g, ""))
    .filter((w) => w.length > 0 && !stop.has(w.toUpperCase()));
  if (words.length === 0) return name.substring(0, 3).toUpperCase();
  if (words.length === 1) return words[0].substring(0, 3).toUpperCase();
  return words
    .slice(0, 3)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}
