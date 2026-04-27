// app/api/admin/analytics/route.ts — Aggregates user-behavior signals
// for the admin dashboard. Source of truth: the `notifications` table,
// where every login (otp/password) lands as a row of type='login_event'
// with metadata { method, device, city, country, ip, user_agent }.
//
// Returns a single payload so the dashboard renders in one round-trip.
import { NextResponse } from "next/server";
import { isCurrentUserAdmin } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

interface LoginEventRow {
  user_id: string;
  created_at: string;
  metadata: {
    method?: "otp" | "password";
    device?: string;
    city?: string;
    country?: string;
  } | null;
}

interface UserRow {
  id: string;
  created_at: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function topN(map: Record<string, number>, n: number): Array<{ key: string; count: number }> {
  return Object.entries(map)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

export async function GET() {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const now = Date.now();
  const since30d = new Date(now - 30 * DAY_MS).toISOString();
  const since14d = new Date(now - 14 * DAY_MS).toISOString();
  const since7d = new Date(now - 7 * DAY_MS).toISOString();

  // Pull last 30 days of login events. For ~thousands of users this
  // stays well under the 1k row default cap; if it grows, paginate or
  // pre-aggregate. We limit to 5000 rows defensively.
  const { data: loginRows, error: loginErr } = await admin
    .from("notifications")
    .select("user_id, created_at, metadata")
    .eq("type", "login_event")
    .gte("created_at", since30d)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (loginErr) {
    console.error("[analytics] login query failed:", loginErr);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }

  const events = (loginRows ?? []) as LoginEventRow[];

  // New users: pull last 14 days of public.users.created_at for the
  // signup chart. Joining/aggregating per day on the client side.
  const { data: newUserRows, error: newUserErr } = await admin
    .from("users")
    .select("id, created_at")
    .gte("created_at", since14d)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (newUserErr) {
    console.error("[analytics] new users query failed:", newUserErr);
  }

  const newUsers = (newUserRows ?? []) as UserRow[];

  // Total user count via head:true count to avoid pulling rows.
  const { count: totalUsers } = await admin
    .from("users")
    .select("*", { count: "exact", head: true });

  // ─── Aggregations ───
  const logins7d = events.filter(e => e.created_at >= since7d).length;
  const logins30d = events.length;

  const activeUsers7d = new Set(
    events.filter(e => e.created_at >= since7d).map(e => e.user_id),
  ).size;
  const activeUsers30d = new Set(events.map(e => e.user_id)).size;

  const cityCounts: Record<string, number> = {};
  const countryCounts: Record<string, number> = {};
  const deviceCounts: Record<string, number> = {};
  const methodCounts: Record<string, number> = { otp: 0, password: 0 };
  const loginsByDay: Record<string, number> = {};
  const loginsByHour: number[] = Array(24).fill(0);

  for (const e of events) {
    const meta = e.metadata ?? {};
    if (meta.city) cityCounts[meta.city] = (cityCounts[meta.city] ?? 0) + 1;
    if (meta.country) countryCounts[meta.country] = (countryCounts[meta.country] ?? 0) + 1;
    if (meta.device) deviceCounts[meta.device] = (deviceCounts[meta.device] ?? 0) + 1;
    if (meta.method === "otp" || meta.method === "password") {
      methodCounts[meta.method]++;
    }
    const day = e.created_at.slice(0, 10);
    loginsByDay[day] = (loginsByDay[day] ?? 0) + 1;
    const hour = new Date(e.created_at).getHours();
    loginsByHour[hour]++;
  }

  // Build a 14-day series for signups + logins (fill zeros for empty days).
  const days: string[] = [];
  for (let i = 13; i >= 0; i--) {
    days.push(new Date(now - i * DAY_MS).toISOString().slice(0, 10));
  }
  const signupsByDay: Record<string, number> = {};
  for (const u of newUsers) {
    const day = u.created_at.slice(0, 10);
    signupsByDay[day] = (signupsByDay[day] ?? 0) + 1;
  }
  const series = days.map(day => ({
    day,
    logins: loginsByDay[day] ?? 0,
    signups: signupsByDay[day] ?? 0,
  }));

  return NextResponse.json({
    totals: {
      users: totalUsers ?? 0,
      logins_7d: logins7d,
      logins_30d: logins30d,
      active_users_7d: activeUsers7d,
      active_users_30d: activeUsers30d,
      new_users_14d: newUsers.length,
    },
    series, // [{ day: 'YYYY-MM-DD', logins, signups }]
    top_cities: topN(cityCounts, 10),
    top_countries: topN(countryCounts, 10),
    top_devices: topN(deviceCounts, 10),
    methods: methodCounts,
    logins_by_hour: loginsByHour, // index = hour 0..23
    period_days: 30,
  });
}
