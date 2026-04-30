// app/api/admin/claude-usage/route.ts
//
// GET → resumen de uso de Anthropic API:
//   - mtdTotal: calls + tokens + costo del mes en curso
//   - byUser:   top 10 spenders del mes (display_name, calls, costo)
//   - byEndpoint: breakdown por endpoint
//   - last24h:  alertas de abuso (users con > 10 uploads en 24h)
//   - recent:   últimas 20 calls para debugging
//
// Solo admin. La tabla claude_api_usage es service-role only y
// nuestra createAdminClient() bypassa RLS; esta es la única ruta que
// la expone.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCurrentUserAdmin } from "@/lib/auth/admin";

interface UsageRow {
  id: string;
  user_id: string | null;
  polla_id: string | null;
  endpoint: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  image_bytes: number | null;
  cost_usd: number | string;
  success: boolean;
  error_message: string | null;
  created_at: string;
}

interface UserDisplayRow {
  id: string;
  display_name: string | null;
}

const SUSPICIOUS_DAILY_THRESHOLD = 10;

export async function GET() {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Mes en curso (UTC). Suficientemente preciso para cost tracking.
  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const last24hStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const [{ data: mtdRows }, { data: last24hRows }, { data: recentRows }] = await Promise.all([
    admin
      .from("claude_api_usage")
      .select("id, user_id, polla_id, endpoint, model, tokens_in, tokens_out, image_bytes, cost_usd, success, error_message, created_at")
      .gte("created_at", startOfMonth),
    admin
      .from("claude_api_usage")
      .select("user_id, created_at, success")
      .gte("created_at", last24hStart),
    admin
      .from("claude_api_usage")
      .select("id, user_id, polla_id, endpoint, model, tokens_in, tokens_out, image_bytes, cost_usd, success, error_message, created_at")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const mtd = (mtdRows ?? []) as UsageRow[];
  const last24h = (last24hRows ?? []) as Array<Pick<UsageRow, "user_id" | "created_at" | "success">>;
  const recent = (recentRows ?? []) as UsageRow[];

  const totalCost = mtd.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
  const totalTokensIn = mtd.reduce((s, r) => s + (r.tokens_in ?? 0), 0);
  const totalTokensOut = mtd.reduce((s, r) => s + (r.tokens_out ?? 0), 0);
  const totalCalls = mtd.length;
  const totalErrors = mtd.filter((r) => !r.success).length;

  // By user (MTD)
  const byUserMap = new Map<string, { calls: number; cost: number; tokensIn: number; tokensOut: number }>();
  for (const r of mtd) {
    const k = r.user_id ?? "anon";
    const cur = byUserMap.get(k) ?? { calls: 0, cost: 0, tokensIn: 0, tokensOut: 0 };
    cur.calls += 1;
    cur.cost += Number(r.cost_usd ?? 0);
    cur.tokensIn += r.tokens_in ?? 0;
    cur.tokensOut += r.tokens_out ?? 0;
    byUserMap.set(k, cur);
  }

  // Resolver display_names en una sola query.
  const userIds = Array.from(byUserMap.keys()).filter((k) => k !== "anon");
  const userById = new Map<string, string | null>();
  if (userIds.length > 0) {
    const { data: usersData } = await admin
      .from("users")
      .select("id, display_name")
      .in("id", userIds);
    for (const u of (usersData ?? []) as UserDisplayRow[]) {
      userById.set(u.id, u.display_name);
    }
  }

  const byUser = Array.from(byUserMap.entries())
    .map(([userId, v]) => ({
      userId: userId === "anon" ? null : userId,
      displayName: userId === "anon" ? "(sin user)" : (userById.get(userId) ?? "(?)"),
      calls: v.calls,
      cost: Number(v.cost.toFixed(4)),
      tokensIn: v.tokensIn,
      tokensOut: v.tokensOut,
    }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 10);

  // By endpoint
  const byEndpointMap = new Map<string, { calls: number; cost: number }>();
  for (const r of mtd) {
    const cur = byEndpointMap.get(r.endpoint) ?? { calls: 0, cost: 0 };
    cur.calls += 1;
    cur.cost += Number(r.cost_usd ?? 0);
    byEndpointMap.set(r.endpoint, cur);
  }
  const byEndpoint = Array.from(byEndpointMap.entries()).map(([endpoint, v]) => ({
    endpoint,
    calls: v.calls,
    cost: Number(v.cost.toFixed(4)),
  }));

  // Suspicious users (last 24h, > threshold uploads)
  const dailyByUser = new Map<string, number>();
  for (const r of last24h) {
    if (!r.user_id) continue;
    dailyByUser.set(r.user_id, (dailyByUser.get(r.user_id) ?? 0) + 1);
  }
  const suspicious = Array.from(dailyByUser.entries())
    .filter(([, count]) => count > SUSPICIOUS_DAILY_THRESHOLD)
    .map(([userId, count]) => ({
      userId,
      displayName: userById.get(userId) ?? "(?)",
      count24h: count,
    }))
    .sort((a, b) => b.count24h - a.count24h);

  return NextResponse.json({
    mtdTotal: {
      calls: totalCalls,
      errors: totalErrors,
      tokensIn: totalTokensIn,
      tokensOut: totalTokensOut,
      costUSD: Number(totalCost.toFixed(4)),
    },
    byUser,
    byEndpoint,
    suspicious,
    suspiciousThreshold: SUSPICIOUS_DAILY_THRESHOLD,
    recent: recent.map((r) => ({
      id: r.id,
      userId: r.user_id,
      displayName: r.user_id ? (userById.get(r.user_id) ?? null) : null,
      endpoint: r.endpoint,
      tokensIn: r.tokens_in,
      tokensOut: r.tokens_out,
      costUSD: Number(r.cost_usd ?? 0),
      success: r.success,
      errorMessage: r.error_message,
      createdAt: r.created_at,
    })),
  });
}
