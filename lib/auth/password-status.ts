import "server-only";
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone, toE164 } from "@/lib/auth/phone";

/** Call with the user verified by auth.getUser(); never accept a caller's identity. */
export async function readPhonePasswordState(user: Pick<User, "id" | "phone" | "phone_confirmed_at">): Promise<{ hasPassword: boolean; revision: number }> {
  const phone = toE164(user.phone);
  if (!phone || !user.phone_confirmed_at) return { hasPassword: false, revision: 0 };
  const { data, error } = await createAdminClient().from("phone_password_credentials")
    .select("phone_number, credential_revision").eq("user_id", user.id).maybeSingle();
  if (error) throw new Error("Password status unavailable");
  if (!data) return { hasPassword: false, revision: 0 };
  if (!Number.isSafeInteger(data.credential_revision) || data.credential_revision < 0) throw new Error("Password revision unavailable");
  return { hasPassword: data.phone_number === normalizePhone(phone), revision: data.credential_revision };
}

export async function hasPhonePassword(user: Pick<User, "id" | "phone" | "phone_confirmed_at">): Promise<boolean> {
  return (await readPhonePasswordState(user)).hasPassword;
}
