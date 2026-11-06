import "server-only";
// lib/rifas/featured.ts — rifas destacadas arriba del inicio (2026-11-06).
//
// Inicio dejó las pestañas POLLAS | RIFAS: todo va en una pantalla y las rifas
// sin ánimo de lucro salen de primeras. Quién puede ver cada una lo decide SQL
// (rifa_public_view_v1): una Privada solo le aparece a su equipo y a los
// administradores, igual que al abrir el enlace.
import { createAdminClient } from "@/lib/supabase/admin";
import { FEATURED_RIFA_IDS } from "./benefit";
import { getPublicView } from "./server";
import type { RifaPublicView } from "./shared";

export async function listFeaturedRifas(viewerId: string): Promise<RifaPublicView[]> {
  if (FEATURED_RIFA_IDS.length === 0) return [];
  const { data, error } = await createAdminClient().from("rifas").select("slug")
    .in("id", [...FEATURED_RIFA_IDS]).eq("status", "abierta").is("hidden_at", null);
  if (error || !data) return [];
  const views = await Promise.all(data.map((r) => getPublicView(r.slug, viewerId)));
  const order = (id: string) => FEATURED_RIFA_IDS.indexOf(id);
  return views.flatMap((v) => (v.data && !v.error && v.data.status === "abierta" && !v.data.hidden ? [v.data] : []))
    .sort((a, b) => order(a.id) - order(b.id));
}
