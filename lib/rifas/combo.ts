// lib/rifas/combo.ts — lectura y escritura de «¿Eres de un combo?» (migración 180).
//
// Tabla solo de service_role. Quien llama ya validó la sesión: el user_id es
// siempre el de la sesión, y el resumen solo se pide para un administrador.
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { summarizeCombos, type ComboAnswerInput, type ComboAnswerRow, type ComboSummary } from "./combo-shared";

const PAGE = 1000;

export async function hasComboAnswer(rifaId: string, userId: string): Promise<boolean> {
  const { data, error } = await createAdminClient().from("rifa_combo_answers")
    .select("user_id").eq("rifa_id", rifaId).eq("user_id", userId).maybeSingle();
  // Si la lectura falla no se pregunta: mejor perder un dato que trabar la rifa.
  return error ? true : data !== null;
}

export async function saveComboAnswer(rifaId: string, userId: string, answer: ComboAnswerInput) {
  const { error } = await createAdminClient().from("rifa_combo_answers").upsert({
    rifa_id: rifaId, user_id: userId, in_combo: answer.in_combo,
    combo: answer.in_combo ? answer.combo : null, updated_at: new Date().toISOString(),
  }, { onConflict: "rifa_id,user_id" });
  return error;
}

/** Todas las respuestas de la rifa, paginadas (PostgREST topa en 1000 filas). */
export async function getComboSummary(rifaId: string): Promise<ComboSummary | null> {
  const rows: ComboAnswerRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await createAdminClient().from("rifa_combo_answers")
      .select("in_combo, combo, user_id, users(display_name)")
      .eq("rifa_id", rifaId).order("created_at").order("user_id").range(from, from + PAGE - 1);
    if (error) return null;
    for (const r of data ?? []) {
      const user = (Array.isArray(r.users) ? r.users[0] : r.users) as { display_name: string | null } | null;
      rows.push({ name: user?.display_name ?? null, in_combo: r.in_combo, combo: r.combo });
    }
    if (!data || data.length < PAGE) break;
  }
  return summarizeCombos(rows);
}
