// app/api/pollas/preview/route.ts — Public, unauthenticated polla preview.
// Used by /unirse/[slug] and the login page (when returnTo points at a polla)
// to render a preview card before the user signs in.
//
// Query: ?slug=<slug>  OR  ?token=<invite_token>
// Returns: { polla: { slug, name, tournament, buy_in_amount, type, description }, participantCount }
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug");
  const token = request.nextUrl.searchParams.get("token");
  if (!slug && !token) {
    return NextResponse.json({ error: "slug o token requerido" }, { status: 400 });
  }

  const admin = createAdminClient();
  const query = admin
    .from("pollas")
    .select("id, slug, name, description, tournament, buy_in_amount, type, status");
  const { data: polla, error } = slug
    ? await query.eq("slug", slug).maybeSingle()
    : await query.eq("invite_token", token!).maybeSingle();

  if (error) {
    console.error("[pollas/preview] failed:", error);
    return NextResponse.json({ error: "Error consultando polla" }, { status: 500 });
  }
  if (!polla || polla.status !== "active") {
    return NextResponse.json({ error: "Polla no encontrada" }, { status: 404 });
  }

  // Count approved participants. Use select("*", head:true) — the safest form
  // for PostgREST count headers; some versions don't surface the count when
  // the projected column list is restrictive.
  const { count, error: countError } = await admin
    .from("polla_participants")
    .select("*", { head: true, count: "exact" })
    .eq("polla_id", polla.id)
    .eq("status", "approved");

  if (countError) {
    console.error("[pollas/preview] participant count failed:", countError);
  }

  // Strip internal id from the response.
  const { id: _id, ...publicPolla } = polla;
  void _id;
  return NextResponse.json({
    polla: publicPolla,
    participantCount: count ?? 0,
  });
}
