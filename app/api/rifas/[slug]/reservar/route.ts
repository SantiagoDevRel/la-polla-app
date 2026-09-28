// app/api/rifas/[slug]/reservar/route.ts — reservar o quitar números.
//
// La reserva es atómica en SQL (rifa_reserve_v1 bloquea la rifa y el índice
// único parcial respalda): si dos personas tocan el 07 a la vez, una lo
// obtiene y la otra recibe NUMBER_TAKEN con el número en el mensaje.
import { z } from "zod";
import { rifaError, rifaJson, RIFA_DISABLED, RIFA_UNAUTHORIZED } from "@/lib/rifas/errors";
import { getRifaViewer, rifaIdBySlug, rifaRpc, rifasEnabled } from "@/lib/rifas/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  action: z.enum(["reservar", "quitar"]),
  numbers: z.array(z.number().int().min(0).max(99)).min(1).max(100),
});

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!rifasEnabled()) return RIFA_DISABLED();
  const viewer = await getRifaViewer();
  if (!viewer) return RIFA_UNAUTHORIZED();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return rifaJson({ error: "Elige números del tablero." }, 400);
  const rifaId = await rifaIdBySlug((await params).slug);
  if (!rifaId) return rifaJson({ error: "Esta rifa no existe o no está disponible." }, 404);
  const { action, numbers } = parsed.data;
  const { data, error } = await rifaRpc(action === "reservar" ? "rifa_reserve_v1" : "rifa_cancel_reservation_v1",
    { p_rifa: rifaId, p_buyer: viewer.id, p_numbers: numbers });
  if (error) return rifaError(error);
  return rifaJson({ ok: true, ...(data as object) });
}
