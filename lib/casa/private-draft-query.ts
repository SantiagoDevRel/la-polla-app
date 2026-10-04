import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAccessCasaPolla, parseCasaPrivateDraft } from "./private-drafts";
import { CASA_POLLA_COLUMNS, type CasaPolla } from "./types";
import { canEditPolla } from "./editor";

type Actor = { id: string; is_admin: boolean } | null;

/** Always authorize before reading campaign content with the service key. */
export async function getPrivateCampaign(id: string, actor: Actor) {
  if (!actor?.is_admin || !z.string().uuid().safeParse(id).success) return null;
  const { data, error } = await createAdminClient().from("casa_pollas")
    .select(`${CASA_POLLA_COLUMNS}, campaign_draft`)
    .eq("id", id).eq("status", "borrador").eq("publication_mode", "oculta")
    .is("archived_at", null).maybeSingle();
  if (error) throw error;
  if (!data || !canAccessCasaPolla(data, actor)) return null;
  const draft = parseCasaPrivateDraft(data.campaign_draft);
  if (!draft) return null;
  const { campaign_draft: _metadata, ...polla } = data;
  void _metadata;
  return { polla: { ...polla, private_draft: true, private_draft_motion: Boolean(draft.motion) } as CasaPolla, draft };
}

/** Hidden pollas still within their administrative editing window. */
export async function listHiddenAdminPollas(actor: Actor, now: Date = new Date()): Promise<CasaPolla[]> {
  if (!actor?.is_admin) return [];
  const db = createAdminClient();
  const pollas: CasaPolla[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from("casa_pollas")
      .select(`${CASA_POLLA_COLUMNS}, campaign_draft`)
      .or("status.eq.borrador,publication_mode.eq.oculta")
      .in("status", ["borrador", "abierta"]).gt("closes_at", now.toISOString())
      .is("archived_at", null)
      .order("created_at", { ascending: false }).order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    for (const row of data ?? []) {
      if (!canAccessCasaPolla(row, actor) || !canEditPolla(row, now)) continue;
      const { campaign_draft: metadata, ...polla } = row;
      pollas.push({ ...polla, private_draft: metadata !== null,
        private_draft_motion: Boolean(parseCasaPrivateDraft(metadata)?.motion) } as CasaPolla);
    }
    if (!data || data.length < pageSize) return pollas;
  }
}

/** Private fallback for the normal detail page; player APIs keep their public getter. */
export async function getPrivateCampaignBySlug(slug: string, actor: Actor) {
  if (!actor?.is_admin) return null;
  const { data, error } = await createAdminClient().from("casa_pollas")
    .select("id").eq("slug", slug).eq("status", "borrador")
    .eq("publication_mode", "oculta").is("archived_at", null).maybeSingle();
  if (error) throw error;
  return data ? getPrivateCampaign(data.id, actor) : null;
}

/** Null = nonexistent/unauthorized; otherwise indicates an immutable draft. */
export async function getAdminPollaAccess(id: string, actor: Actor) {
  if (!actor?.is_admin || !z.string().uuid().safeParse(id).success) return null;
  const { data, error } = await createAdminClient().from("casa_pollas")
    .select("id, campaign_draft").eq("id", id).is("archived_at", null).maybeSingle();
  if (error) throw error;
  if (!data || !canAccessCasaPolla(data, actor)) return null;
  return { privateDraft: data.campaign_draft != null };
}
