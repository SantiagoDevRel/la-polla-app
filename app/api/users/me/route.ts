// app/api/users/me/route.ts — Endpoint para perfil del usuario autenticado
// GET: retorna stats del perfil (usa admin client para bypass RLS)
// PATCH: actualiza display_name en public.users
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { onboardingCookieOptions } from "@/lib/supabase/cookie-options";
import { linkReferralFromCookie } from "@/lib/casa/referrals";
import { REFERRAL_COOKIE } from "@/lib/casa/referrals-shared";
import { z } from "zod";
import { PAYOUT_METHODS, payoutAccountError } from "@/lib/payout/account-format";
import {
  DISPLAY_NAME_MAX,
  DISPLAY_NAME_MIN,
  isValidDisplayName,
  needsName,
} from "@/lib/users/needs-name";

// Métodos y formato por método: lib/payout/account-format.ts (el mismo
// que usa el editor de /perfil).
const PAYOUT_ACCOUNT_TYPES = ["ahorros", "corriente"] as const;
const PROFILE_COLUMNS = "id, profile_revision, display_name, whatsapp_number, avatar_url, is_admin, default_payout_method, default_payout_account, default_payout_account_name, default_payout_account_type, default_payout_set_at";
function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

const updateSchema = z.object({
  expected_user_id: z.string().uuid().optional(),
  expected_revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  display_name: z
    .string()
    .trim()
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
    if (!user) return privateJson({ error: "No autorizado" }, 401);

    const admin = createAdminClient();

    const { data: userData, error: profileError } = await admin
      .from("users")
      .select(PROFILE_COLUMNS)
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!userData) return privateJson({ error: "No encontramos tu perfil. Reintenta para cargarlo." }, 404);

    // ── Stats ────────────────────────────────────────────────────────────
    // Se leen del modelo NUEVO (casa_entries / casa_picks). Antes salian de
    // polla_participants + predictions, o sea del P2P retirado: el perfil
    // mostraba numeros de un producto que el usuario ya no puede usar, y
    // peor, que no coincidian con nada de lo que veia en /casa.
    //
    // El historico P2P no se perdio — vive igual en sus tablas y se puede
    // consultar entrando a /pollas por URL directa. Simplemente dejo de ser
    // lo que el perfil resume.
    const { data: entries, error: entriesError } = await admin
      .from("casa_entries")
      .select("id, polla_id, status")
      .eq("user_id", user.id) // ← filtro explicito (ver TODO auth.uid())
      .eq("status", "pagada");
    if (entriesError) throw entriesError;

    const { count: picksCount, error: countError } = await admin
      .from("casa_picks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);
    if (countError) throw countError;

    // Puntos totales acumulados en las pollas de la casa.
    const { data: puntos, error: pointsError } = await admin
      .from("casa_picks")
      .select("points_earned")
      .eq("user_id", user.id)
      .gt("points_earned", 0);
    if (pointsError) throw pointsError;

    const totalPoints = (puntos || []).reduce(
      (sum: number, r: { points_earned: number | null }) => sum + (r.points_earned || 0),
      0,
    );

    // (2026-09-19) «Actividad reciente» salió del Perfil por decisión del dueño
    // y con ella la consulta que la alimentaba: nadie la leía.

    return privateJson({
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
    });
  } catch (error) {
    console.error("Error obteniendo perfil:", (error as { name?: string }).name ?? "DatabaseError");
    return privateJson({ error: "No pudimos cargar tu perfil. Reintenta." }, 500);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return privateJson({ error: "No autorizado" }, 401);
    }

    const body = await request.json();
    const parsed = updateSchema.safeParse(body);

    if (!parsed.success) {
      return privateJson(
        { error: parsed.error.issues[0].message },
        400
      );
    }
    if (parsed.data.expected_user_id && parsed.data.expected_user_id !== user.id) {
      return privateJson({ code: "SESSION_CHANGED", error: "Cambiaste de cuenta. Revisa tu perfil y vuelve a la cuenta original para confirmar tus cambios." }, 412);
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
      if (method && account) {
        const formatError = payoutAccountError(method, account);
        if (formatError) return privateJson({ error: formatError }, 400);
      }
      updateData.default_payout_method = method;
      updateData.default_payout_account = account;
      // Solo Bancolombia lleva titular y tipo de cuenta. Nequi y llave se
      // identifican por sí solas; «otro» guarda banco + cuenta en account.
      const isBank = method === "bancolombia";
      updateData.default_payout_account_name = isBank ? name : null;
      updateData.default_payout_account_type = isBank ? accountType : null;
      updateData.default_payout_set_at = account
        ? new Date().toISOString()
        : null;
    }

    if (Object.keys(updateData).length === 0) {
      return privateJson({ error: "Nada que actualizar" }, 400);
    }

    // Keep the existing authorized server writer. The verified session owns
    // the explicit id filter; return the row actually affected by the update.
    const admin = createAdminClient();
    let update = admin
      .from("users")
      .update(updateData)
      .eq("id", user.id);
    if (parsed.data.expected_revision !== undefined) update = update.eq("profile_revision", parsed.data.expected_revision);
    const { data: fresh, error } = await update
      .select(PROFILE_COLUMNS)
      .maybeSingle();

    if (error) throw error;
    if (!fresh) return parsed.data.expected_revision !== undefined
      ? privateJson({ code: "PROFILE_CHANGED", error: "Tu perfil cambió mientras guardabas. Conservamos tus cambios; reintenta para comprobar el perfil actual." }, 409)
      : privateJson({ error: "No encontramos tu perfil. Reintenta para cargarlo." }, 404);

    // Cookie de fast-path para el middleware: si después del update
    // tenemos display_name + avatar_url, próximos navs no tienen que
    // re-pegarle a public.users. Use the authoritative update result.
    const response = privateJson({ success: true, profile: fresh });
    if (fresh && !needsName(fresh.display_name) && fresh.avatar_url) {
      response.cookies.set("lp_onb", "1", onboardingCookieOptions());
      // Invitaciones (migración 135): con el perfil completo, quien llegó por
      // un enlace queda vinculado aunque pague otro día desde otro navegador.
      const referral = await linkReferralFromCookie(user.id, request.cookies.get(REFERRAL_COOKIE)?.value);
      if (referral.clearCookie) response.cookies.delete(REFERRAL_COOKIE);
    } else {
      // Defense-in-depth: si por alguna razón el row quedó con perfil
      // incompleto post-update (ej. user borró avatar via otro flow),
      // limpiar la cookie para que el middleware vuelva a hacer la
      // query y aplique el gate de /onboarding.
      response.cookies.delete("lp_onb");
    }
    return response;
  } catch (error) {
    console.error("Error actualizando perfil:", (error as { name?: string }).name ?? "DatabaseError");
    return privateJson({ error: "No pudimos confirmar el guardado del perfil." }, 500);
  }
}
