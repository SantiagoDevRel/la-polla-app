// app/api/admin/sms-saldo/route.ts — saldo de LabsMobile para el panel.
//
// Si los créditos se agotan, el login por SMS deja de funcionar sin ningún
// error visible para el administrador. Este endpoint le muestra cuántos
// quedan y cuánto alcanzan al ritmo de los últimos siete días.
//
// Solo admin; la sesión se valida antes de llamar al proveedor o a la base.
// Devuelve números y el usuario de la cuenta (para confirmar cuál está
// configurada), nunca el token. Sin caché: el saldo cambia con cada envío.

import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBalance } from "@/lib/sms/labsmobile";
import { resumirSaldo } from "@/lib/sms/saldo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DIAS_VENTANA = 7;
const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user?.is_admin) {
    return NextResponse.json({ error: "Solo el administrador." }, { status: 403, headers: NO_STORE });
  }

  const desde = new Date(Date.now() - DIAS_VENTANA * 24 * 60 * 60 * 1000).toISOString();
  const db = createAdminClient();

  const [saldo, enviados] = await Promise.all([
    getBalance(),
    // Solo cuenta (head), sin filas: la tabla guarda teléfonos. Los rechazados
    // por el proveedor no consumen créditos.
    db
      .from("sms_entregas")
      .select("subid", { count: "exact", head: true })
      .gte("sent_at", desde)
      .neq("dispatch_status", "rejected"),
  ]);

  const cuenta = process.env.LABSMOBILE_USERNAME ?? null;

  if (!saldo.ok || saldo.credits == null) {
    return NextResponse.json(
      { ok: false, cuenta, error: saldo.error ?? "sin_saldo" },
      { status: 502, headers: NO_STORE },
    );
  }

  const enviadosVentana = enviados.error ? null : enviados.count ?? 0;
  const resumen = resumirSaldo(saldo.credits, enviadosVentana ?? 0, DIAS_VENTANA);

  return NextResponse.json(
    {
      ok: true,
      cuenta,
      ...resumen,
      // null = no se pudo leer el historial; la pantalla no inventa un ritmo.
      enviadosVentana,
      diasVentana: DIAS_VENTANA,
      consultadoEn: new Date().toISOString(),
    },
    { headers: NO_STORE },
  );
}
