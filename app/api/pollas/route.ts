// app/api/pollas/route.ts — CRUD de pollas (crear y listar pollas del usuario)
// Soporta 2 modos de pago: admin_collects, digital_pool
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

// Enum de modos de pago válidos en la DB
const paymentModes = ["admin_collects", "digital_pool"] as const;

// Schema base para crear una polla
const createPollaSchema = z
  .object({
    name: z.string().min(3, "El nombre debe tener al menos 3 caracteres"),
    description: z.string().optional(),
    tournament: z.string().min(1, "El torneo es requerido"),
    scope: z.enum(["full", "group_stage", "knockouts", "custom"]).default("full"),
    type: z.enum(["open", "closed"]).default("closed"),
    buyInAmount: z.number().min(0, "El valor de entrada no puede ser negativo"),
    paymentMode: z.enum(paymentModes),
    // Solo requerido cuando paymentMode === 'admin_collects'
    adminPaymentInstructions: z.string().optional(),
  })
  // Validación condicional: si el modo es admin_collects, las instrucciones son obligatorias
  .refine(
    (data) => {
      if (data.paymentMode === "admin_collects") {
        return (
          data.adminPaymentInstructions !== undefined &&
          data.adminPaymentInstructions.trim().length > 0
        );
      }
      return true;
    },
    {
      message: "Las instrucciones de pago son obligatorias cuando el admin recoge el pozo",
      path: ["adminPaymentInstructions"],
    }
  )
  // Validación: buy_in_amount debe ser >= 1000
  .refine(
    (data) => data.buyInAmount >= 1000,
    {
      message: "El valor minimo es $1.000",
      path: ["buyInAmount"],
    }
  );

// GET — Listar pollas del usuario
export async function GET() {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // Listar pollas donde el usuario es participante o creador
    const { data: participantPollaIds } = await supabase
      .from("polla_participants")
      .select("polla_id")
      .eq("user_id", user.id);

    const pollaIds = participantPollaIds?.map((p) => p.polla_id) || [];

    const { data: pollas, error } = await supabase
      .from("pollas")
      .select("*")
      .or(`created_by.eq.${user.id}${pollaIds.length > 0 ? `,id.in.(${pollaIds.join(",")})` : ""}`)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ pollas });
  } catch (error) {
    console.error("Error listando pollas:", error);
    return NextResponse.json({ error: "Error al listar pollas" }, { status: 500 });
  }
}

// POST — Crear nueva polla con modo de pago seleccionado
export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = createPollaSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    // Generar slug URL-friendly a partir del nombre
    const slug = parsed.data.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

    // Insertar la polla con los campos del modo de pago
    const { data: polla, error } = await supabase
      .from("pollas")
      .insert({
        name: parsed.data.name,
        description: parsed.data.description || "",
        slug,
        tournament: parsed.data.tournament,
        scope: parsed.data.scope,
        type: parsed.data.type,
        buy_in_amount: parsed.data.buyInAmount,
        currency: "COP",
        payment_mode: parsed.data.paymentMode,
        admin_payment_instructions:
          parsed.data.paymentMode === "admin_collects"
            ? parsed.data.adminPaymentInstructions
            : null,
        created_by: user.id,
      })
      .select()
      .single();

    if (error) {
      // Slug duplicado — agregar sufijo aleatorio
      if (error.code === "23505" && error.message.includes("slug")) {
        const uniqueSlug = `${slug}-${Math.random().toString(36).substring(2, 6)}`;
        const { data: retryPolla, error: retryError } = await supabase
          .from("pollas")
          .insert({
            name: parsed.data.name,
            description: parsed.data.description || "",
            slug: uniqueSlug,
            tournament: parsed.data.tournament,
            scope: parsed.data.scope,
            type: parsed.data.type,
            buy_in_amount: parsed.data.buyInAmount,
            currency: "COP",
            payment_mode: parsed.data.paymentMode,
            admin_payment_instructions:
              parsed.data.paymentMode === "admin_collects"
                ? parsed.data.adminPaymentInstructions
                : null,
            created_by: user.id,
          })
          .select()
          .single();

        if (retryError) throw retryError;

        // Agregar al creador como participante admin
        await supabase.from("polla_participants").insert({
          polla_id: retryPolla.id,
          user_id: user.id,
          role: "admin",
          status: "approved",
          paid: true,
        });

        return NextResponse.json({ polla: retryPolla }, { status: 201 });
      }
      throw error;
    }

    // Agregar al creador como participante admin de la polla
    await supabase.from("polla_participants").insert({
      polla_id: polla.id,
      user_id: user.id,
      role: "admin",
      status: "approved",
      paid: true,
    });

    return NextResponse.json({ polla }, { status: 201 });
  } catch (error) {
    console.error("Error creando polla:", error);
    return NextResponse.json({ error: "Error al crear la polla" }, { status: 500 });
  }
}
