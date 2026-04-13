// app/api/admin/summary/route.ts — Admin dashboard summary data.
// Returns counts + full user/polla lists. Admin-only.
import { NextResponse } from "next/server";
import { isCurrentUserAdmin } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const admin = createAdminClient();

  const [usersCount, pollasCount, predictionsCount, matchesCount, users, pollas] =
    await Promise.all([
      admin.from("users").select("id", { count: "exact", head: true }),
      admin.from("pollas").select("id", { count: "exact", head: true }),
      admin.from("predictions").select("id", { count: "exact", head: true }),
      admin.from("matches").select("id", { count: "exact", head: true }),
      admin
        .from("users")
        .select("id, display_name, whatsapp_number, is_admin, created_at")
        .order("created_at", { ascending: false }),
      admin
        .from("pollas")
        .select("id, name, tournament, status, created_at")
        .order("created_at", { ascending: false }),
    ]);

  return NextResponse.json({
    stats: {
      users: usersCount.count ?? 0,
      pollas: pollasCount.count ?? 0,
      predictions: predictionsCount.count ?? 0,
      matches: matchesCount.count ?? 0,
    },
    users: users.data ?? [],
    pollas: pollas.data ?? [],
  });
}
