import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone, toE164 } from "@/lib/auth/phone";

type Db = ReturnType<typeof createAdminClient>;
export async function marketingAllowed(db: Db, rawPhone: string): Promise<boolean> {
  if (!toE164(rawPhone)) return false;
  const { data, error } = await db.from("wa_marketing_preferences")
    .select("enabled").eq("phone", normalizePhone(rawPhone)).maybeSingle();
  if (error) throw new Error("Could not read WhatsApp consent");
  return data?.enabled === true;
}

export async function setMarketingPreference(db: Db, input: {
  phone: string; enabled: boolean; source: "profile" | "whatsapp";
  eventId: string; occurredAt?: string;
}): Promise<{ enabled: boolean; current: boolean; replySent: boolean }> {
  if (!toE164(input.phone)) throw new Error("Invalid phone");
  const { data, error } = await db.rpc("wa_set_marketing_preference", {
    p_phone: normalizePhone(input.phone), p_enabled: input.enabled,
    p_source: input.source, p_event_id: input.eventId,
    p_occurred_at: input.occurredAt ?? null,
  });
  if (error || !data || typeof data.enabled !== "boolean") throw new Error("Could not save WhatsApp consent");
  return data;
}
