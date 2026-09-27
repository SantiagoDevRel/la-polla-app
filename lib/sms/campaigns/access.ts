import { getAuthenticatedUser } from "@/lib/auth/admin";

/** Private deployment config pins the verified account, never a name or client input. */
export function isSmsOwner(user: { id: string; is_admin: boolean } | null, ownerId = process.env.SMS_CAMPAIGN_OWNER_ID) {
  return !!ownerId && user?.is_admin === true && user.id === ownerId;
}

export async function getSmsOwner() {
  const user = await getAuthenticatedUser();
  return isSmsOwner(user) ? user : null;
}
