// lib/auth/admin.ts — Server-side admin verification utilities
// Never import this in client components

import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import type { UserWithAdmin } from "@/lib/types/user"

/**
 * Returns the current authenticated user's profile including is_admin.
 * Returns null if unauthenticated.
 */
export async function getAuthenticatedUser(): Promise<UserWithAdmin | null> {
  const supabase = createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) return null

  const adminClient = createAdminClient()
  const { data: profile } = await adminClient
    .from("users")
    .select(
      "id, whatsapp_number, display_name, avatar_url, avatar_emoji, is_admin, created_at"
    )
    .eq("id", user.id)
    .single()

  return (profile as UserWithAdmin) ?? null
}

/**
 * Returns true only if the current session belongs to an admin user.
 */
export async function isCurrentUserAdmin(): Promise<boolean> {
  const user = await getAuthenticatedUser()
  return user?.is_admin === true
}
