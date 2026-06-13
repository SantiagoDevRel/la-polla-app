// app/api/admin/engagement/route.ts — Métricas de ENGAGEMENT para el admin
// (Nivel 1: cero instrumentación nueva, agrega sobre data que ya existe).
//
// Complementa /api/admin/analytics (que mide LOGINS). Acá medimos si la gente
// realmente JUEGA: embudo de activación, jugadores activos (pronosticaron),
// pronósticos por día, retención de activación, fill-rate de la bracket, y
// distribuciones.
//
// La agregación se hace EN SQL (RPC admin_engagement, migración 068), no
// trayendo filas: PostgREST topa el result set (~1000 filas) y subcontaba
// `predictions` (cazado en test localhost). El RPC es una sola round-trip,
// sin transferir filas, free-tier intacto.
import { NextResponse } from "next/server";
import { isCurrentUserAdmin } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("admin_engagement");
  if (error) {
    return NextResponse.json({ error: "engagement_failed" }, { status: 500 });
  }
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
