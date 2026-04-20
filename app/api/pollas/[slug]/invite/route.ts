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
  (process.env.NEXT_PUBLIC_APP_URL ?? "").trim() || "https://la-polla.vercel.app";

function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/[\s\-\(\)]/g, "");
  const noPlus = cleaned.replace(/^\+/, "");
  if (noPlus.startsWith("57")) return noPlus;
  if (noPlus.startsWith("3") && noPlus.length === 10) return "57" + noPlus;
  return noPlus;
}

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

    const normalizedPhone = normalizePhone(parsed.data.whatsapp_number);

    // Check if already invited (pending)
    const { data: existingInvite } = await admin
      .from("polla_invites")
      .select("id, status")
      .eq("polla_id", polla.id)
      .eq("whatsapp_number", normalizedPhone)
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
      .eq("whatsapp_number", normalizedPhone)
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

    // Get inviter name for the WhatsApp message
    const { data: inviterUser } = await admin
      .from("users")
      .select("display_name")
      .eq("id", user.id)
      .single();
    const inviterName = inviterUser?.display_name || "Alguien";

    // Generate token and insert invite
    const token = crypto.randomUUID();
    const expiresAt = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000
    ).toISOString();

    const { error: insertError } = await admin.from("polla_invites").insert({
      polla_id: polla.id,
      invited_by: user.id,
      whatsapp_number: normalizedPhone,
      token,
      status: "pending",
      expires_at: expiresAt,
    });

    if (insertError) throw insertError;

    if (existingUser) {
      // Registered user — send WhatsApp invite directly
      try {
        const inviteUrl = `${APP_URL}/invites/${token}`;
        await sendCTAButton(
          normalizedPhone,
          `Parce, *${inviterName}* te invitó a la polla *${polla.name}* 🐣\n\nTocá el botón para entrar y poner tus pronósticos 👇`,
          "Entrar a la polla 🏆",
          inviteUrl,
          "La Polla Colombiana 🐥"
        );
      } catch (waErr) {
        console.error("[invite] Error sending WhatsApp:", waErr);
      }
      return NextResponse.json({ success: true }, { status: 201 });
    }

    // Unregistered user — Meta blocks outbound messages to numbers that
    // haven't messaged the bot. Return a shareable link to the organizer.
    const shareLink = `${APP_URL}/invites/polla/${token}`;
    return NextResponse.json({
      success: true,
      unregistered: true,
      shareLink,
      message: `Este número no está registrado. Compartí este link directamente: ${shareLink}`,
    }, { status: 201 });
  } catch (error) {
    console.error("Error creando invitación:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
