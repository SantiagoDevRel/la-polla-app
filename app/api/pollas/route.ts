// app/api/pollas/route.ts — CRUD de pollas (crear y listar pollas del usuario)
// Soporta 2 modos de pago: admin_collects, digital_pool
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

// Modos de pago válidos (payment_mode en la DB es varchar, no enum)
const paymentModes = ["admin_collects", "digital_pool", "pay_winner"] as const;

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
    matchIds: z.array(z.string()).optional(),
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

    // Compute effective_status: a polla is effectively ended if every match_id is finished
    // or its scheduled_at is in the past. Handles the case where the auto-close trigger
    // (migration 008) hasn't run or isn't applied.
    const allMatchIds = Array.from(
      new Set((pollas || []).flatMap((p) => (p.match_ids as string[] | null) || []))
    );
    const matchById = new Map<string, { status: string; scheduled_at: string }>();
    if (allMatchIds.length > 0) {
      const { data: matchRows } = await supabase
        .from("matches")
        .select("id, status, scheduled_at")
        .in("id", allMatchIds);
      for (const m of matchRows || []) {
        matchById.set(m.id, { status: m.status, scheduled_at: m.scheduled_at });
      }
    }
    const nowMs = Date.now();
    const effectiveStatus = (p: { status: string; match_ids: string[] | null }): string => {
      if (p.status === "ended") return "ended";
      if (p.status !== "active") return p.status;
      const ids = p.match_ids || [];
      if (ids.length === 0) return p.status;
      const allDone = ids.every((id) => {
        const m = matchById.get(id);
        if (!m) return false;
        return m.status === "finished" || new Date(m.scheduled_at).getTime() < nowMs;
      });
      return allDone ? "ended" : "active";
    };

    // Winner info for any polla whose effective_status is 'ended'
    const withEffective = (pollas || []).map((p) => ({ ...p, effective_status: effectiveStatus(p) }));
    const endedIds = withEffective.filter((p) => p.effective_status === "ended").map((p) => p.id);
    let winnersByPolla: Record<string, { display_name: string; total_points: number }> = {};
    if (endedIds.length > 0) {
      const { data: winners } = await supabase
        .from("polla_participants")
        .select("polla_id, total_points, users:user_id ( display_name )")
        .in("polla_id", endedIds)
        .eq("rank", 1);
      winnersByPolla = Object.fromEntries(
        (winners || []).map((w: { polla_id: string; total_points: number; users: { display_name: string } | { display_name: string }[] | null }) => {
          const u = Array.isArray(w.users) ? w.users[0] : w.users;
          return [w.polla_id, { display_name: u?.display_name || "Ganador", total_points: w.total_points }];
        })
      );
    }

    const enriched = withEffective.map((p) => ({ ...p, winner: winnersByPolla[p.id] || null }));

    return NextResponse.json({ pollas: enriched });
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

    // Insertar la polla con los campos del modo de pago + match_ids
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
        match_ids: parsed.data.matchIds || null,
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
            match_ids: parsed.data.matchIds || null,
            created_by: user.id,
          })
          .select()
          .single();

        if (retryError) throw retryError;

        // Creator auto-join (retry path). Digital-pool creators must pay like
        // anyone else — they land in pending until they pay through the app.
        try {
          const creatorPending =
            parsed.data.paymentMode === "digital_pool" &&
            parsed.data.buyInAmount > 0;
          const { error: joinError } = await supabase.from("polla_participants").insert({
            polla_id: retryPolla.id,
            user_id: user.id,
            role: "admin",
            status: "approved",
            payment_status: creatorPending ? "pending" : "approved",
            paid: !creatorPending,
          });
          if (joinError) {
            console.error("Creator auto-join failed (retry) for polla", retryPolla.id, joinError);
          }
        } catch (joinEx) {
          console.error("Creator auto-join threw (retry) for polla", retryPolla.id, joinEx);
        }

        return NextResponse.json({ polla: retryPolla }, { status: 201 });
      }
      throw error;
    }

    // Creator auto-join — wrapped so participant-insert failures don't surface as
    // "Error al crear la polla". Digital-pool creators must pay like anyone else;
    // for every other mode the creator starts already approved/paid.
    try {
      const creatorPending =
        parsed.data.paymentMode === "digital_pool" &&
        parsed.data.buyInAmount > 0;
      const { error: joinError } = await supabase.from("polla_participants").insert({
        polla_id: polla.id,
        user_id: user.id,
        role: "admin",
        status: "approved",
        payment_status: creatorPending ? "pending" : "approved",
        paid: !creatorPending,
      });
      if (joinError) {
        console.error("Creator auto-join failed for polla", polla.id, joinError);
      }
    } catch (joinEx) {
      console.error("Creator auto-join threw for polla", polla.id, joinEx);
    }

    return NextResponse.json({ polla }, { status: 201 });
  } catch (error) {
    const err = error as { message?: string; code?: string; details?: string };
    console.error("Error creando polla:", {
      message: err.message,
      code: err.code,
      details: err.details,
    });
    return NextResponse.json({ error: "Error al crear la polla" }, { status: 500 });
  }
}
