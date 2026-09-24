import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAccessCasaPolla, parseCasaPrivateDraft } from "./private-drafts";

type Actor = { id: string; is_admin: boolean } | null;

/** Always authorize before reading campaign content with the service key. */
export async function getPrivateCampaign(id: string, actor: Actor) {
  if (!actor?.is_admin || !z.string().uuid().safeParse(id).success) return null;
  const { data, error } = await createAdminClient().from("casa_pollas")
    .select("id, name, description, entry_price_cop, prize_object, campaign_draft")
    .eq("id", id).eq("status", "borrador").eq("publication_mode", "oculta")
    .contains("campaign_draft", { allowed_admin_ids: [actor.id] })
    .is("archived_at", null).maybeSingle();
  if (error) throw error;
  if (!data || !canAccessCasaPolla(data, actor)) return null;
  const draft = parseCasaPrivateDraft(data.campaign_draft);
  if (!draft) return null;
  const polla = { id: data.id, name: data.name, description: data.description,
    entry_price_cop: data.entry_price_cop, prize_object: data.prize_object };
  return { polla, draft };
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
