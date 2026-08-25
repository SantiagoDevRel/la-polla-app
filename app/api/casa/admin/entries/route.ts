// app/api/casa/admin/entries/route.ts — aprobar o rechazar un pago desde la web.
//
// Existe como RESPALDO del bot de Telegram, no como reemplazo. El bot es
// donde Tama vive (el pago pasa en la calle, con una mano, en 2 segundos),
// pero si Telegram se cae, o el chat nunca se vinculó, o se perdió el
// mensaje original, la cola de pagos queda muerta y la gente esperando.
// Con esto siempre hay una segunda puerta.
//
// La decisión que escribe es la MISMA que la del bot: `pagada` o `rechazada`
// con el guard anti doble-tap, para que las dos vías no puedan discrepar.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { getPot } from "@/lib/casa/queries";
import { signedProofUrl } from "@/lib/telegram/notify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  entryId: z.string().uuid(),
  decision: z.enum(["aprobar", "rechazar"]),
  motivo: z.string().trim().max(200).optional(),
});

/** GET — la cola de pendientes, con el comprobante para poder mirarlo. */
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user?.is_admin) {
    return NextResponse.json({ error: "Solo el admin." }, { status: 403 });
  }

  const db = createAdminClient();
  const { data: entries } = await db
    .from("casa_entries")
    .select("id, polla_id, user_id, amount_cop, ticket_number, proof_path, proof_uploaded_at")
    .eq("status", "pendiente")
    .not("proof_path", "is", null)
    .order("proof_uploaded_at", { ascending: true })
    .limit(50);

  if (!entries || entries.length === 0) return NextResponse.json({ pendientes: [] });

  // Nombres y pollas en dos queries, no una por fila.
  // filter/indexOf en vez de [...new Set()]: el target de tsconfig es ES5.
  // (tsgo deja pasar el spread de un Set; `tsc`, que es el que corre en el
  //  build de produccion, lo rechaza.)
  const userIds = entries
    .map((e) => e.user_id)
    .filter((v, i, a) => a.indexOf(v) === i);
  const pollaIds = entries
    .map((e) => e.polla_id)
    .filter((v, i, a) => a.indexOf(v) === i);

  const [{ data: users }, { data: pollas }] = await Promise.all([
    db.from("users").select("id, display_name").in("id", userIds),
    db.from("casa_pollas").select("id, name, slug").in("id", pollaIds),
  ]);

  const nombre = new Map((users ?? []).map((u) => [u.id, u.display_name]));
  const polla = new Map((pollas ?? []).map((p) => [p.id, p]));

  const pendientes = await Promise.all(
    entries.map(async (e) => ({
      id: e.id,
      jugador: nombre.get(e.user_id) ?? "Sin nombre",
      polla: polla.get(e.polla_id)?.name ?? "?",
      pollaSlug: polla.get(e.polla_id)?.slug ?? "",
      montoCop: e.amount_cop,
      boleta: e.ticket_number,
      subidoEn: e.proof_uploaded_at,
      // URL firmada de 1h: el bucket es privado y así se ve sin exponerlo.
      comprobanteUrl: e.proof_path ? await signedProofUrl(e.proof_path) : null,
    })),
  );

  return NextResponse.json({ pendientes });
}

/** POST — la decisión. */
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.is_admin) {
    return NextResponse.json({ error: "Solo el admin." }, { status: 403 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const { entryId, decision, motivo } = parsed.data;
  const aprobar = decision === "aprobar";

  const db = createAdminClient();

  // El `.eq("status","pendiente")` es el guard anti doble-decisión: si el bot
  // ya la resolvió hace un segundo, este update no toca nada.
  const { data: actualizada } = await db
    .from("casa_entries")
    .update({
      status: aprobar ? "pagada" : "rechazada",
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      reject_reason: aprobar ? null : (motivo ?? "Rechazado por el admin"),
    })
    .eq("id", entryId)
    .eq("status", "pendiente")
    .select("id, polla_id")
    .maybeSingle();

  if (!actualizada) {
    return NextResponse.json(
      { error: "Esa inscripción ya la habían resuelto." },
      { status: 409 },
    );
  }

  const pot = await getPot(actualizada.polla_id);
  return NextResponse.json({ ok: true, pozoCop: pot.prize_cop });
}
