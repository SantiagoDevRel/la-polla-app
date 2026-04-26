// app/api/pollas/route.ts — CRUD de pollas (crear y listar pollas del usuario)
// Modos soportados: admin_collects, pay_winner.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
// Admin client used for polla_participants queries because auth.uid()
// propagation from SSR cookies to PostgREST is not working. Every
// polla_participants query below MUST include an explicit user-scoped
// filter (user.id or polla_id list scoped to user's pollas).
import { createAdminClient } from "@/lib/supabase/admin";
import { TERMINAL_MATCH_STATUSES } from "@/lib/matches/constants";
import { generateUniqueJoinCode } from "@/lib/pollas/join-code";
import { z } from "zod";

// Modos de pago válidos (payment_mode en la DB es varchar, no enum)
const paymentModes = ["admin_collects", "pay_winner"] as const;

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
    const admin = createAdminClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // Listar pollas donde el usuario es participante o creador.
    // NOTE: we fetch both sets in two separate queries and merge in JS.
    // The previous implementation used a single PostgREST
    // .or(`created_by.eq.<uuid>,id.in.(<uuid>,<uuid>,...)`) filter, but the
    // `.in.()` nested inside `.or()` silently dropped the participant-only
    // pollas in practice — likely a commas-inside-parens parsing quirk when
    // the IN list contains UUIDs.
    const { data: participantPollaIds } = await admin
      .from("polla_participants")
      .select("polla_id")
      .eq("user_id", user.id);

    const pollaIds = participantPollaIds?.map((p) => p.polla_id) || [];

    const { data: createdPollas, error: errCreated } = await supabase
      .from("pollas")
      .select("*")
      .eq("created_by", user.id);

    if (errCreated) throw errCreated;

    let participantPollas: NonNullable<typeof createdPollas> = [];
    if (pollaIds.length > 0) {
      const { data: pp, error: errParticipant } = await supabase
        .from("pollas")
        .select("*")
        .in("id", pollaIds);
      if (errParticipant) {
        console.error("[/api/pollas] participant fetch error:", errParticipant);
      }
      participantPollas = pp || [];
    }

    // Merge, de-dup by id (user may be both creator and participant)
    type PollaRow = NonNullable<typeof createdPollas>[number];
    const pollaMap = new Map<string, PollaRow>();
    (createdPollas || []).forEach((p) => pollaMap.set(p.id, p));
    participantPollas.forEach((p) => {
      if (!pollaMap.has(p.id)) pollaMap.set(p.id, p);
    });
    const pollas = Array.from(pollaMap.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    // Compute effective_status: a polla is effectively ended if every match_id is finished
    // or its scheduled_at is in the past. Handles the case where the auto-close trigger
    // (migration 008) hasn't run or isn't applied.
    const allMatchIds = Array.from(
      new Set((pollas || []).flatMap((p) => (p.match_ids as string[] | null) || []))
    );
    const matchById = new Map<string, { status: string }>();
    if (allMatchIds.length > 0) {
      const { data: matchRows } = await supabase
        .from("matches")
        .select("id, status")
        .in("id", allMatchIds);
      for (const m of matchRows || []) {
        matchById.set(m.id, { status: m.status });
      }
    }
    // TERMINAL_MATCH_STATUSES lives in lib/matches/constants — shared with
    // the public endpoint.
    const effectiveStatus = (p: { status: string; match_ids: string[] | null }): string => {
      if (p.status === "ended") return "ended";
      if (p.status !== "active") return p.status;
      const ids = p.match_ids || [];
      if (ids.length === 0) return p.status;
      const allDone = ids.every((id) => {
        const m = matchById.get(id);
        if (!m) return false;
        return TERMINAL_MATCH_STATUSES.has(m.status);
      });
      return allDone ? "ended" : "active";
    };

    // Winner info for any polla whose effective_status is 'ended'
    const withEffective = (pollas || []).map((p) => ({ ...p, effective_status: effectiveStatus(p) }));
    const endedIds = withEffective.filter((p) => p.effective_status === "ended").map((p) => p.id);
    let winnersByPolla: Record<string, { display_name: string; total_points: number }> = {};
    if (endedIds.length > 0) {
      // endedIds is already scoped to pollas this user belongs to (creator
      // or participant), so admin-client use is safe.
      const { data: winners } = await admin
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

    // Participant counts for each polla — previously missing from this
    // endpoint, so the UI silently rendered "0 participantes".
    // allPollaIds is scoped to pollas this user belongs to, so admin-client
    // use is safe.
    const allPollaIds = (pollas || []).map((p) => p.id);
    const participantCountByPolla: Record<string, number> = {};
    if (allPollaIds.length > 0) {
      const { data: participantRows } = await admin
        .from("polla_participants")
        .select("polla_id")
        .in("polla_id", allPollaIds);
      for (const row of participantRows || []) {
        participantCountByPolla[row.polla_id] =
          (participantCountByPolla[row.polla_id] || 0) + 1;
      }
    }

    // User's rank + total_points in each polla (cached on polla_participants
    // by the on_match_finished trigger + lib/scoring.ts recompute path).
    // eq(user_id) is the required user-scope guard when using admin.
    const myMembershipByPolla: Record<
      string,
      { rank: number | null; total_points: number }
    > = {};
    if (allPollaIds.length > 0) {
      const { data: myMembership } = await admin
        .from("polla_participants")
        .select("polla_id, rank, total_points")
        .eq("user_id", user.id)
        .in("polla_id", allPollaIds);
      for (const m of myMembership || []) {
        myMembershipByPolla[m.polla_id] = {
          rank: m.rank ?? null,
          total_points: m.total_points ?? 0,
        };
      }
    }

    const enriched = withEffective.map((p) => {
      const myRow = myMembershipByPolla[p.id];
      const matchIds = (p.match_ids as string[] | null) || [];
      const finishedCount = matchIds.filter((id) => {
        const m = matchById.get(id);
        return m ? TERMINAL_MATCH_STATUSES.has(m.status) : false;
      }).length;
      return {
        ...p,
        winner: winnersByPolla[p.id] || null,
        participant_count: participantCountByPolla[p.id] || 0,
        total_matches: matchIds.length,
        finished_matches: finishedCount,
        user_rank: myRow?.rank ?? null,
        user_total_points: myRow?.total_points ?? 0,
        is_leader: myRow?.rank === 1,
      };
    });

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

    // Generar el código de invitación antes del insert. generateUniqueJoinCode
    // reintenta internamente hasta 10 veces frente a colisiones en pollas.join_code.
    // Si falla tras los reintentos se aborta la creación con un 500 explicito.
    let joinCode: string;
    try {
      joinCode = await generateUniqueJoinCode(createAdminClient());
    } catch (codeErr) {
      console.error("[pollas POST] generateUniqueJoinCode failed:", codeErr);
      return NextResponse.json(
        { error: "No se pudo generar el código de invitación. Intenta de nuevo." },
        { status: 500 }
      );
    }

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
        join_code: joinCode,
      })
      .select()
      .single();

    if (error) {
      // Slug duplicado, agregar sufijo aleatorio. Reutilizamos el joinCode
      // ya generado porque el insert fallo por el slug, no por el codigo.
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
            join_code: joinCode,
          })
          .select()
          .single();

        if (retryError) throw retryError;

        // Creator auto-join (retry path).
        // Admin is always paid=true on creation regardless of payment_mode.
        // The participant payment gate (paid=false) only applies to invitees
        // joining via /api/pollas/[slug]/join. The admin counts toward pozo
        // and shows up as paid in the Pagos tab from day one.
        try {
          const { error: joinError } = await supabase.from("polla_participants").insert({
            polla_id: retryPolla.id,
            user_id: user.id,
            role: "admin",
            status: "approved",
            payment_status: "approved",
            paid: true,
            paid_at: new Date().toISOString(),
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

    // Creator auto-join — wrapped so participant-insert failures don't surface
    // as "Error al crear la polla".
    // Admin is always paid=true on creation regardless of payment_mode. The
    // participant payment gate (paid=false) only applies to invitees joining
    // via /api/pollas/[slug]/join. The admin counts toward pozo and shows up
    // as paid in the Pagos tab from day one.
    try {
      const { error: joinError } = await supabase.from("polla_participants").insert({
        polla_id: polla.id,
        user_id: user.id,
        role: "admin",
        status: "approved",
        payment_status: "approved",
        paid: true,
        paid_at: new Date().toISOString(),
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
