// app/api/admin/users/[id]/detail/route.ts
//
// GET → vista detallada de un usuario para el admin dashboard:
//   - Profile (whatsapp, email, registro, payout default, etc.)
//   - Últimos 10 login events (ciudad, país, device, método, hora)
//   - Pollas en las que participa (slug, nombre, status, role, puntos, rank)
//   - Stats agregadas (total predicciones, total puntos sumados)
//
// Solo admin global. Read-only.

import { NextResponse } from "next/server";
import { isCurrentUserAdmin } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";

interface Params {
  params: { id: string };
}

interface LoginEventRow {
  created_at: string;
  metadata: {
    method?: string;
    device?: string;
    city?: string;
    country?: string;
    ip?: string;
  } | null;
}

interface ParticipantRow {
  polla_id: string;
  role: string;
  status: string;
  paid: boolean;
  total_points: number;
  rank: number | null;
  joined_at: string;
  pollas: {
    id: string;
    slug: string;
    name: string;
    status: string;
    tournament: string;
  } | null;
}

export async function GET(_request: Request, { params }: Params) {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  const [
    { data: profile },
    { data: loginRows },
    { data: partsRaw },
    { count: predictionsCount },
  ] = await Promise.all([
    admin
      .from("users")
      .select(
        "id, display_name, whatsapp_number, whatsapp_verified, email, avatar_url, avatar_emoji, is_admin, created_at, default_payout_method, default_payout_account, default_payout_account_name, default_payout_account_type, default_payout_set_at",
      )
      .eq("id", params.id)
      .maybeSingle(),
    admin
      .from("notifications")
      .select("created_at, metadata")
      .eq("user_id", params.id)
      .eq("type", "login_event")
      .order("created_at", { ascending: false })
      .limit(10),
    admin
      .from("polla_participants")
      .select(
        "polla_id, role, status, paid, total_points, rank, joined_at, pollas:polla_id (id, slug, name, status, tournament)",
      )
      .eq("user_id", params.id)
      .order("joined_at", { ascending: false }),
    admin
      .from("predictions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", params.id),
  ]);

  if (!profile) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  const events = (loginRows ?? []) as LoginEventRow[];
  const parts = (partsRaw ?? []) as unknown as ParticipantRow[];

  const totalPoints = parts.reduce((s, p) => s + (p.total_points ?? 0), 0);
  const pollas = parts.map((p) => ({
    pollaId: p.polla_id,
    pollaSlug: p.pollas?.slug ?? null,
    pollaName: p.pollas?.name ?? "—",
    pollaStatus: p.pollas?.status ?? "—",
    tournament: p.pollas?.tournament ?? "—",
    role: p.role,
    status: p.status,
    paid: p.paid,
    totalPoints: p.total_points ?? 0,
    rank: p.rank,
    joinedAt: p.joined_at,
  }));

  const logins = events.map((e) => ({
    at: e.created_at,
    method: e.metadata?.method ?? null,
    device: e.metadata?.device ?? null,
    city: e.metadata?.city ?? null,
    country: e.metadata?.country ?? null,
  }));

  return NextResponse.json({
    profile: {
      id: profile.id,
      displayName: profile.display_name,
      whatsapp: profile.whatsapp_number,
      whatsappVerified: profile.whatsapp_verified,
      email: profile.email,
      avatarUrl: profile.avatar_url,
      avatarEmoji: profile.avatar_emoji,
      isAdmin: profile.is_admin,
      createdAt: profile.created_at,
      defaultPayout: {
        method: profile.default_payout_method,
        account: profile.default_payout_account,
        accountName: profile.default_payout_account_name,
        accountType: profile.default_payout_account_type,
        setAt: profile.default_payout_set_at,
      },
    },
    stats: {
      totalPoints,
      pollasCount: parts.length,
      predictionsCount: predictionsCount ?? 0,
    },
    logins,
    pollas,
  });
}
