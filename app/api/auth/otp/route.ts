// app/api/auth/otp/route.ts — Endpoint para generar y validar códigos OTP
// OTP is saved to Supabase. The WhatsApp bot detects it when the user messages.
import { NextRequest, NextResponse } from "next/server";
import { generateOTP, validateOTP, markOTPSent } from "@/lib/utils/otp";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkAndRecordAttempt } from "@/lib/auth/rate-limit";
import { sendCTAButton } from "@/lib/whatsapp/interactive";
import { z } from "zod";
import crypto from "crypto";

const generateSchema = z.object({
  phone: z.string().min(10, "Número de teléfono inválido"),
  turnstileToken: z.string().min(1, "Token de Turnstile requerido"),
});

const verifySchema = z.object({
  phone: z.string().min(10, "Número de teléfono inválido"),
  code: z.string().length(6, "El código debe ser de 6 dígitos"),
});

// POST — Genera y envía OTP
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = generateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    // Rate limit check — 5 generate attempts per phone per hour
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0] ?? undefined;
    const limit = await checkAndRecordAttempt(parsed.data.phone, "generate", ip);
    if (limit.blocked) {
      return NextResponse.json(
        {
          error: "Demasiados intentos. Espera antes de solicitar otro código.",
          retryAfter: limit.retryAfter,
        },
        { status: 429 }
      );
    }

    // Verificar Turnstile token
    const turnstileResponse = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY,
          response: parsed.data.turnstileToken,
        }),
      }
    );

    const turnstileData = await turnstileResponse.json();
    if (!turnstileData.success) {
      return NextResponse.json(
        { error: "Verificación de captcha fallida" },
        { status: 400 }
      );
    }

    // Check if returning user (exists in public.users)
    // DB stores phone without + prefix (e.g. "351934255581")
    const normalizedPhone = parsed.data.phone.replace(/^\+/, "");
    const admin = createAdminClient();
    const { data: existingUser } = await admin
      .from("users")
      .select("id")
      .eq("whatsapp_number", normalizedPhone)
      .single();

    // Generate OTP and save to Supabase
    const otpCode = await generateOTP(parsed.data.phone);

    // For returning users: send OTP proactively via WhatsApp
    // (WhatsApp allows proactive messages to users who have messaged before)
    if (existingUser) {
      try {
        const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim() || "https://la-polla.vercel.app";
        await sendCTAButton(
          normalizedPhone,
          `🔐 *Tu código de verificación*\n\n*${otpCode}*\n\nVálido por 10 minutos\nIngresa este código en la app para continuar 👇`,
          "Abrir La Polla 🐔",
          `${APP_URL}/verify`,
          "La Polla Colombiana 🐥"
        );
        // Mark OTP as sent since we delivered it proactively
        // Find the OTP record we just created and mark it
        const { findPendingOTP } = await import("@/lib/utils/otp");
        const pending = await findPendingOTP(parsed.data.phone);
        if (pending) await markOTPSent(pending.id);
      } catch (waErr) {
        // Log but don't fail — user can still get OTP via bot
        console.error("[OTP] Error sending proactive WhatsApp:", waErr);
      }
    }

    return NextResponse.json({ success: true, newUser: !existingUser });
  } catch (error) {
    console.error("Error generando OTP:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

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
