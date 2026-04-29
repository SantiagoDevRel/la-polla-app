// app/api/pollas/[slug]/payout-method/route.ts
//
// PATCH — el ganador (o cualquier participante) guarda su método y
// cuenta de cobro EN ESTA POLLA. Se persiste en
// polla_participants.payout_method / payout_account / payout_set_at.
//
// Si la polla terminó y el viewer tiene incoming transactions
// pendientes, el WinnerPayoutModal escribe acá. Si NO terminó pero el
// viewer ya quiere tener guardada su info para el futuro, también
// escribe acá.
//
// Validación: method ∈ {nequi, daviplata, bancolombia, transfiya, otro}.
// account: 3..120 chars. Trim.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const PayoutMethodSchema = z.enum([
  "nequi",
  "daviplata",
  "bancolombia",
  "transfiya",
  "otro",
]);

const BodySchema = z.object({
  method: PayoutMethodSchema,
  account: z.string().trim().min(3).max(120),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: { slug: string } },
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { data: polla } = await admin
    .from("pollas")
    .select("id")
    .eq("slug", params.slug)
    .maybeSingle();
  if (!polla) {
    return NextResponse.json({ error: "Polla no encontrada" }, { status: 404 });
  }

  // Solo participante de la polla puede guardar su método de cobro acá.
  // Otros (admin no-participante) usan el editor global de perfil.
  const { data: participant } = await admin
    .from("polla_participants")
    .select("id")
    .eq("polla_id", polla.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!participant) {
    return NextResponse.json(
      { error: "No sos participante de esta polla" },
      { status: 403 },
    );
  }

  const { error: updateErr } = await admin
    .from("polla_participants")
    .update({
      payout_method: parsed.data.method,
      payout_account: parsed.data.account,
      payout_set_at: new Date().toISOString(),
    })
    .eq("id", participant.id);
  if (updateErr) {
    console.error("[payout-method] update failed:", updateErr);
    return NextResponse.json(
      { error: "No se pudo guardar" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
