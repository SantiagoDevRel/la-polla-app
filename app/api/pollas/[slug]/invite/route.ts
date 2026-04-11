// app/api/pollas/[slug]/invite/route.ts — Invitar a un usuario a una polla cerrada
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendCTAButton } from "@/lib/whatsapp/interactive";
import { z } from "zod";
import crypto from "crypto";

const inviteSchema = z.object({
  whatsapp_number: z.string().min(10, "Número de WhatsApp inválido"),
});

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://la-polla.vercel.app";

export async function POST(
  request: NextRequest,
  { params }: { params: { slug: string } }
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
    const parsed = inviteSchema.safeParse(body);
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
      .select("id, name, type, slug")
      .eq("slug", params.slug)
      .single();

    if (pollaError || !polla) {
      return NextResponse.json(
        { error: "Polla no encontrada" },
        { status: 404 }
      );
    }

    // Verify caller is admin of this polla
    const { data: callerParticipant } = await admin
      .from("polla_participants")
      .select("role")
      .eq("polla_id", polla.id)
      .eq("user_id", user.id)
      .single();

    if (!callerParticipant || callerParticipant.role !== "admin") {
      return NextResponse.json(
        { error: "Solo el admin puede invitar" },
        { status: 403 }
      );
    }

    const { whatsapp_number } = parsed.data;

    // Check if already invited (pending)
    const { data: existingInvite } = await admin
      .from("polla_invites")
      .select("id, status")
      .eq("polla_id", polla.id)
      .eq("whatsapp_number", whatsapp_number)
      .eq("status", "pending")
      .single();

    if (existingInvite) {
      return NextResponse.json(
        { error: "Ya hay una invitación pendiente para este número" },
        { status: 409 }
      );
    }

    // Check if already a participant
    const { data: existingUser } = await admin
      .from("users")
      .select("id")
      .eq("whatsapp_number", whatsapp_number)
      .single();

    if (existingUser) {
      const { data: existingParticipant } = await admin
        .from("polla_participants")
        .select("id")
        .eq("polla_id", polla.id)
        .eq("user_id", existingUser.id)
        .single();

      if (existingParticipant) {
        return NextResponse.json(
          { error: "Este usuario ya es participante" },
          { status: 409 }
        );
      }
    }

    // Generate token and insert invite
    const token = crypto.randomUUID();
    const expiresAt = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000
    ).toISOString();

    const { error: insertError } = await admin.from("polla_invites").insert({
      polla_id: polla.id,
      invited_by: user.id,
      whatsapp_number,
      token,
      status: "pending",
      expires_at: expiresAt,
    });

    if (insertError) throw insertError;

    // Send WhatsApp invitation
    try {
      await sendCTAButton(
        whatsapp_number,
        `¡Hola parce! 👋 Te invitaron a la polla *${polla.name}*.\n\nTocá el link para unirte y empezar a jugar 🐔`,
        "Unirme a la polla",
        `${APP_URL}/invites/${token}`,
        "La Polla Colombiana 🐥"
      );
    } catch (waErr) {
      // Log but don't fail — invite is still valid via link
      console.error("[invite] Error sending WhatsApp:", waErr);
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error("Error creando invitación:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
