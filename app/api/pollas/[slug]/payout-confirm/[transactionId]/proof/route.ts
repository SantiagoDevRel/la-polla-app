// app/api/pollas/[slug]/payout-confirm/[transactionId]/proof/route.ts
//
// Screenshots peer-to-peer del comprobante de pago.
//
// POST  — el from_user_id (loser) sube el screenshot. Opcional, no
//          bloquea el "marcar pagado". Reemplaza el anterior si existe.
// GET   — emite signed URL del screenshot. Acceso: from_user_id,
//          to_user_id, o admin de la polla.
// DELETE — el from_user_id borra su propio screenshot. Útil si subió
//          el equivocado.
//
// Storage: bucket privado `payout-proofs`, service-role only. Se borran
// solos a los 7 días via cron de cleanup (ver app/api/cron/cleanup-payout-proofs).
//
// El upload NO marca paid_at. Si el user quiere atomicidad puede llamar
// proof primero y después /payout-confirm. La UI los encadena.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

interface Params {
  params: { slug: string; transactionId: string };
}

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

async function loadTxAndPermissions(
  slug: string,
  transactionId: string,
  userId: string,
) {
  const admin = createAdminClient();
  const { data: polla } = await admin
    .from("pollas")
    .select("id, created_by")
    .eq("slug", slug)
    .maybeSingle();
  if (!polla) return { error: "Polla no encontrada" as const, status: 404 };

  const { data: tx } = await admin
    .from("polla_payouts")
    .select(
      "id, polla_id, from_user_id, to_user_id, proof_storage_path",
    )
    .eq("id", transactionId)
    .maybeSingle();
  if (!tx || tx.polla_id !== polla.id) {
    return { error: "Transacción no encontrada" as const, status: 404 };
  }

  const { data: membership } = await admin
    .from("polla_participants")
    .select("role")
    .eq("polla_id", polla.id)
    .eq("user_id", userId)
    .maybeSingle();
  const isAdmin =
    membership?.role === "admin" || polla.created_by === userId;
  const isFrom = tx.from_user_id === userId;
  const isTo = tx.to_user_id === userId;

  return { admin, polla, tx, isAdmin, isFrom, isTo };
}

export async function POST(request: NextRequest, { params }: Params) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const ctx = await loadTxAndPermissions(
    params.slug,
    params.transactionId,
    user.id,
  );
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  const { admin, tx, isFrom } = ctx;

  // Solo el que paga puede subir el comprobante.
  if (!isFrom) {
    return NextResponse.json(
      { error: "Solo quien paga puede subir el comprobante" },
      { status: 403 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Subida inválida (esperaba multipart/form-data)" },
      { status: 400 },
    );
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });
  }
  if (!ALLOWED_MIME.includes(file.type as (typeof ALLOWED_MIME)[number])) {
    return NextResponse.json(
      { error: "Solo JPG, PNG o WEBP" },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Imagen muy grande (máx 10 MB)" },
      { status: 400 },
    );
  }

  const ext =
    file.type === "image/png"
      ? "png"
      : file.type === "image/webp"
        ? "webp"
        : "jpg";
  const path = `${tx.polla_id}/${tx.id}/${Date.now()}.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await admin.storage
    .from("payout-proofs")
    .upload(path, buffer, { contentType: file.type, upsert: true });
  if (upErr) {
    console.error("[proof POST] upload failed:", upErr);
    return NextResponse.json(
      { error: "No se pudo subir el comprobante" },
      { status: 500 },
    );
  }

  // Si había un proof previo, borrarlo del bucket — no nos sirve.
  if (tx.proof_storage_path && tx.proof_storage_path !== path) {
    await admin.storage
      .from("payout-proofs")
      .remove([tx.proof_storage_path])
      .catch(() => {
        /* swallow — el cleanup se lo lleva en 7 días */
      });
  }

  const { error: updErr } = await admin
    .from("polla_payouts")
    .update({
      proof_storage_path: path,
      proof_uploaded_at: new Date().toISOString(),
    })
    .eq("id", tx.id);
  if (updErr) {
    console.error("[proof POST] update polla_payouts failed:", updErr);
    return NextResponse.json(
      { error: "Subido pero no pude registrar" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

export async function GET(_request: NextRequest, { params }: Params) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const ctx = await loadTxAndPermissions(
    params.slug,
    params.transactionId,
    user.id,
  );
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  const { admin, tx, isAdmin, isFrom, isTo } = ctx;

  if (!isAdmin && !isFrom && !isTo) {
    return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
  }
  if (!tx.proof_storage_path) {
    return NextResponse.json({ url: null });
  }

  const { data: signed, error: signErr } = await admin.storage
    .from("payout-proofs")
    .createSignedUrl(tx.proof_storage_path, 60 * 10); // 10 min
  if (signErr || !signed?.signedUrl) {
    return NextResponse.json(
      { error: "No se pudo generar el link" },
      { status: 500 },
    );
  }
  return NextResponse.json({ url: signed.signedUrl });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const ctx = await loadTxAndPermissions(
    params.slug,
    params.transactionId,
    user.id,
  );
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  const { admin, tx, isFrom } = ctx;

  if (!isFrom) {
    return NextResponse.json(
      { error: "Solo quien lo subió puede borrarlo" },
      { status: 403 },
    );
  }
  if (!tx.proof_storage_path) {
    return NextResponse.json({ ok: true, already: true });
  }

  await admin.storage
    .from("payout-proofs")
    .remove([tx.proof_storage_path])
    .catch(() => {
      /* swallow — el cleanup se lo lleva */
    });
  await admin
    .from("polla_payouts")
    .update({ proof_storage_path: null, proof_uploaded_at: null })
    .eq("id", tx.id);
  return NextResponse.json({ ok: true });
}
