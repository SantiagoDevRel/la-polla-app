// app/api/admin/sync-worldcup/route.ts — Sync del fixture del Mundial 2026
// desde openfootball. Autenticación dual: sesión de admin o CRON_SECRET.
import { NextRequest, NextResponse } from "next/server";
import { syncWorldCup2026 } from "@/lib/api-football/sync-worldcup";
import { isCurrentUserAdmin } from "@/lib/auth/admin";

export async function POST(request: NextRequest) {
  const adminCheck = await isCurrentUserAdmin();
  const cronSecret =
    request.headers.get("x-cron-secret") || request.nextUrl.searchParams.get("secret");
  const validCronSecret =
    !!process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET;

  if (!adminCheck && !validCronSecret) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const result = await syncWorldCup2026();
    return NextResponse.json({
      synced: result.synced,
      fetched: result.fetched,
      skipped: result.skipped,
      errors: result.errors,
    });
  } catch (error) {
    console.error("[sync-worldcup] Error:", error);
    const msg = error instanceof Error ? error.message : "Error en sync";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
