// app/api/cron/admin-discrepancies-email/route.ts — Email diario al admin
// con resumen de discrepancias activas (matches sin verify + pollas con
// problemas). Solo manda si hay items que reportar.
//
// Auth: header Authorization: Bearer ${CRON_SECRET}.
// Trigger: GitHub Actions cada día (horario configurado en el workflow).
//
// Destinatario: ADMIN_ALERT_EMAIL (env var).

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { collectPollaHealth } from "@/app/api/admin/polla-health/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const to = process.env.ADMIN_ALERT_EMAIL;
  if (!to) {
    return NextResponse.json(
      { error: "ADMIN_ALERT_EMAIL not configured" },
      { status: 500 },
    );
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "RESEND_API_KEY not configured" },
      { status: 500 },
    );
  }

  // 1. Polla health (trabadas + ended-sin-payouts).
  const { stuckPollas, endedNoPayouts } = await collectPollaHealth();

  // 2. Match discrepancies (finished sin final_verified_at, con predictions).
  const admin = createAdminClient();
  const { count: matchDiscrepancies } = await admin
    .from("matches")
    .select("id, predictions!inner(id)", { count: "exact", head: true })
    .eq("status", "finished")
    .is("final_verified_at", null);

  const total =
    stuckPollas.length + endedNoPayouts.length + (matchDiscrepancies ?? 0);

  if (total === 0) {
    return NextResponse.json({ ok: true, sent: false, reason: "no items" });
  }

  const lines: string[] = [
    `La Polla — resumen de discrepancias del día`,
    `Total de items: ${total}`,
    "",
  ];
  if (stuckPollas.length > 0) {
    lines.push(`Pollas trabadas (active con matches terminales): ${stuckPollas.length}`);
    for (const p of stuckPollas) {
      lines.push(`  • ${p.name} (${p.slug}) — ${p.participantCount} participantes pagados`);
    }
    lines.push("");
  }
  if (endedNoPayouts.length > 0) {
    lines.push(`Pollas ended sin payouts materializados: ${endedNoPayouts.length}`);
    for (const p of endedNoPayouts) {
      lines.push(`  • ${p.name} (${p.slug}) — ${p.paymentMode}, ${p.participantCount} participantes`);
    }
    lines.push("");
  }
  if ((matchDiscrepancies ?? 0) > 0) {
    lines.push(`Discrepancias de scores ESPN/football-data: ${matchDiscrepancies}`);
    lines.push("");
  }
  lines.push(`Resolverlas en: https://lapollacolombiana.com/admin/discrepancias`);

  const text = lines.join("\n");
  const subject = `[La Polla] ${total} discrepancia${total === 1 ? "" : "s"} pendiente${total === 1 ? "" : "s"}`;

  const resend = new Resend(apiKey);
  const from = process.env.RESEND_FROM_EMAIL || "La Polla <onboarding@resend.dev>";
  await resend.emails.send({ from, to, subject, text });

  return NextResponse.json({
    ok: true,
    sent: true,
    counts: {
      stuckPollas: stuckPollas.length,
      endedNoPayouts: endedNoPayouts.length,
      matchDiscrepancies: matchDiscrepancies ?? 0,
    },
  });
}
