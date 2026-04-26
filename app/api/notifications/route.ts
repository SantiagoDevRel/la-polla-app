// app/api/notifications/route.ts — Avisos feed + mark-as-read
//
// GET:  returns the current user's notifications (newest first). Optional
//       `?type=` filter narrows to a single event type. Optional
//       `?unread=1` narrows to unread only. Caps at 100 rows.
// POST: marks notifications as read. Body either { id } (single) or
//       { all: true } (bulk, everything unread). Response returns the
//       remaining unread count so the caller can update the badge.
//
// Uses the admin client for reads + writes with explicit user_id filters,
// matching the pattern in /api/pollas that works around the auth.uid()
// NULL propagation issue flagged in CLAUDE.md.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const NOTIFICATION_TYPES = [
  "rank_up",
  "rank_down",
  "perfect_pick",
  "last_place",
  "polla_finished",
  "polla_started",
  "login_event",
] as const;

type NotificationType = (typeof NOTIFICATION_TYPES)[number];

function isNotificationType(v: string): v is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(v);
}

export async function GET(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const url = new URL(request.url);
  const typeParam = url.searchParams.get("type");
  const unreadOnly = url.searchParams.get("unread") === "1";

  const admin = createAdminClient();
  let query = admin
    .from("notifications")
    .select(
      "id, type, title, body, polla_id, match_id, actor_user_id, metadata, read_at, created_at",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (typeParam && isNotificationType(typeParam)) {
    query = query.eq("type", typeParam);
  }
  if (unreadOnly) {
    query = query.is("read_at", null);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Hydrate context: polla slug/name for links, actor display_name.
  const pollaIds = Array.from(
    new Set((data || []).map((n) => n.polla_id).filter(Boolean) as string[]),
  );
  const actorIds = Array.from(
    new Set((data || []).map((n) => n.actor_user_id).filter(Boolean) as string[]),
  );

  const [pollasRes, usersRes] = await Promise.all([
    pollaIds.length > 0
      ? admin.from("pollas").select("id, slug, name").in("id", pollaIds)
      : Promise.resolve({ data: [] as Array<{ id: string; slug: string; name: string }> }),
    actorIds.length > 0
      ? admin.from("users").select("id, display_name, avatar_url").in("id", actorIds)
      : Promise.resolve({
          data: [] as Array<{ id: string; display_name: string | null; avatar_url: string | null }>,
        }),
  ]);

  const pollasById = new Map((pollasRes.data || []).map((p) => [p.id, p]));
  const usersById = new Map((usersRes.data || []).map((u) => [u.id, u]));

  const items = (data || []).map((n) => ({
    ...n,
    polla: n.polla_id ? pollasById.get(n.polla_id) ?? null : null,
    actor: n.actor_user_id ? usersById.get(n.actor_user_id) ?? null : null,
  }));

  const { count: unreadCount } = await admin
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("read_at", null);

  return NextResponse.json({ items, unread: unreadCount ?? 0 });
}

const markReadSchema = z.union([
  z.object({ id: z.string().uuid() }),
  z.object({ all: z.literal(true) }),
]);

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = markReadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  const admin = createAdminClient();
  const update = admin
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null);

  const { error } =
    "all" in parsed.data ? await update : await update.eq("id", parsed.data.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { count: unread } = await admin
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("read_at", null);

  return NextResponse.json({ unread: unread ?? 0 });
}
