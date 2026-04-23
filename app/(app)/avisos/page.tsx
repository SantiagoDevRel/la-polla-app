// app/(app)/avisos/page.tsx — Real Avisos feed
//
// Server component. Loads the authenticated user's notifications via the
// admin client (auth.uid()=NULL workaround) and hands off to AvisosList
// for tabs + optimistic mark-as-read. Metadata keeps this dynamic so
// unread counts never stale between /inicio round-trips.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AvisosList, type AvisoItem } from "@/components/avisos/AvisosList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Avisos · La Polla" };

export default async function AvisosPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: viewerRow } = await admin
    .from("users")
    .select("display_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  const viewerName =
    (viewerRow?.display_name || "").split(" ")[0] || "Vos";
  const viewerPollito = viewerRow?.avatar_url ?? null;

  const { data: notifRows } = await admin
    .from("notifications")
    .select(
      "id, type, title, body, polla_id, match_id, actor_user_id, metadata, read_at, created_at",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = (notifRows || []) as Array<
    Omit<AvisoItem, "polla" | "actor">
  >;

  const pollaIds = Array.from(
    new Set(rows.map((n) => n.polla_id).filter(Boolean) as string[]),
  );
  const actorIds = Array.from(
    new Set(rows.map((n) => n.actor_user_id).filter(Boolean) as string[]),
  );

  const [pollasRes, usersRes, unreadRes] = await Promise.all([
    pollaIds.length > 0
      ? admin.from("pollas").select("id, slug, name").in("id", pollaIds)
      : Promise.resolve({ data: [] as Array<{ id: string; slug: string; name: string }> }),
    actorIds.length > 0
      ? admin.from("users").select("id, display_name, avatar_url").in("id", actorIds)
      : Promise.resolve({
          data: [] as Array<{ id: string; display_name: string | null; avatar_url: string | null }>,
        }),
    admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null),
  ]);

  const pollasById = new Map((pollasRes.data || []).map((p) => [p.id, p]));
  const usersById = new Map((usersRes.data || []).map((u) => [u.id, u]));

  const items: AvisoItem[] = rows.map((n) => ({
    ...n,
    polla: n.polla_id ? pollasById.get(n.polla_id) ?? null : null,
    actor: n.actor_user_id ? usersById.get(n.actor_user_id) ?? null : null,
  }));

  const unread = unreadRes.count ?? 0;

  return (
    <main className="min-h-[100dvh] px-4 pt-8 pb-24">
      <AvisosList
        initialItems={items}
        initialUnread={unread}
        viewer={{ name: viewerName, pollito: viewerPollito }}
      />
    </main>
  );
}
