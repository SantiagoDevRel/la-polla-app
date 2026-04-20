// app/api/pollas/[slug]/membership/route.ts — Check if the caller is already
// a participant of the given polla. Returns { member: boolean, slug: string }.
//
// Exists because the RLS policy "participants_select" on polla_participants
// evaluates a recursive EXISTS against the same table, which returns empty
// rows under the browser client even for the caller's own membership. This
// route uses the admin client after validating the user session, sidestepping
// the RLS footgun without loosening policies. Used by the invite preview page
// to decide between the full preview and the "ya estás en esta polla" card.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _request: Request,
  { params }: { params: { slug: string } }
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ member: false, slug: params.slug });
  }

  const admin = createAdminClient();
  const { data: polla } = await admin
    .from("pollas")
    .select("id")
    .eq("slug", params.slug)
    .maybeSingle();
  if (!polla) {
    return NextResponse.json({ member: false, slug: params.slug });
  }

  const { data: existing } = await admin
    .from("polla_participants")
    .select("id")
    .eq("polla_id", polla.id)
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json({ member: !!existing, slug: params.slug });
}
