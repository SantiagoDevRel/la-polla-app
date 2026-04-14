// app/api/pollas/draft-status/route.ts — Consultado por /pollas/payment-success
// para saber si el webhook de Wompi ya creó la polla desde el draft.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const reference = request.nextUrl.searchParams.get("reference");
  if (!reference) {
    return NextResponse.json({ error: "reference requerido" }, { status: 400 });
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: draft } = await admin
    .from("polla_drafts")
    .select("creator_id, completed_polla_slug, expires_at")
    .eq("reference", reference)
    .maybeSingle();

  if (!draft) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  if (draft.creator_id !== user.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  if (draft.completed_polla_slug) {
    return NextResponse.json({ status: "completed", slug: draft.completed_polla_slug });
  }

  if (new Date(draft.expires_at) < new Date()) {
    return NextResponse.json({ status: "expired" });
  }

  return NextResponse.json({ status: "pending" });
}
