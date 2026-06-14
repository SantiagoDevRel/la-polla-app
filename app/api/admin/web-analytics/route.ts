// app/api/admin/web-analytics/route.ts — Tráfico/comportamiento desde PostHog
// para el admin. Admin-only. Datos: visitantes anónimos, top páginas,
// dispositivo, web vitals — lo que la DB no ve. Cache 5 min en lib (free-tier).
import { NextResponse } from "next/server";
import { isCurrentUserAdmin } from "@/lib/auth/admin";
import { getWebAnalytics } from "@/lib/posthog/admin-insights";

export const runtime = "nodejs";

export async function GET() {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const data = await getWebAnalytics();
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "web_analytics_failed" }, { status: 500 });
  }
}
