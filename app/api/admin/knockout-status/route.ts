// app/api/admin/knockout-status/route.ts — Estado de los knockouts del
// Mundial para el dashboard /admin: slots con equipos codificados aún sin
// resolver + alertas operativas (migración 062) + propuestas de cruces
// pendientes de confirmación (migración 064, flujo confirm-before-publish).
//
// GET: pending slots + alertas sin resolver + bracket_proposals pendientes.
// PATCH: marca una alerta como resuelta ({ alertId }).
// POST: decide una propuesta ({ proposalId, action: 'approve' | 'reject' }).
//   approve → apply_bracket_proposal() publica el cruce (UUID intacto).
//   reject  → la propuesta queda rechazada; el slot sigue codificado y solo
//             se re-abre si el proveedor manda equipos distintos.
//
// Auth: solo sesión de admin (isCurrentUserAdmin). No expone CRON path —
// es UI-only.
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCurrentUserAdmin } from "@/lib/auth/admin";
import { hasPlaceholderTeam } from "@/lib/matches/is-placeholder";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  try {
    const admin = createAdminClient();

    const { data: matches } = await admin
      .from("matches")
      .select("id, phase, match_day, home_team, away_team, scheduled_at, status")
      .eq("tournament", "worldcup_2026")
      .eq("status", "scheduled")
      .order("scheduled_at", { ascending: true });

    const pending = (matches ?? []).filter((m) =>
      hasPlaceholderTeam(m.home_team, m.away_team),
    );

    const { data: alerts } = await admin
      .from("admin_alerts")
      .select("id, kind, title, body, created_at")
      .is("resolved_at", null)
      .order("created_at", { ascending: false })
      .limit(20);

    const { data: proposals } = await admin
      .from("bracket_proposals")
      .select(
        "id, match_id, slot_home, slot_away, p_home_team, p_away_team, p_scheduled_at, p_phase, p_match_day, source, fetched_at",
      )
      .eq("status", "pending")
      .order("p_scheduled_at", { ascending: true });

    return NextResponse.json({
      pending,
      alerts: alerts ?? [],
      proposals: proposals ?? [],
    });
  } catch (error) {
    console.error("[knockout-status] Error:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

const postSchema = z.object({
  proposalId: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
});

export async function POST(request: NextRequest) {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }
  try {
    const admin = createAdminClient();
    if (parsed.data.action === "approve") {
      const { data: matchId, error } = await admin.rpc("apply_bracket_proposal", {
        p_proposal_id: parsed.data.proposalId,
      });
      if (error) throw error;
      if (!matchId) {
        return NextResponse.json(
          { error: "La propuesta ya no está pendiente" },
          { status: 409 },
        );
      }
      return NextResponse.json({ ok: true, matchId });
    }
    const { error } = await admin
      .from("bracket_proposals")
      .update({ status: "rejected", decided_at: new Date().toISOString() })
      .eq("id", parsed.data.proposalId)
      .eq("status", "pending");
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[knockout-status] POST error:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

const patchSchema = z.object({ alertId: z.string().uuid() });

export async function PATCH(request: NextRequest) {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "alertId inválido" }, { status: 400 });
  }
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("admin_alerts")
      .update({ resolved_at: new Date().toISOString() })
      .eq("id", parsed.data.alertId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[knockout-status] PATCH error:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
