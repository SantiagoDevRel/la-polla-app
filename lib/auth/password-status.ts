import "server-only";
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone, toE164 } from "@/lib/auth/phone";

/** Call with the user verified by auth.getUser(); never accept a caller's identity. */
export async function hasPhonePassword(user: Pick<User, "id" | "phone" | "phone_confirmed_at">): Promise<boolean> {
  const phone = toE164(user.phone);
  if (!phone || !user.phone_confirmed_at) return false;
  const { data, error } = await createAdminClient().from("phone_password_credentials")
    .select("user_id").eq("user_id", user.id).eq("phone_number", normalizePhone(phone)).maybeSingle();
  if (error) throw new Error("Password status unavailable");
  return Boolean(data);
}
