import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAccessCasaPolla, parseCasaPrivateDraft } from "./private-drafts";
import { CASA_POLLA_COLUMNS, type CasaPolla } from "./types";

type Actor = { id: string; is_admin: boolean } | null;

/** Always authorize before reading campaign content with the service key. */
export async function getPrivateCampaign(id: string, actor: Actor) {
  if (!actor?.is_admin || !z.string().uuid().safeParse(id).success) return null;
  const { data, error } = await createAdminClient().from("casa_pollas")
    .select(`${CASA_POLLA_COLUMNS}, campaign_draft`)
    .eq("id", id).eq("status", "borrador").eq("publication_mode", "oculta")
    .contains("campaign_draft", { allowed_admin_ids: [actor.id] })
    .is("archived_at", null).maybeSingle();
  if (error) throw error;
  if (!data || !canAccessCasaPolla(data, actor)) return null;
  const draft = parseCasaPrivateDraft(data.campaign_draft);
  if (!draft) return null;
  const { campaign_draft: _metadata, ...polla } = data;
  void _metadata;
  return { polla: { ...polla, private_draft: true, private_draft_motion: Boolean(draft.motion) } as CasaPolla, draft };
}

/** The normal POLLAS screen includes only this admin's explicitly allowed drafts. */
export async function listPrivateCampaignPollas(actor: Actor): Promise<CasaPolla[]> {
  if (!actor?.is_admin) return [];
  const { data, error } = await createAdminClient().from("casa_pollas")
    .select(`${CASA_POLLA_COLUMNS}, campaign_draft`)
    .eq("status", "borrador").eq("publication_mode", "oculta")
    .contains("campaign_draft", { allowed_admin_ids: [actor.id] })
    .is("archived_at", null).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).filter(row => canAccessCasaPolla(row, actor)).map(row => {
    const { campaign_draft: _metadata, ...polla } = row;
    void _metadata;
    return { ...polla, private_draft: true, private_draft_motion: Boolean(parseCasaPrivateDraft(_metadata)?.motion) } as CasaPolla;
  });
}

/** Private fallback for the normal detail page; player APIs keep their public getter. */
export async function getPrivateCampaignBySlug(slug: string, actor: Actor) {
  if (!actor?.is_admin) return null;
  const { data, error } = await createAdminClient().from("casa_pollas")
    .select("id").eq("slug", slug).eq("status", "borrador")
    .eq("publication_mode", "oculta").is("archived_at", null)
    .contains("campaign_draft", { allowed_admin_ids: [actor.id] }).maybeSingle();
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
