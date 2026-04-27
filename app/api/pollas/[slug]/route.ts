// app/api/pollas/[slug]/route.ts — GET de una polla por slug con participantes, partidos y predicciones del usuario
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureMatchesFresh } from "@/lib/matches/ensure-fresh";
import {
  POLLA_COLUMNS,
  POLLA_PARTICIPANT_COLUMNS,
  MATCH_COLUMNS,
  PREDICTION_COLUMNS,
} from "@/lib/db/columns";

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    // Lazy sync de partidos recientes (fire-and-forget, no bloquea).
    void ensureMatchesFresh();

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // Same auth.uid() RLS workaround as the rest of the codebase: read
    // through the admin client and gate access ourselves. The
    // pollas_select_active policy filters on auth.uid() which is NULL in
    // the PostgREST request context, so the user-scoped client returns
    // null and the page renders "Polla no encontrada" right after
    // creation.
    const adminSupabase = createAdminClient();
    const { data: polla, error: pollaError } = await adminSupabase
      .from("pollas")
      .select(POLLA_COLUMNS)
      .eq("slug", params.slug)
      .single();

    if (pollaError || !polla) {
      return NextResponse.json({ error: "Polla no encontrada" }, { status: 404 });
    }

    const { data: participant } = await adminSupabase
      .from("polla_participants")
      .select(POLLA_PARTICIPANT_COLUMNS)
      .eq("polla_id", polla.id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!participant && polla.created_by !== user.id) {
      return NextResponse.json({ error: "No tienes acceso a esta polla" }, { status: 403 });
    }

    // Cargar participantes aprobados con sus puntos y rank
    const { data: participants } = await adminSupabase
      .from("polla_participants")
      .select(`
        *,
        users:user_id (
          id,
          display_name,
          whatsapp_number,
          avatar_url
        )
      `)
      .eq("polla_id", polla.id)
      .eq("status", "approved")
      .order("rank", { ascending: true, nullsFirst: false })
      .order("total_points", { ascending: false });

    // Cargar partidos — por match_ids si existen, sino por torneo (legacy)
    let matchQuery = supabase.from("matches").select(MATCH_COLUMNS);

    if (polla.match_ids && polla.match_ids.length > 0) {
      matchQuery = matchQuery.in("id", polla.match_ids);
    } else {
      matchQuery = matchQuery.eq("tournament", polla.tournament);
    }

    const { data: matches } = await matchQuery.order("scheduled_at", { ascending: true });

    // Cargar predicciones del usuario en esta polla. Mismo motivo que la
    // polla: predictions_select gatea por auth.uid() = user_id y
    // PostgREST recibe NULL, así que via cliente user-scoped sale vacío.
    const { data: predictions } = await adminSupabase
      .from("predictions")
      .select(PREDICTION_COLUMNS)
      .eq("polla_id", polla.id)
      .eq("user_id", user.id);

    const currentRole = participant?.role || (polla.created_by === user.id ? "admin" : "player");

    return NextResponse.json({
      polla,
      participants: participants || [],
      // Kept for backwards-compat with any older client bundles — always empty now
      // since 'pending' was retired in migration 010.
      pendingParticipants: [],
      matches: matches || [],
      predictions: predictions || [],
      currentUserRole: currentRole,
      currentUserStatus: participant?.status || "approved",
      currentUserPaymentStatus: participant?.payment_status || "approved",
      currentUserPaid: participant?.paid ?? true,
      currentUserId: user.id,
    });
  } catch (error) {
    console.error("Error cargando polla:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

// Hard-delete the polla and every dependent row (participants,
// predictions, notifications, invites). All FKs to public.pollas have
// ON DELETE CASCADE, so a single DELETE on pollas is atomic.
//
// Auth: must be authenticated AND have role='admin' on
// polla_participants for this polla. The check mirrors rotate-code so
// both endpoints stay in lockstep on what "admin of this polla" means.
// We do NOT fall back to pollas.created_by — the participant row is
// the authoritative source (admins can transfer ownership in the
// future without needing a parallel column rename).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { slug: string } },
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: polla, error: pollaErr } = await admin
    .from("pollas")
    .select("id, name")
    .eq("slug", params.slug)
    .maybeSingle();
  if (pollaErr) {
    console.error("[pollas DELETE] lookup failed:", pollaErr);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
  if (!polla) {
    return NextResponse.json(
      { error: "Polla no encontrada" },
      { status: 404 },
    );
  }

  const { data: membership } = await admin
    .from("polla_participants")
    .select("role")
    .eq("polla_id", polla.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership || membership.role !== "admin") {
    return NextResponse.json(
      { error: "Solo el admin de la polla puede borrarla" },
      { status: 403 },
    );
  }

  const { error: delErr } = await admin
    .from("pollas")
    .delete()
    .eq("id", polla.id);
  if (delErr) {
    console.error("[pollas DELETE] delete failed:", delErr);
    return NextResponse.json(
      { error: "No se pudo borrar la polla" },
      { status: 500 },
    );
  }

  console.log(
    `[pollas DELETE] polla "${polla.name}" (id=${polla.id}) deleted by user ${user.id}`,
  );
  return NextResponse.json({ ok: true });
}
