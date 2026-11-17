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
import type { RifaMyList, RifaPublicView } from "./shared";

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

/** Cuántas rifas terminadas se muestran en Terminadas, las más recientes. */
const MAX_FINISHED = 10;

/**
 * (2026-11-16, pedido del dueño) Las rifas que ya jugaron pasan a Terminadas,
 * junto a las pollas terminadas, y la sección Rifas se queda solo con las
 * abiertas (sin rifas abiertas, no se dibuja). Entran las destacadas (para
 * todos, como las pollas terminadas públicas) y las de la persona: las que
 * opera y donde compró. Quién puede ver cada una lo sigue decidiendo SQL.
 */
export async function listFinishedRifas(viewerId: string, mine: RifaMyList | null): Promise<RifaPublicView[]> {
  const slugs = new Set<string>();
  if (FEATURED_RIFA_IDS.length > 0) {
    const { data } = await createAdminClient().from("rifas").select("slug")
      .in("id", [...FEATURED_RIFA_IDS]).neq("status", "abierta").is("hidden_at", null);
    for (const r of data ?? []) slugs.add(r.slug);
  }
  for (const r of mine?.created ?? []) if (r.status !== "abierta" && !r.hidden) slugs.add(r.slug);
  for (const r of mine?.bought ?? []) if (r.status !== "abierta") slugs.add(r.slug);
  if (slugs.size === 0) return [];
  const views = await Promise.all([...slugs].map((slug) => getPublicView(slug, viewerId)));
  return views.flatMap((v) => (v.data && !v.error && v.data.status !== "abierta" && !v.data.hidden ? [v.data] : []))
    .sort((a, b) => Date.parse(b.draw_at) - Date.parse(a.draw_at))
    .slice(0, MAX_FINISHED);
}
