// app/api/double-survey/vote/route.ts — Registra el voto del usuario en la
// encuesta "puntos dobles desde octavos".
//
// Valida que el usuario sea participante PAGADO de la polla y que la
// encuesta siga abierta (double_survey_open=true) antes de aceptar el voto.
// Upsert por (polla_id, user_id): re-votar reemplaza el voto anterior.
//
// Auth: sesión Supabase. Escritura por admin client + chequeo de membresía
// explícito (auth.uid() es NULL en PostgREST — ver CLAUDE.md).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  pollaId: z.string().uuid(),
  choice: z.enum(["si", "no"]),
});

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let parsed;
  try {
    parsed = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const admin = createAdminClient();

  // La encuesta debe estar abierta para esa polla.
  const { data: polla } = await admin
    .from("pollas")
    .select("id, double_survey_open")
    .eq("id", parsed.pollaId)
    .maybeSingle();
  if (!polla || !polla.double_survey_open) {
    return NextResponse.json(
      { error: "Esta encuesta no está disponible" },
      { status: 404 },
    );
  }

  // El usuario debe ser participante pagado de esa polla.
  const { data: part } = await admin
    .from("polla_participants")
    .select("id")
    .eq("polla_id", parsed.pollaId)
    .eq("user_id", user.id)
    .eq("paid", true)
    .maybeSingle();
  if (!part) {
    return NextResponse.json(
      { error: "No participas en esta polla" },
      { status: 403 },
    );
  }

  const { error: upErr } = await admin.from("double_survey_votes").upsert(
    {
      polla_id: parsed.pollaId,
      user_id: user.id,
      choice: parsed.choice,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "polla_id,user_id" },
  );

  if (upErr) {
    console.error("[double-survey] vote upsert error:", upErr);
    return NextResponse.json(
      { error: "No pudimos guardar tu voto" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
