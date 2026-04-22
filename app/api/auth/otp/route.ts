// app/api/auth/otp/route.ts — Endpoint para validar códigos OTP.
//
// The OTP generate path used to live on POST here but it was replaced by the
// bot-first login flow (login_pending_sessions + WhatsApp webhook): the user
// opens the bot chat, the webhook sees the inbound, generates + delivers the
// OTP itself. POST had zero remaining callers, so it was deleted. PUT stays
// as the code-verification step called from the login + verify pages.
import { NextRequest, NextResponse } from "next/server";
import { validateOTP } from "@/lib/utils/otp";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkAndRecordAttempt } from "@/lib/auth/rate-limit";
import { z } from "zod";
import crypto from "crypto";

const verifySchema = z.object({
  phone: z.string().min(10, "Número de teléfono inválido"),
  code: z.string().length(6, "El código debe ser de 6 dígitos"),
});

// Genera una contraseña determinista por teléfono (el usuario nunca la ve, la auth real es por OTP)
function derivePassword(phone: string): string {
  return crypto
    .createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY!)
    .update(phone)
    .digest("hex");
}

// PUT — Valida OTP y crea sesión en Supabase
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = verifySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { phone, code } = parsed.data;

    // Rate limit check — 5 verify attempts per phone per 15 minutes
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0] ?? undefined;
    const verifyLimit = await checkAndRecordAttempt(phone, "verify", ip);
    if (verifyLimit.blocked) {
      return NextResponse.json(
        {
          error: "Demasiados intentos fallidos. Espera 15 minutos.",
          retryAfter: verifyLimit.retryAfter,
        },
        { status: 429 }
      );
    }

    console.log("[AUTH] OTP recibido:", code);
    console.log("[AUTH] Teléfono:", phone);

    // 1. Validar OTP
    const isValid = await validateOTP(phone, code);
    console.log("[AUTH] Resultado validación OTP:", isValid);

    if (!isValid) {
      return NextResponse.json(
        { error: "Código inválido o expirado" },
        { status: 400 }
      );
    }

    // 2. Buscar o crear usuario en Supabase con admin client
    const admin = createAdminClient();
    const password = derivePassword(phone);
    const email = `${phone.replace("+", "")}@wa.lapolla.app`;

    console.log("[AUTH] Creando/buscando usuario:", email);

    // Intentar crear usuario (si ya existe, Supabase retorna error)
    const { data: newUser, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      phone,
      email_confirm: true,
      phone_confirm: true,
      user_metadata: { phone, auth_method: "whatsapp_otp" },
    });

    if (createError && !createError.message.includes("already been registered")) {
      console.error("[AUTH] Error creando usuario:", createError.message);
      return NextResponse.json(
        { error: "Error al crear cuenta" },
        { status: 500 }
      );
    }

    if (newUser?.user) {
      console.log("[AUTH] Usuario nuevo creado:", newUser.user.id);
    } else {
      console.log("[AUTH] Usuario ya existe, procediendo con login");
    }

    // 3. Iniciar sesión con el server client (que setea cookies)
    const supabase = createClient();
    const { data: session, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      console.error("[AUTH] Error sesión:", signInError.message);
      return NextResponse.json(
        { error: "Error al iniciar sesión" },
        { status: 500 }
      );
    }

    console.log("[AUTH] Sesión creada:", session.user?.id);

    // Expose newUser so the frontend can route to /onboarding vs /inicio.
    // In the bot-first flow the POST /api/auth/otp step is skipped, so the
    // frontend no longer learns newUser from there.
    return NextResponse.json({
      status: "Verificado",
      phone,
      newUser: !!newUser?.user,
    });
  } catch (error) {
    console.error("Error validando OTP:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
