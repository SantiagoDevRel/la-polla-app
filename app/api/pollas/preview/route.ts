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
    .select(
      "id, slug, name, description, tournament, buy_in_amount, type, status, created_by, match_ids, payment_mode, admin_payment_instructions"
    );
  const { data: polla, error } = slug
    ? await query.eq("slug", slug).maybeSingle()
    : await query.eq("invite_token", token!).maybeSingle();

  if (error) {
    console.error("[pollas/preview] failed:", error);
    return NextResponse.json({ error: "Error consultando polla" }, { status: 500 });
  }
  if (!polla) {
    return NextResponse.json({ error: "Polla no encontrada" }, { status: 404 });
  }

  // Count paid+approved participants. The invite preview uses this for the
  // Participantes badge and the pozo math, so unpaid joiners (awaiting
  // admin approval or Wompi confirmation) must not inflate either. Admin
  // themselves are paid=true on creation so they count from day one.
  const { count, error: countError } = await admin
    .from("polla_participants")
    .select("*", { head: true, count: "exact" })
    .eq("polla_id", polla.id)
    .eq("status", "approved")
    .eq("paid", true);

  if (countError) {
    console.error("[pollas/preview] participant count failed:", countError);
  }

  // Organizer display name + avatar. The client cannot read this directly
  // for logged-out visitors because users_select_own RLS restricts SELECTs
  // to the caller's own row. We expose ONLY display_name and avatar_url
  // (no email, no phone) via admin client to keep the preview complete.
  const { data: organizerRow } = await admin
    .from("users")
    .select("display_name, avatar_url")
    .eq("id", polla.created_by)
    .maybeSingle();
  const organizer = organizerRow
    ? {
        display_name: organizerRow.display_name ?? null,
        avatar_url: organizerRow.avatar_url ?? null,
      }
    : null;

  // Strip created_by from the response. The polla id is kept because the
  // invite preview page needs it for downstream calls (membership check,
  // matches fetch); it is not a sensitive field since the polla is
  // already addressable by slug and invite_token publicly.
  const { created_by: _createdBy, ...publicPolla } = polla;
  void _createdBy;
  return NextResponse.json({
    polla: publicPolla,
    participantCount: count ?? 0,
    organizer,
  });
}
