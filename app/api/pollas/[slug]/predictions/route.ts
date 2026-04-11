// app/api/pollas/[slug]/predictions/route.ts — Guardar o actualizar pronóstico de un partido
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

const predictionSchema = z.object({
  matchId: z.string().uuid("ID de partido inválido"),
  predictedHome: z.number().int().min(0).max(20),
  predictedAway: z.number().int().min(0).max(20),
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

    // Obtener la polla por slug
    const { data: polla, error: pollaError } = await supabase
      .from("pollas")
      .select("id")
      .eq("slug", params.slug)
      .single();

    if (pollaError || !polla) {
      return NextResponse.json({ error: "Polla no encontrada" }, { status: 404 });
    }

    // Verificar que el usuario es participante
    const { data: participant } = await supabase
      .from("polla_participants")
      .select("id")
      .eq("polla_id", polla.id)
      .eq("user_id", user.id)
      .single();

    if (!participant) {
      return NextResponse.json({ error: "No eres participante de esta polla" }, { status: 403 });
    }

    // Upsert del pronóstico — el trigger check_prediction_lock en Supabase bloquea si falta menos de 5 min
    // "upsert" significa insertar si no existe, actualizar si ya existe (basado en la constraint UNIQUE)
    const { data: prediction, error: predError } = await supabase
      .from("predictions")
      .upsert(
        {
          polla_id: polla.id,
          user_id: user.id,
          match_id: parsed.data.matchId,
          predicted_home: parsed.data.predictedHome,
          predicted_away: parsed.data.predictedAway,
        },
        {
          onConflict: "polla_id,user_id,match_id",
        }
      )
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
