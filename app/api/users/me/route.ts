// app/api/users/me/route.ts — Endpoint para perfil del usuario autenticado
// GET: retorna stats del perfil (usa admin client para bypass RLS)
// PATCH: actualiza display_name en public.users
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
import {
  DISPLAY_NAME_MAX,
  DISPLAY_NAME_MIN,
  isValidDisplayName,
  needsName,
} from "@/lib/users/needs-name";

// Solo 3 métodos soportados: nequi, bancolombia, otro. Removidos
// daviplata + transfiya — el verifier AI se simplifica con menos
// variantes y hay menor riesgo de mismatch.
const PAYOUT_METHODS = ["nequi", "bancolombia", "otro"] as const;
const PAYOUT_ACCOUNT_TYPES = ["ahorros", "corriente"] as const;

const updateSchema = z.object({
  display_name: z
    .string()
    .min(DISPLAY_NAME_MIN, `El nombre debe tener al menos ${DISPLAY_NAME_MIN} caracteres`)
    .max(DISPLAY_NAME_MAX, `El nombre debe tener máximo ${DISPLAY_NAME_MAX} caracteres`)
    .refine(
      (v) => isValidDisplayName(v),
      "El nombre no puede ser tu número de teléfono",
    )
    .optional(),
  avatar_url: z.string().max(50).optional(),
  default_payout_method: z.enum(PAYOUT_METHODS).nullable().optional(),
  default_payout_account: z.string().trim().min(3).max(120).nullable().optional(),
  /** Nombre como aparece en la cuenta. Opcional. */
  default_payout_account_name: z.string().trim().min(2).max(120).nullable().optional(),
  /** Tipo de cuenta. Solo aplica para bancolombia/otro; null para nequi. */
  default_payout_account_type: z.enum(PAYOUT_ACCOUNT_TYPES).nullable().optional(),
});

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const admin = createAdminClient();

    const { data: userData } = await admin
      .from("users")
      .select("display_name, whatsapp_number, avatar_url, is_admin, default_payout_method, default_payout_account, default_payout_account_name, default_payout_account_type, default_payout_set_at")
      .eq("id", user.id)
      .single();

    // ── Stats ────────────────────────────────────────────────────────────
    // Se leen del modelo NUEVO (casa_entries / casa_picks). Antes salian de
    // polla_participants + predictions, o sea del P2P retirado: el perfil
    // mostraba numeros de un producto que el usuario ya no puede usar, y
    // peor, que no coincidian con nada de lo que veia en /casa.
    //
    // El historico P2P no se perdio — vive igual en sus tablas y se puede
    // consultar entrando a /pollas por URL directa. Simplemente dejo de ser
    // lo que el perfil resume.
    const { data: entries } = await admin
      .from("casa_entries")
      .select("id, polla_id, status")
      .eq("user_id", user.id) // ← filtro explicito (ver TODO auth.uid())
      .eq("status", "pagada");

    const { count: picksCount } = await admin
      .from("casa_picks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    // Puntos totales acumulados en las pollas de la casa.
    const { data: puntos } = await admin
      .from("casa_picks")
      .select("points_earned")
      .eq("user_id", user.id)
      .gt("points_earned", 0);

    const totalPoints = (puntos || []).reduce(
      (sum: number, r: { points_earned: number | null }) => sum + (r.points_earned || 0),
      0,
    );

    // Lo ultimo que sumo puntos, para "actividad reciente".
    const { data: recentPicks } = await admin
      .from("casa_picks")
      .select("points_earned, matches(home_team, away_team), casa_pollas(name)")
      .eq("user_id", user.id)
      .gt("points_earned", 0)
      .order("updated_at", { ascending: false })
      .limit(3);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recentActivity = ((recentPicks || []) as any[]).map((r) => {
      const match = Array.isArray(r.matches) ? r.matches[0] : r.matches;
      const polla = Array.isArray(r.casa_pollas) ? r.casa_pollas[0] : r.casa_pollas;
      return {
        matchName: match ? `${match.home_team} vs ${match.away_team}` : "Pregunta",
        pollaName: polla?.name || "Polla",
        pointsEarned: r.points_earned || 0,
      };
    });

    return NextResponse.json({
      profile: userData,
      stats: {
        pollasCount: entries?.length || 0,
        predictionsCount: picksCount || 0,
        // `bestRank` no aplica en la casa: cada polla es independiente y no
        // hay un ranking global. Se manda el puntaje acumulado, que es el
        // numero que la gente si reconoce.
        bestRank: null,
        totalPoints,
      },
      recentActivity,
    });
  } catch (error) {
    console.error("Error obteniendo perfil:", error);
    return NextResponse.json({ error: "Error al obtener perfil" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = updateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const updateData: Record<string, string | null> = {};
    if (parsed.data.display_name) updateData.display_name = parsed.data.display_name;
    if (parsed.data.avatar_url) updateData.avatar_url = parsed.data.avatar_url;

    // Payout default: 4 campos viajan juntos (method, account, name,
    // type). Permitimos null explícito para borrar la cuenta guardada.
    const wantsPayout =
      parsed.data.default_payout_method !== undefined ||
      parsed.data.default_payout_account !== undefined ||
      parsed.data.default_payout_account_name !== undefined ||
      parsed.data.default_payout_account_type !== undefined;
    if (wantsPayout) {
      const method = parsed.data.default_payout_method ?? null;
      const account = parsed.data.default_payout_account ?? null;
      const name = parsed.data.default_payout_account_name ?? null;
      const accountType = parsed.data.default_payout_account_type ?? null;
      updateData.default_payout_method = method;
      updateData.default_payout_account = account;
      // Para nequi forzamos name y type a null — Nequi solo se identifica
      // por celular y no tiene ahorros/corriente.
      updateData.default_payout_account_name = method === "nequi" ? null : name;
      updateData.default_payout_account_type = method === "nequi" ? null : accountType;
      updateData.default_payout_set_at = account
        ? new Date().toISOString()
        : null;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });
    }

    // Admin client porque users_update_own gatea por auth.uid() = id, y
    // auth.uid() llega NULL al PostgREST. Sin esto, el UPDATE no afecta
    // ninguna fila (silencioso) y la UI confirma "guardado" pero el
    // perfil no cambia. .eq("id", user.id) sigue siendo el scope:
    // user.id viene del session getUser() validado arriba.
    const admin = createAdminClient();
    const { error } = await admin
      .from("users")
      .update(updateData)
      .eq("id", user.id);

    if (error) throw error;

    // Cookie de fast-path para el middleware: si después del update
    // tenemos display_name + avatar_url, próximos navs no tienen que
    // re-pegarle a public.users. Lee el row entero para chequear con
    // los valores AUTORITATIVOS post-update (el cliente puede haber
    // mandado solo uno de los dos campos).
    const { data: fresh } = await admin
      .from("users")
      .select("display_name, avatar_url")
      .eq("id", user.id)
      .maybeSingle();

    const response = NextResponse.json({ success: true });
    if (fresh && !needsName(fresh.display_name) && fresh.avatar_url) {
      response.cookies.set("lp_onb", "1", {
        httpOnly: true,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30,
        path: "/",
      });
    } else {
      // Defense-in-depth: si por alguna razón el row quedó con perfil
      // incompleto post-update (ej. user borró avatar via otro flow),
      // limpiar la cookie para que el middleware vuelva a hacer la
      // query y aplique el gate de /onboarding.
      response.cookies.delete("lp_onb");
    }
    return response;
  } catch (error) {
    console.error("Error actualizando perfil:", error);
    return NextResponse.json({ error: "Error al actualizar perfil" }, { status: 500 });
  }
}
