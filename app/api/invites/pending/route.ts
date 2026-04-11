// app/api/invites/pending/route.ts — Get pending invites for the current user
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const admin = createAdminClient();

    // Get user's whatsapp_number
    const { data: profile } = await admin
      .from("users")
      .select("whatsapp_number")
      .eq("id", user.id)
      .single();

    if (!profile?.whatsapp_number) {
      return NextResponse.json({ invites: [] });
    }

    // Get pending invites for this phone number
    const { data: invites } = await admin
      .from("polla_invites")
      .select(
        `
        id,
        token,
        status,
        expires_at,
        polla_id,
        invited_by
      `
      )
      .eq("whatsapp_number", profile.whatsapp_number)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString());

    if (!invites || invites.length === 0) {
      return NextResponse.json({ invites: [] });
    }

    // Get polla details
    const pollaIds = invites.map((i) => i.polla_id);
    const { data: pollas } = await admin
      .from("pollas")
      .select("id, name, slug, tournament")
      .in("id", pollaIds);

    // Get inviter names
    const inviterIds = Array.from(new Set(invites.map((i) => i.invited_by)));
    const { data: inviters } = await admin
      .from("users")
      .select("id, display_name")
      .in("id", inviterIds);

    const pollaMap = new Map(pollas?.map((p) => [p.id, p]) ?? []);
    const inviterMap = new Map(inviters?.map((u) => [u.id, u]) ?? []);

    const result = invites.map((invite) => ({
      id: invite.id,
      token: invite.token,
      expires_at: invite.expires_at,
      polla: pollaMap.get(invite.polla_id) ?? null,
      inviter: inviterMap.get(invite.invited_by) ?? null,
    }));

    return NextResponse.json({ invites: result });
  } catch (error) {
    console.error("Error fetching pending invites:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
