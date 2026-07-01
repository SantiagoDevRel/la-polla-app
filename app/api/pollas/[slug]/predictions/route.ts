// app/api/pollas/[slug]/predictions/route.ts — Guardar o actualizar pronóstico
// de un partido (POST) y leer los pronósticos propios de la polla (GET —
// lo usa el TeamInfoSheet para prefillear sus inputs de marcador).
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

export async function GET(
  _request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // Mismo workaround que el POST: lecturas via admin porque auth.uid()
    // es NULL en el contexto PostgREST; el scope manual user_id/polla_id
    // es el filtro de seguridad (defense-in-depth del CLAUDE.md).
    const admin = createAdminClient();
    const { data: polla } = await admin
      .from("pollas")
      .select("id")
      .eq("slug", params.slug)
      .single();
    if (!polla) {
      return NextResponse.json({ error: "Polla no encontrada" }, { status: 404 });
    }

    const { data: participant } = await admin
      .from("polla_participants")
      .select("id, status")
      .eq("polla_id", polla.id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!participant || participant.status === "rejected") {
      return NextResponse.json({ error: "No eres participante de esta polla" }, { status: 403 });
    }

    const { data: predictions } = await admin
      .from("predictions")
      .select("match_id, predicted_home, predicted_away, advance_pick")
      .eq("polla_id", polla.id)
      .eq("user_id", user.id);

    return NextResponse.json({ predictions: predictions ?? [] });
  } catch (error) {
    console.error("Error leyendo pronósticos:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

const predictionSchema = z.object({
  matchId: z.string().uuid("ID de partido inválido"),
  predictedHome: z.number().int().min(0).max(20),
  predictedAway: z.number().int().min(0).max(20),
  // Pick de "quién avanza" (+1 plano en pollas con advance_bonus, migración
  // 077). Opcional: solo se manda en knockouts. null para limpiarlo.
  advancePick: z.enum(["home", "away"]).nullable().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = predictionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    // pollas SELECT via admin: auth.uid() NULL en PostgREST hace que un
    // participante (no creator) vea "Polla no encontrada" al intentar
    // pronosticar. Sesión validada arriba.
    const admin = createAdminClient();
    const { data: polla, error: pollaError } = await admin
      .from("pollas")
      .select("id, match_ids, payment_mode")
      .eq("slug", params.slug)
      .single();

    if (pollaError || !polla) {
      return NextResponse.json({ error: "Polla no encontrada" }, { status: 404 });
    }

    // If polla has specific match_ids, validate the match belongs to this polla
    const validMatchIds: string[] = polla.match_ids ?? [];
    if (validMatchIds.length > 0 && !validMatchIds.includes(parsed.data.matchId)) {
      return NextResponse.json({ error: "Este partido no pertenece a esta polla" }, { status: 400 });
    }

    // Validación del participante también via admin (mismo motivo).
    const { data: participant } = await admin
      .from("polla_participants")
      .select("id, status, payment_status, paid")
      .eq("polla_id", polla.id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!participant) {
      return NextResponse.json({ error: "No eres participante de esta polla" }, { status: 403 });
    }

    if (participant.status === "rejected") {
      return NextResponse.json({ error: "Tu solicitud fue rechazada" }, { status: 403 });
    }

    // admin_collects payment gate: the organizer must confirm the comprobante
    // before the participant can predict. paid=true is the confirm signal.
    if (polla.payment_mode === "admin_collects" && !participant.paid) {
      return NextResponse.json(
        {
          error: "payment_required",
          message: "Tu pago debe ser aprobado por el organizador antes de pronosticar.",
        },
        { status: 403 }
      );
    }

    // Upsert del pronóstico — el trigger check_prediction_lock en
    // Supabase bloquea si falta menos de 5 min. Verificado: el trigger
    // no usa auth.uid(), solo lee matches.scheduled_at, así que correr
    // el upsert via admin no debilita la lógica anti-tarde. Usamos
    // admin porque predictions_insert/update gatean por auth.uid() =
    // user_id que es NULL en PostgREST.
    // El advance_pick NO está cubierto por el trigger de lock de la DB (que solo
    // bloquea cambios de marcador predicted_home/away). Enforce el lock de 5 min
    // a nivel app cuando viene un advancePick — sin esto un user podría fijar o
    // cambiar quién avanza DESPUÉS de ver el resultado del partido. (codex)
    if (parsed.data.advancePick !== undefined) {
      const { data: lockMatch } = await admin
        .from("matches")
        .select("scheduled_at, status")
        .eq("id", parsed.data.matchId)
        .maybeSingle();
      if (lockMatch) {
        const locked =
          lockMatch.status !== "scheduled" ||
          Date.now() >= new Date(lockMatch.scheduled_at).getTime() - 5 * 60 * 1000;
        if (locked) {
          return NextResponse.json(
            { error: "No se puede modificar el pronóstico a menos de 5 minutos del partido" },
            { status: 409 }
          );
        }
      }
    }

    const row: {
      polla_id: string;
      user_id: string;
      match_id: string;
      predicted_home: number;
      predicted_away: number;
      advance_pick?: "home" | "away" | null;
    } = {
      polla_id: polla.id,
      user_id: user.id,
      match_id: parsed.data.matchId,
      predicted_home: parsed.data.predictedHome,
      predicted_away: parsed.data.predictedAway,
    };
    // Solo incluimos advance_pick si vino en el body: así guardar el marcador
    // NO borra un advance_pick previo (y al revés). El trigger de lock de 5
    // min aplica igual (mismo upsert). Migración 077.
    if (parsed.data.advancePick !== undefined) {
      row.advance_pick = parsed.data.advancePick;
    }

    const { data: prediction, error: predError } = await admin
      .from("predictions")
      .upsert(row, { onConflict: "polla_id,user_id,match_id" })
      .select()
      .single();

    if (predError) {
      // El trigger de Supabase lanza una excepción con el mensaje en español
      if (predError.message.includes("5 minutos")) {
        return NextResponse.json(
          { error: "No se puede modificar el pronóstico a menos de 5 minutos del partido" },
          { status: 409 }
        );
      }
      throw predError;
    }

    return NextResponse.json({ prediction }, { status: 201 });
  } catch (error) {
    console.error("Error guardando pronóstico:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
