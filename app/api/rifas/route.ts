// app/api/rifas/route.ts — «Mis rifas» (GET) y «Crear mi rifa» (POST).
//
// GET responde { enabled:false } con el flag apagado para que Perfil y la
// pestaña RIFAS no dibujen nada. POST exige creador habilitado: lo decide SQL
// (rifa_create_v1 → CREATOR_REQUIRED), no el cliente.
import { z } from "zod";
import { colombiaDateTimeToIso } from "@/lib/time/colombia";
import { rifaError, rifaJson, RIFA_DISABLED, RIFA_UNAUTHORIZED } from "@/lib/rifas/errors";
import { getMyRifas, getRifaViewer, lastPaymentAccount, rifaRpc, rifasEnabled } from "@/lib/rifas/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!rifasEnabled()) return rifaJson({ enabled: false });
  const viewer = await getRifaViewer();
  if (!viewer) return RIFA_UNAUTHORIZED();
  const { data, error } = await getMyRifas(viewer.id);
  if (error || !data) return rifaError(error ?? {});
  const prefill = data.can_create ? await lastPaymentAccount(viewer.id) : null;
  return rifaJson({ enabled: true, ...data, payment_prefill: prefill });
}

const createSchema = z.object({
  name: z.string().trim().min(3).max(80),
  prizeKind: z.enum(["dinero", "texto"]),
  prizeCop: z.number().int().min(1000).max(1_000_000_000).nullable(),
  prizeText: z.string().trim().min(3).max(120).nullable(),
  numberCount: z.number().int().min(2).max(100),
  priceCop: z.number().int().min(500).max(1_000_000),
  lotteryName: z.string().trim().min(2).max(60),
  digitsRule: z.enum(["ultimas_dos", "primeras_dos"]),
  // Fecha y hora del sorteo en Colombia, como la escribe el formulario (YYYY-MM-DDTHH:mm).
  drawAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  visibility: z.enum(["privada", "publica"]),
  paymentMethod: z.enum(["nequi", "bancolombia", "daviplata", "otro"]),
  paymentAccount: z.string().trim().min(3).max(60),
  paymentHolder: z.string().trim().min(2).max(80),
});

export async function POST(request: Request) {
  if (!rifasEnabled()) return RIFA_DISABLED();
  const viewer = await getRifaViewer();
  if (!viewer) return RIFA_UNAUTHORIZED();
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return rifaJson({ error: "Revisa los datos de la rifa." }, 400);
  const b = parsed.data;
  let drawAt: string;
  try { drawAt = colombiaDateTimeToIso(b.drawAt); } catch { return rifaJson({ error: "Revisa la fecha y hora del sorteo." }, 400); }
  const args = {
    p_actor: viewer.id, p_name: b.name, p_prize_kind: b.prizeKind,
    p_prize_cop: b.prizeKind === "dinero" ? b.prizeCop : null,
    p_prize_text: b.prizeKind === "texto" ? b.prizeText : null,
    p_number_count: b.numberCount, p_price_cop: b.priceCop, p_lottery_name: b.lotteryName, p_digits_rule: b.digitsRule,
    p_draw_at: drawAt, p_visibility: b.visibility, p_payment_method: b.paymentMethod,
    p_payment_account: b.paymentAccount, p_payment_holder: b.paymentHolder,
  };
  // El enlace sale del nombre (158). SQL serializa nombres iguales, pero un
  // sufijo generado («iphone-6-2») puede chocar con otro nombre que ya lo trae:
  // ante esa colisión única se vuelve a pedir el enlace, hasta 3 veces.
  let result = await rifaRpc<{ id: string; slug: string }>("rifa_create_v1", args);
  for (let i = 0; i < 2 && result.error?.code === "23505"; i++) result = await rifaRpc<{ id: string; slug: string }>("rifa_create_v1", args);
  const { data, error } = result;
  if (error || !data) return rifaError(error ?? {});
  return rifaJson({ ok: true, id: data.id, slug: data.slug }, 201);
}
