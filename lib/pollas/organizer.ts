// lib/pollas/organizer.ts — who may administer a P2P polla.
//
// Authority is pollas.created_by, never polla_participants.role. The role
// column lives in a row a client could once write (security audit
// 2026-11-07, S1: a signed-in user could self-insert role='admin'), so it is
// display data only. In production every role='admin' row belongs to the
// polla's creator (read-only check 2026-11-08: 60 of 60), so this keeps
// every existing organizer exactly as before.
//
// Global admins (users.is_admin) keep whatever each route already gave them
// (for example the read-only payments view); this helper does not widen it.

export type PollaOwnership = { created_by: string | null };

export function isPollaOrganizer(
  polla: PollaOwnership | null | undefined,
  userId: string | null | undefined,
): boolean {
  return Boolean(polla?.created_by && userId && polla.created_by === userId);
}
