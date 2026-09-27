import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  const headers = { "Cache-Control": "private, no-store" };
  if (!user?.is_admin) return NextResponse.json({ error: "No autorizado" }, { status: user ? 403 : 401, headers });
  const enabled = request.nextUrl.searchParams.get("enabled") !== "false";
  const page = Number(request.nextUrl.searchParams.get("page") ?? "0");
  if (!Number.isInteger(page) || page < 0 || page > 10000) return new NextResponse(null, { status: 400, headers });
  const { data, count, error } = await createAdminClient().from("wa_marketing_preferences")
    .select("phone, enabled, source, changed_at", { count: "exact" }).eq("enabled", enabled)
    .order("changed_at", { ascending: false }).order("phone").range(page * 25, page * 25 + 24);
  if (error) return NextResponse.json({ error: "No se pudo consultar la lista." }, { status: 503, headers });
  return NextResponse.json({ recipients: data, total: count ?? 0, page }, { headers });
}
