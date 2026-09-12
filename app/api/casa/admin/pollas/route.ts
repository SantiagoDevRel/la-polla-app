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
import { casaJson, casaError, requireCasaContract } from "@/lib/casa/operations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const baseSchema = z.object({
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().max(400).optional(),
  entryPriceCop: z.number().int().min(0).max(10_000_000),
  houseCutPct: z.number().int().min(0).max(100).default(30),
  closesAt: z.string().datetime(),
  // Como se calcula el cierre (migracion 089). En "auto" el server IGNORA el
  // closesAt que mande el cliente y lo deriva del primer partido: el navegador
  // no es fuente de verdad para algo que decide hasta cuando entra plata.
  closeMode: z.enum(["auto", "manual"]).default("manual"),
  prizeKind: z.enum(["pozo", "objeto"]).default("pozo"),
  prizeObject: z.string().trim().max(160).optional(),
  prizeImagePath: z.string().trim().max(300).optional(),
  // A dónde transfiere la gente. Opcional en el schema porque un borrador
  // puede quedar a medias, pero obligatorio para PUBLICAR una polla paga
  // (se valida abajo): sin esto nadie puede completar el pago.
  payoutMethod: z.string().trim().max(40).optional(),
  payoutAccount: z.string().trim().max(60).optional(),
  payoutAccountName: z.string().trim().max(80).optional(),
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
      }).refine(
        // Una pregunta de opciones SIN opciones se publica igual y despues la
        // gente ve el enunciado sin un solo boton para responder — y el bot
        // tampoco puede resolverla porque no hay que elegir.
        (q) => q.inputKind !== "opciones" || q.options.filter(Boolean).length >= 2,
        { message: "Cada pregunta de opciones necesita al menos 2 opciones." },
      ),
    )
    .min(1)
    .max(20),
});

const rifaSchema = baseSchema.extend({
  kind: z.literal("rifa"),
  ticketCount: z.number().int().min(2).max(1000),
  drawMethod: z.string().trim().min(5).max(240),

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

  const contractError = requireCasaContract(req);
  if (contractError) return contractError;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos." },
      { status: 400 },
    );
  }
  const body = parsed.data;

  if (body.prizeKind === "objeto" && (!body.prizeObject || body.prizeObject.length < 3)) {
    return casaJson({ error: "Describe el premio en objeto." }, 400);
  }
  const db = createAdminClient();
  const baseSlug = slugify(body.name);
  // Unique slug conflicts are retried; the failed RPC transaction creates no partial pool.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${crypto.randomUUID().slice(0, 8)}`;
    const { data, error } = await db.rpc("casa_create_polla_v2", {
      p_config: body, p_slug: slug, p_actor_id: user.id, p_contract: 2,
    });
    if (error?.code === "23505") continue;
    if (error) return casaError(error);
    return casaJson(data);
  }
  return casaJson({ error: "No se pudo crear la polla. Intenta con otro nombre." }, 409);
}
