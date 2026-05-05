// app/api/admin/wa-template-usage/route.ts — MTD stats de template
// messages enviados desde el bot. Alimenta el card "WhatsApp templates"
// del admin dashboard. Auth: admin only.

import { NextResponse } from "next/server";
import { isCurrentUserAdmin } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Inicio del mes actual UTC
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const { data: rows, error } = await admin
    .from("wa_template_sends")
    .select("template_name, status, cost_usd, category, created_at")
    .gte("created_at", monthStart.toISOString());

  if (error) {
    return NextResponse.json(
      { error: "query failed", detail: error.message },
      { status: 500 },
    );
  }

  let totalSends = 0;
  let totalSent = 0;
  let totalFailed = 0;
  let totalCostUsd = 0;
  const byTemplate: Record<
    string,
    { sent: number; failed: number; cost_usd: number; category: string }
  > = {};

  for (const r of rows ?? []) {
    totalSends++;
    if (r.status === "sent") totalSent++;
    else if (r.status === "failed") totalFailed++;
    totalCostUsd += Number(r.cost_usd ?? 0);

    if (!byTemplate[r.template_name]) {
      byTemplate[r.template_name] = {
        sent: 0,
        failed: 0,
        cost_usd: 0,
        category: r.category ?? "utility",
      };
    }
    if (r.status === "sent") byTemplate[r.template_name].sent++;
    else if (r.status === "failed") byTemplate[r.template_name].failed++;
    byTemplate[r.template_name].cost_usd += Number(r.cost_usd ?? 0);
  }

  // Last run timestamp (per template) para mostrar "ultimo envio" en el card
  const { data: lastRows } = await admin
    .from("wa_template_sends")
    .select("template_name, created_at")
    .order("created_at", { ascending: false })
    .limit(1);

  return NextResponse.json({
    mtd: {
      total_sends: totalSends,
      total_sent: totalSent,
      total_failed: totalFailed,
      cost_usd: Math.round(totalCostUsd * 10000) / 10000,
      period_start: monthStart.toISOString(),
    },
    by_template: byTemplate,
    last_send_at: lastRows?.[0]?.created_at ?? null,
  });
}
