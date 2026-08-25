// app/api/casa/pollas/[slug]/join/route.ts
//
// "Me quiero meter a esta polla": crea la inscripcion en estado `pendiente`,
// guarda el pantallazo de la transferencia en el bucket privado, y le avisa a
// Tama por Telegram con los botones de aprobar/rechazar.
//
// La plata NO se mueve por acá: la transferencia es por fuera (Nequi, Daviplata,
// lo que sea) y lo unico que hace la app es registrar el comprobante y esperar
// la confirmacion humana. Hasta que el admin apruebe, la inscripcion NO cuenta
// para el pozo ni para la tabla.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMyEntry, getPollaBySlug, getPot } from "@/lib/casa/queries";
import { isPollaOpen } from "@/lib/casa/types";
import { notifyNewProof, PROOF_BUCKET } from "@/lib/telegram/notify";
import { redactId } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 8 * 1024 * 1024; // el bucket topa en 10MB; dejamos aire
// Exactamente los que acepta el bucket `payment-proofs`. Tenerlos
// desalineados era peor que ser estricto: HEIC pasaba esta validacion, el
// storage lo rechazaba, y la persona veia "no pude guardar el pantallazo"
// sin ninguna pista de que su iPhone estaba mandando un formato distinto.
const TIPOS_OK = ["image/jpeg", "image/png", "image/webp"];

const bodySchema = z.object({
  /** Solo en rifas: que boleta quiere. */
  ticketNumber: z.coerce.number().int().positive().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  // ── auth ANTES de tocar la DB ──────────────────────────────────────────
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
  }

  const polla = await getPollaBySlug(params.slug);
  if (!polla || polla.status === "borrador") {
    return NextResponse.json({ error: "Esa polla no existe." }, { status: 404 });
  }
  if (!isPollaOpen(polla)) {
    return NextResponse.json(
      { error: "Esta polla ya cerró. No se puede entrar." },
      { status: 409 },
    );
  }

  // ── el pantallazo ──────────────────────────────────────────────────────
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "No pude leer el formulario." }, { status: 400 });
  }

  const file = form.get("proof");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Falta el pantallazo de la transferencia." },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "La imagen pesa mucho. Manda una de menos de 8 MB." },
      { status: 413 },
    );
  }
  if (!TIPOS_OK.includes(file.type)) {
    // Mensaje distinto para HEIC: es lo que manda un iPhone cuando la foto
    // viene de la camara, y decir solo "formato no soportado" no le dice a
    // nadie que hacer al respecto.
    const esHeic = /heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name ?? "");
    return NextResponse.json(
      {
        error: esHeic
          ? "Ese formato de iPhone no me sirve. Toma un pantallazo de la transferencia (botón de bloqueo + volumen) y sube esa imagen."
          : "Solo acepto imágenes JPG, PNG o WEBP.",
      },
      { status: 415 },
    );
  }

  const parsed = bodySchema.safeParse({
    ticketNumber: form.get("ticketNumber") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Número de boleta inválido." }, { status: 400 });
  }
  const { ticketNumber } = parsed.data;

  // ── reglas propias de la rifa ──────────────────────────────────────────
  if (polla.kind === "rifa") {
    if (ticketNumber == null) {
      return NextResponse.json(
        { error: "Elige el número de boleta." },
        { status: 400 },
      );
    }
    if (polla.ticket_count != null && ticketNumber > polla.ticket_count) {
      return NextResponse.json(
        { error: `Esta rifa va del 1 al ${polla.ticket_count}.` },
        { status: 400 },
      );
    }
  }

  // En polla normal, una sola inscripcion por persona. Si la anterior fue
  // RECHAZADA se reusa esa fila en vez de insertar otra: el indice unico
  // (casa_entries_one_per_user) bloqueaba el INSERT y la persona quedaba sin
  // forma de volver a intentar despues de que le rebotaran el comprobante.
  let entryExistente: string | null = null;
  if (polla.kind !== "rifa") {
    const existing = await getMyEntry(polla.id, user.id);
    if (existing) {
      // `rechazada` (Tama dijo que no) y `anulada` (fallo la subida) son las
      // dos formas de "intentaste y no quedo". Las dos tienen que dejar
      // reintentar: si no, la fila vieja bloquea el indice unico y la persona
      // se queda sin forma de entrar a la polla, para siempre.
      if (existing.status === "rechazada" || existing.status === "anulada") {
        entryExistente = existing.id;
      } else {
        return NextResponse.json(
          { error: "Ya estás inscrito en esta polla.", entryId: existing.id },
          { status: 409 },
        );
      }
    }
  }

  const db = createAdminClient();

  // ── crear (o revivir) la inscripcion ───────────────────────────────────
  let entry: { id: string } | null = null;
  let insErr: { code?: string } | null = null;

  if (entryExistente) {
    const { data, error } = await db
      .from("casa_entries")
      .update({
        status: "pendiente",
        reject_reason: null,
        reviewed_at: null,
        reviewed_by: null,
        amount_cop: polla.entry_price_cop,
      })
      .eq("id", entryExistente)
      .eq("user_id", user.id) // ← filtro explicito, siempre
      .select("id")
      .single();
    entry = data;
    insErr = error;
  } else {
    const { data, error } = await db
      .from("casa_entries")
      .insert({
        polla_id: polla.id,
        user_id: user.id,
        status: "pendiente",
        amount_cop: polla.entry_price_cop,
        ticket_number: polla.kind === "rifa" ? ticketNumber : null,
      })
      .select("id")
      .single();
    entry = data;
    insErr = error;
  }

  if (insErr || !entry) {
    // 23505 = choque contra un indice unico. En rifa significa que otra
    // persona pidio esa boleta primero; en polla normal seria otra cosa, y
    // decirle "esa boleta ya la cogieron" a alguien que no eligio ninguna
    // boleta es peor que no decir nada.
    const choque = insErr?.code === "23505";
    return NextResponse.json(
      {
        error:
          choque && polla.kind === "rifa"
            ? "Esa boleta ya la cogió alguien. Elige otra."
            : "No pude registrar tu inscripción. Prueba otra vez.",
      },
      { status: choque ? 409 : 500 },
    );
  }

  // ── subir el comprobante ───────────────────────────────────────────────
  const ext = file.type.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
  const path = `casa/${polla.id}/${entry.id}.${ext}`;

  const { error: upErr } = await db.storage
    .from(PROOF_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: true });

  if (upErr) {
    console.error("[casa/join] fallo la subida:", redactId(entry.id), upErr.message);
    // Sin comprobante, esta inscripcion es invisible para Tama (la cola del
    // bot filtra por proof_path). Si se deja en `pendiente`, la persona queda
    // esperando una aprobacion que nadie va a ver nunca, y ademas no puede
    // reintentar porque el indice unico la bloquea. Se anula para que el
    // proximo intento entre limpio.
    await db
      .from("casa_entries")
      .update({ status: "anulada", reject_reason: "No se pudo subir el comprobante" })
      .eq("id", entry.id)
      .eq("user_id", user.id);

    return NextResponse.json(
      { error: "No pude guardar el pantallazo. Prueba otra vez." },
      { status: 500 },
    );
  }

  await db
    .from("casa_entries")
    .update({ proof_path: path, proof_uploaded_at: new Date().toISOString() })
    .eq("id", entry.id);

  // ── avisarle a Tama (best-effort: si falla, la fila ya quedo) ──────────
  const [{ data: perfil }, pot] = await Promise.all([
    db.from("users").select("display_name").eq("id", user.id).maybeSingle(),
    getPot(polla.id),
  ]);

  await notifyNewProof({
    entryId: entry.id,
    pollaName: polla.name,
    pollaSlug: polla.slug,
    userName: perfil?.display_name ?? "Sin nombre",
    amountCop: polla.entry_price_cop,
    proofPath: path,
    ticketNumber: ticketNumber ?? null,
    // Como quedaria el pozo si Tama aprueba este pago.
    potAfterCop:
      pot.prize_cop +
      Math.floor((polla.entry_price_cop * (100 - polla.house_cut_pct)) / 100),
  });

  return NextResponse.json({
    ok: true,
    entryId: entry.id,
    status: "pendiente",
    mensaje:
      "Listo, ya le llegó el pantallazo al admin. Apenas lo confirme, entras al pozo.",
  });
}
