// lib/types/user.ts — User type with admin flag
// Manual extension until Supabase types are regenerated

export type UserWithAdmin = {
  id: string
  whatsapp_number: string
  display_name: string
  avatar_url: string | null
  avatar_emoji: string | null
  is_admin: boolean
  created_at: string
}
