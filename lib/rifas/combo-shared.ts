// lib/rifas/combo-shared.ts — «¿Eres de un combo de Los Del Sur?» (migración 180).
//
// Partes puras, sin servidor: validación de lo que manda la pantalla y el
// resumen por combo que ve el administrador. La gente escribe el mismo combo
// de varias formas («La 45», «la 45 », «LA 45»): se agrupan sin tildes, sin
// mayúsculas y sin espacios repetidos, y se muestra la escritura más usada.
import { z } from "zod";

export const COMBO_MAX = 80;

export const comboAnswerSchema = z.discriminatedUnion("in_combo", [
  z.object({ in_combo: z.literal(true), combo: z.string().transform((s) => s.trim().replace(/\s+/g, " ")).pipe(z.string().min(2).max(COMBO_MAX)) }),
  z.object({ in_combo: z.literal(false) }),
]);
export type ComboAnswerInput = z.infer<typeof comboAnswerSchema>;

export interface ComboAnswerRow { name: string | null; in_combo: boolean; combo: string | null }

export interface ComboGroup { combo: string; people: string[] }

export interface ComboSummary { answered: number; inCombo: number; groups: ComboGroup[] }

export function comboKey(combo: string): string {
  return combo.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim(); // sin tildes, como teamNameKey
}

/** Combos de más a menos gente (empate por nombre); se muestra la escritura más usada (a igualdad, la primera). */
export function summarizeCombos(rows: ComboAnswerRow[]): ComboSummary {
  const byKey = new Map<string, { spellings: Map<string, number>; people: string[] }>();
  let inCombo = 0;
  for (const row of rows) {
    if (!row.in_combo || !row.combo) continue;
    inCombo++;
    const key = comboKey(row.combo);
    const group = byKey.get(key) ?? { spellings: new Map<string, number>(), people: [] as string[] };
    const spelling = row.combo.trim().replace(/\s+/g, " ");
    group.spellings.set(spelling, (group.spellings.get(spelling) ?? 0) + 1);
    group.people.push(row.name?.trim() || "Sin nombre");
    byKey.set(key, group);
  }
  const groups = [...byKey.values()].map((g) => ({
    combo: [...g.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0],
    people: g.people.sort((a, b) => a.localeCompare(b, "es")),
  }));
  groups.sort((a, b) => b.people.length - a.people.length || a.combo.localeCompare(b.combo, "es"));
  return { answered: rows.length, inCombo, groups };
}
