// app/api/pollas/[slug]/payments/route.ts — Gestión de pagos para pollas con mode admin_collects
// POST: Participante sube comprobante de pago
// PATCH: Admin aprueba o rechaza un pago
// GET: Lista pagos pendientes/aprobados/rechazados (admin ve todos, participante ve los suyos)
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

// Schema para subir comprobante de pago (participante)
const submitPaymentSchema = z.object({
  paymentNote: z.string().min(1, "Debes incluir una referencia o nota del pago"),
  paymentProofUrl: z.string().optional(),
  paidAmount: z.number().positive("El monto pagado debe ser positivo"),
});

// Schema para aprobar/rechazar pago (admin)
const reviewPaymentSchema = z.object({
  participantId: z.string().uuid("ID de participante inválido"),
  action: z.enum(["approve", "reject"]),
});

// GET — Listar pagos de la polla (admin ve todos, participante ve los suyos)
export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // Obtener la polla por slug
    const { data: polla, error: pollaError } = await supabase
      .from("pollas")
      .select("id, payment_mode, admin_payment_instructions, buy_in_amount, currency")
      .eq("slug", params.slug)
      .single();

    if (pollaError || !polla) {
      return NextResponse.json({ error: "Polla no encontrada" }, { status: 404 });
    }

    // Verificar que el usuario es participante
    const { data: myParticipant } = await supabase
      .from("polla_participants")
      .select("id, role")
      .eq("polla_id", polla.id)
      .eq("user_id", user.id)
      .single();

    if (!myParticipant) {
      return NextResponse.json({ error: "No eres participante" }, { status: 403 });
    }

    const isAdmin = myParticipant.role === "admin";

    // Todos los participantes ven la lista completa — el pozo es público.
    const { data: payments, error: paymentsError } = await supabase
      .from("polla_participants")
      .select(`
        id,
        user_id,
        role,
        status,
        paid,
        paid_at,
        paid_amount,
        payment_note,
        payment_proof_url,
        users:user_id (
          id,
          display_name,
          whatsapp_number
        )
      `)
      .eq("polla_id", polla.id);

    if (paymentsError) throw paymentsError;

    // Predictions submitted per user — used by the Organizer panel to show
    // "X de Y han pronosticado". Cheap aggregate.
    const { data: preds } = await supabase
      .from("predictions")
      .select("user_id")
      .eq("polla_id", polla.id);
    const predictionsByUser: Record<string, number> = {};
    for (const p of preds ?? []) {
      const uid = (p as { user_id: string }).user_id;
      predictionsByUser[uid] = (predictionsByUser[uid] ?? 0) + 1;
    }

    return NextResponse.json({
      payments: payments || [],
      pollaPaymentInfo: {
        adminPaymentInstructions: polla.admin_payment_instructions,
        buyInAmount: polla.buy_in_amount,
        currency: polla.currency,
        paymentMode: polla.payment_mode,
      },
      isAdmin,
      predictionsByUser,
    });
  } catch (error) {
    console.error("Error listando pagos:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

// POST — Participante sube comprobante de pago
export async function POST(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = submitPaymentSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    // Obtener la polla
    const { data: polla, error: pollaError } = await supabase
      .from("pollas")
      .select("id, payment_mode")
      .eq("slug", params.slug)
      .single();

    if (pollaError || !polla) {
      return NextResponse.json({ error: "Polla no encontrada" }, { status: 404 });
    }

    if (polla.payment_mode !== "admin_collects") {
      return NextResponse.json(
        { error: "Esta polla no requiere comprobante de pago" },
        { status: 400 }
      );
    }

    // Verificar que es participante
    const { data: participant, error: partError } = await supabase
      .from("polla_participants")
      .select("id, paid, status")
      .eq("polla_id", polla.id)
      .eq("user_id", user.id)
      .single();

    if (partError || !participant) {
      return NextResponse.json({ error: "No eres participante" }, { status: 403 });
    }

    if (participant.paid) {
      return NextResponse.json(
        { error: "Tu pago ya fue aprobado" },
        { status: 409 }
      );
    }

    // Grabar el comprobante. status ya no se usa como cola de revisión —
    // el admin review filtra por (payment_note != null AND paid = false).
    const { error: updateError } = await supabase
      .from("polla_participants")
      .update({
        payment_note: parsed.data.paymentNote,
        payment_proof_url: parsed.data.paymentProofUrl || null,
        paid_amount: parsed.data.paidAmount,
      })
      .eq("id", participant.id);

    if (updateError) throw updateError;

    return NextResponse.json({ message: "Comprobante enviado" }, { status: 200 });
  } catch (error) {
    console.error("Error subiendo comprobante:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

// PATCH — Admin aprueba o rechaza un pago
export async function PATCH(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = reviewPaymentSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    // Obtener la polla
    const { data: polla, error: pollaError } = await supabase
      .from("pollas")
      .select("id, payment_mode")
      .eq("slug", params.slug)
      .single();

    if (pollaError || !polla) {
      return NextResponse.json({ error: "Polla no encontrada" }, { status: 404 });
    }

    if (polla.payment_mode !== "admin_collects") {
      return NextResponse.json(
        { error: "Esta polla no usa el modo admin_collects" },
        { status: 400 }
      );
    }

    // Verificar que quien hace la petición es admin de la polla
    const { data: adminParticipant } = await supabase
      .from("polla_participants")
      .select("role")
      .eq("polla_id", polla.id)
      .eq("user_id", user.id)
      .single();

    if (!adminParticipant || adminParticipant.role !== "admin") {
      return NextResponse.json(
        { error: "Solo el admin puede aprobar o rechazar pagos" },
        { status: 403 }
      );
    }

    // Aprobar o rechazar el pago. El `status` del participante no se toca —
    // reject solo limpia el comprobante para que el usuario pueda re-subirlo.
    const isApprove = parsed.data.action === "approve";
    const updatePayload = isApprove
      ? { paid: true, paid_at: new Date().toISOString() }
      : { paid: false, paid_at: null, payment_note: null, payment_proof_url: null };
    const { error: updateError } = await supabase
      .from("polla_participants")
      .update(updatePayload)
      .eq("id", parsed.data.participantId)
      .eq("polla_id", polla.id);

    if (updateError) throw updateError;

    return NextResponse.json({
      message: isApprove ? "Pago aprobado" : "Pago rechazado",
    });
  } catch (error) {
    console.error("Error revisando pago:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
