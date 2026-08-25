// app/api/casa/admin/pollas/route.ts — SOLO el admin crea pollas.
//
// Es la diferencia estructural con el modelo viejo: antes cualquiera armaba su
// polla; ahora la casa es una sola y la arma Tama. Todo lo que entra por acá
// pasa por `isCurrentUserAdmin()` (columna users.is_admin), nunca por el
// telefono ni por una env var.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCurrentUserAdmin, getAuthenticatedUser } from "@/lib/auth/admin";
import { slugify } from "@/lib/casa/format";
import { listAllPollas } from "@/lib/casa/queries";
import { isCreatableTournament } from "@/lib/tournaments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const baseSchema = z.object({
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().max(400).optional(),
  entryPriceCop: z.number().int().min(0).max(10_000_000),
  houseCutPct: z.number().int().min(0).max(100).default(30),
  closesAt: z.string().datetime(),
  prizeObject: z.string().trim().max(160).optional(),
  publish: z.boolean().default(false),
});

const partidosSchema = baseSchema.extend({
  kind: z.literal("partidos"),
  // Solo los torneos que la casa tiene habilitados. Antes era un string
  // libre: se podia crear una polla con un torneo inexistente y despues
  // la UI no resolvia ni el nombre ni el escudo.
  tournament: z.string().refine(isCreatableTournament, {
    message: "Ese torneo no está habilitado.",
  }),
  scoringMode: z.enum(["1x2", "marcador"]),
  matchIds: z.array(z.string().uuid()).min(1).max(30),
});

const manualSchema = baseSchema.extend({
  kind: z.literal("manual"),
  questions: z
    .array(
      z.object({
        prompt: z.string().trim().min(3).max(200),
        points: z.number().int().min(1).max(50).default(3),
        inputKind: z.enum(["opciones", "texto"]).default("opciones"),
        options: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
      }),
    )
    .min(1)
    .max(20),
});

const rifaSchema = baseSchema.extend({
  kind: z.literal("rifa"),
  ticketCount: z.number().int().min(2).max(1000),
  drawMethod: z.string().trim().min(5).max(240),
  // En una rifa el premio NO es opcional: es la razon por la que alguien
  // compra la boleta. En las demas pollas el premio es el pozo en plata y
  // `prizeObject` es un extra; aca es el producto.
  prizeObject: z.string().trim().min(3).max(160),
});

const schema = z.discriminatedUnion("kind", [
  partidosSchema,
  manualSchema,
  rifaSchema,
]);

export async function GET() {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "Solo el admin." }, { status: 403 });
  }
  return NextResponse.json({ pollas: await listAllPollas() });
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.is_admin) {
    return NextResponse.json({ error: "Solo el admin." }, { status: 403 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos." },
      { status: 400 },
    );
  }
  const body = parsed.data;

  if (new Date(body.closesAt) <= new Date()) {
    return NextResponse.json(
      { error: "La fecha de cierre tiene que ser futura." },
      { status: 400 },
    );
  }

  const db = createAdminClient();

  // Slug unico: si ya existe, le pega un sufijo corto en vez de fallar.
  let slug = slugify(body.name);
  const { data: choque } = await db
    .from("casa_pollas")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (choque) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

  const { data: polla, error } = await db
    .from("casa_pollas")
    .insert({
      slug,
      name: body.name,
      description: body.description ?? null,
      kind: body.kind,
      tournament: body.kind === "partidos" ? body.tournament : null,
      scoring_mode: body.kind === "partidos" ? body.scoringMode : null,
      entry_price_cop: body.entryPriceCop,
      house_cut_pct: body.houseCutPct,
      prize_object: body.prizeObject ?? null,
      // En 1X2 el marcador exacto no aplica; dejamos los puntos coherentes con
      // el modo para que la tabla no muestre reglas que no se usan.
      points_result: 3,
      points_exact: 3,
      points_one_team: 1,
      status: body.publish ? "abierta" : "borrador",
      closes_at: body.closesAt,
      ticket_count: body.kind === "rifa" ? body.ticketCount : null,
      draw_method: body.kind === "rifa" ? body.drawMethod : null,
      created_by: user.id,
    })
    .select("id, slug")
    .single();

  if (error || !polla) {
    console.error("[casa/admin] no pude crear la polla:", error?.message);
    return NextResponse.json({ error: "No pude crear la polla." }, { status: 500 });
  }

  // ── partidos ───────────────────────────────────────────────────────────
  if (body.kind === "partidos") {
    const filas = body.matchIds.map((id, i) => ({
      polla_id: polla.id,
      match_id: id,
      order_index: i,
    }));
    const { error: mErr } = await db.from("casa_polla_matches").insert(filas);
    if (mErr) {
      console.error("[casa/admin] partidos:", mErr.message);
      return NextResponse.json(
        { error: "Creé la polla pero no pude asociar los partidos.", slug: polla.slug },
        { status: 500 },
      );
    }
  }

  // ── preguntas manuales + sus opciones ──────────────────────────────────
  if (body.kind === "manual") {
    // Índice clásico y no `.entries()`: el target de tsconfig es ES5 y
    // iterar un ArrayIterator exigiría --downlevelIteration.
    for (let i = 0; i < body.questions.length; i += 1) {
      const q = body.questions[i];
      const { data: pregunta, error: qErr } = await db
        .from("casa_questions")
        .insert({
          polla_id: polla.id,
          prompt: q.prompt,
          order_index: i,
          points: q.points,
          input_kind: q.inputKind,
        })
        .select("id")
        .single();

      if (qErr || !pregunta) {
        console.error("[casa/admin] pregunta:", qErr?.message);
        continue;
      }
      if (q.inputKind === "opciones" && q.options.length > 0) {
        await db.from("casa_options").insert(
          q.options.map((label, j) => ({
            question_id: pregunta.id,
            label,
            order_index: j,
          })),
        );
      }
    }
  }

  return NextResponse.json({ ok: true, slug: polla.slug, id: polla.id });
}
