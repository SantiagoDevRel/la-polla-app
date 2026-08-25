// app/api/casa/pollas/[slug]/picks/route.ts
//
// Guardar y leer los pronosticos de UNA persona en UNA polla.
//
// Reglas duras:
//  * Solo se pronostica si tenés inscripcion (aunque el pago esté pendiente:
//    asi la gente puede ir marcando mientras el admin confirma).
//  * Se bloquea cuando la polla cierra (`closes_at`) y, ademas, partido por
//    partido: un partido que ya arrancó no se puede pronosticar aunque la
//    polla siga abierta.
//  * Los picks NUNCA se borran; se sobrescriben con upsert por (entry, target).

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getMyEntry,
  getMyPicks,
  getPollaBySlug,
  getPollaMatches,
} from "@/lib/casa/queries";
import { isPollaOpen } from "@/lib/casa/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Margen antes del pitazo. Igual criterio que el resto del repo: 5 minutos. */
const LOCK_MS = 5 * 60_000;

const pickSchema = z
  .object({
    matchId: z.string().uuid().optional(),
    questionId: z.string().uuid().optional(),
    pick1x2: z.enum(["L", "E", "V"]).nullable().optional(),
    homeScore: z.number().int().min(0).max(30).nullable().optional(),
    awayScore: z.number().int().min(0).max(30).nullable().optional(),
    optionId: z.string().uuid().nullable().optional(),
    freeText: z.string().trim().max(120).nullable().optional(),
  })
  .refine((p) => Boolean(p.matchId) !== Boolean(p.questionId), {
    message: "Cada pronóstico apunta a un partido O a una pregunta, no a los dos.",
  });

const bodySchema = z.object({ picks: z.array(pickSchema).min(1).max(60) });

export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sin sesión." }, { status: 401 });

  const polla = await getPollaBySlug(params.slug);
  if (!polla) return NextResponse.json({ error: "No existe." }, { status: 404 });

  const picks = await getMyPicks(polla.id, user.id);
  return NextResponse.json({ picks });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sin sesión." }, { status: 401 });

  const polla = await getPollaBySlug(params.slug);
  if (!polla || polla.status === "borrador") {
    return NextResponse.json({ error: "Esa polla no existe." }, { status: 404 });
  }
  if (!isPollaOpen(polla)) {
    return NextResponse.json(
      { error: "Esta polla ya cerró. Los pronósticos quedaron como estaban." },
      { status: 409 },
    );
  }

  const entry = await getMyEntry(polla.id, user.id);
  if (!entry || entry.status === "rechazada" || entry.status === "anulada") {
    return NextResponse.json(
      { error: "Primero tenés que inscribirte a la polla." },
      { status: 403 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos." },
      { status: 400 },
    );
  }

  const db = createAdminClient();

  // ── que partidos siguen abiertos ───────────────────────────────────────
  const matches = await getPollaMatches(polla.id);
  const abiertos = new Set(
    matches
      .filter(
        (m: { scheduled_at: string }) =>
          new Date(m.scheduled_at).getTime() - LOCK_MS > Date.now(),
      )
      .map((m: { id: string }) => m.id),
  );
  const deLaPolla = new Set(matches.map((m: { id: string }) => m.id));

  const { data: preguntas } = await db
    .from("casa_questions")
    .select("id, resolved_at")
    .eq("polla_id", polla.id);
  const preguntasAbiertas = new Set(
    (preguntas ?? [])
      .filter((q: { resolved_at: string | null }) => q.resolved_at === null)
      .map((q: { id: string }) => q.id),
  );

  const filas = [];
  const rechazados: string[] = [];

  for (const p of parsed.data.picks) {
    if (p.matchId) {
      if (!deLaPolla.has(p.matchId)) {
        rechazados.push("Un partido no pertenece a esta polla.");
        continue;
      }
      if (!abiertos.has(p.matchId)) {
        rechazados.push("Un partido ya arrancó y no se puede cambiar.");
        continue;
      }
      // En modo 1X2 solo importa la opcion; en marcador, los dos numeros.
      if (polla.scoring_mode === "1x2" && !p.pick1x2) continue;
      if (
        polla.scoring_mode === "marcador" &&
        (p.homeScore == null || p.awayScore == null)
      )
        continue;
    } else if (p.questionId) {
      if (!preguntasAbiertas.has(p.questionId)) {
        rechazados.push("Una pregunta ya fue resuelta.");
        continue;
      }
    }

    filas.push({
      entry_id: entry.id,
      polla_id: polla.id,
      user_id: user.id,
      match_id: p.matchId ?? null,
      question_id: p.questionId ?? null,
      pick_1x2: polla.scoring_mode === "1x2" ? (p.pick1x2 ?? null) : null,
      home_score: polla.scoring_mode === "marcador" ? (p.homeScore ?? null) : null,
      away_score: polla.scoring_mode === "marcador" ? (p.awayScore ?? null) : null,
      option_id: p.optionId ?? null,
      free_text: p.freeText ?? null,
      updated_at: new Date().toISOString(),
    });
  }

  if (filas.length === 0) {
    return NextResponse.json(
      { error: rechazados[0] ?? "No había nada para guardar." },
      { status: 400 },
    );
  }

  // Dos upserts: los indices unicos son parciales (uno para partidos, otro
  // para preguntas), asi que PostgREST necesita saber cual usar en cada caso.
  const dePartidos = filas.filter((f) => f.match_id);
  const dePreguntas = filas.filter((f) => f.question_id);

  if (dePartidos.length) {
    const { error } = await db
      .from("casa_picks")
      .upsert(dePartidos, { onConflict: "entry_id,match_id" });
    if (error) {
      console.error("[casa/picks] upsert partidos:", error.message);
      return NextResponse.json({ error: "No pude guardar." }, { status: 500 });
    }
  }
  if (dePreguntas.length) {
    const { error } = await db
      .from("casa_picks")
      .upsert(dePreguntas, { onConflict: "entry_id,question_id" });
    if (error) {
      console.error("[casa/picks] upsert preguntas:", error.message);
      return NextResponse.json({ error: "No pude guardar." }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    guardados: filas.length,
    // filter en vez de spread de un Set: target ES5 (ver tsconfig).
    avisos: rechazados.filter((a, i) => rechazados.indexOf(a) === i),
  });
}
