// app/api/admin/sentry-health/route.ts — Salud de la app (Sentry) para el admin.
// Admin-only. Read-only contra la API de Sentry, cache 10 min en lib.
import { NextResponse } from "next/server";
import { isCurrentUserAdmin } from "@/lib/auth/admin";
import { getSentryHealth } from "@/lib/sentry/admin-health";

export const runtime = "nodejs";

export async function GET() {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const data = await getSentryHealth();
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "sentry_health_failed" }, { status: 500 });
  }
}
