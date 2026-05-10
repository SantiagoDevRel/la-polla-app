// app/api/pollas/[slug]/payout-method/route.ts
//
// PATCH — el ganador (o cualquier participante) guarda su método +
// cuenta + nombre de cobro. Se persiste a nivel PERFIL en
// users.default_payout_*. El trigger DB
// (sync_user_default_payout_to_participants, migration 053) replica
// automáticamente a polla_participants en TODAS las pollas del user,
// presentes y futuras.
//
// El path /pollas/[slug]/payout-method se mantiene como entry point
// porque el WinnerPayoutModal lo invoca cuando el ganador llena su
// cuenta desde una polla específica — el chequeo "es participante de
// esta polla" sigue actuando como gate de auth.
//
// Reglas por método (alineadas al verifier AI):
//   - nequi:        account=celular. account_name no se usa (ignorado).
//   - bancolombia:  account=número de cuenta. account_name REQUERIDO.
//   - otro:         account=cualquier string. account_name REQUERIDO.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const PayoutMethodSchema = z.enum(["nequi", "bancolombia", "otro"]);

const BodySchema = z.object({
  method: PayoutMethodSchema,
  account: z.string().trim().min(3).max(120),
  accountName: z.string().trim().min(2).max(120).nullable().optional(),
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

  // Validación: bancolombia + otro requieren accountName.
  if (parsed.data.method !== "nequi") {
    if (!parsed.data.accountName || parsed.data.accountName.trim().length < 2) {
      return NextResponse.json(
        {
          error: `Para ${parsed.data.method} hay que poner el nombre como aparece en la cuenta del banco.`,
        },
        { status: 400 },
      );
    }
  }
  const accountNameToStore =
    parsed.data.method === "nequi" ? null : (parsed.data.accountName ?? null);

  // Decisión 2026-05-09: la cuenta vive a nivel perfil. Si guardo acá,
  // se actualiza users.default_payout_* y un trigger DB
  // (sync_user_default_payout_to_participants, migration 053) replica
  // a TODOS los polla_participants del user. Así una sola cuenta sirve
  // para TODAS las pollas — el user no maneja cuentas distintas por polla.
  const { error: userErr } = await admin
    .from("users")
    .update({
      default_payout_method: parsed.data.method,
      default_payout_account: parsed.data.account,
      default_payout_account_name: accountNameToStore,
      default_payout_set_at: new Date().toISOString(),
    })
    .eq("id", user.id);
  if (userErr) {
    console.error("[payout-method] users update failed:", userErr);
    return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
