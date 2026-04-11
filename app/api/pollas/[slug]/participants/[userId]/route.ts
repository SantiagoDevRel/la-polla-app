// app/api/pollas/[slug]/participants/[userId]/route.ts — Approve or reject a participant
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const actionSchema = z.object({
  action: z.enum(["approve", "reject"]),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: { slug: string; userId: string } }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = actionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    // Get polla by slug
    const { data: polla, error: pollaError } = await admin
      .from("pollas")
      .select("id")
      .eq("slug", params.slug)
      .single();

    if (pollaError || !polla) {
      return NextResponse.json(
        { error: "Polla no encontrada" },
        { status: 404 }
      );
    }

    // Verify caller is admin
    const { data: callerParticipant } = await admin
      .from("polla_participants")
      .select("role")
      .eq("polla_id", polla.id)
      .eq("user_id", user.id)
      .single();

    if (!callerParticipant || callerParticipant.role !== "admin") {
      return NextResponse.json(
        { error: "Solo el admin puede aprobar o rechazar" },
        { status: 403 }
      );
    }

    // Update participant status
    const newStatus = parsed.data.action === "approve" ? "approved" : "rejected";
    const { error: updateError } = await admin
      .from("polla_participants")
      .update({ status: newStatus })
      .eq("polla_id", polla.id)
      .eq("user_id", params.userId)
      .eq("status", "pending");

    if (updateError) throw updateError;

    return NextResponse.json({ success: true, status: newStatus });
  } catch (error) {
    console.error("Error updating participant:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
