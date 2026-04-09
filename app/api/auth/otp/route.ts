// app/api/auth/otp/route.ts — Endpoint para generar y validar códigos OTP vía WhatsApp
import { NextRequest, NextResponse } from "next/server";
import { generateOTP, validateOTP } from "@/lib/utils/otp";
import { sendWhatsAppMessage } from "@/lib/whatsapp/bot";
import { getOTPMessage } from "@/lib/whatsapp/messages";
import { z } from "zod";

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

    const otp = await generateOTP(parsed.data.phone);

    if (process.env.NODE_ENV === "development") {
      console.log(`[DEV] OTP para ${parsed.data.phone}: ${otp}`);
      return NextResponse.json({
        status: "OTP generado (modo desarrollo)",
        dev_otp: otp,
      });
    }

    await sendWhatsAppMessage(parsed.data.phone, getOTPMessage(otp));

    return NextResponse.json({ status: "OTP enviado por WhatsApp" });
  } catch (error) {
    console.error("Error generando OTP:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

// PUT — Valida OTP
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

    const isValid = await validateOTP(parsed.data.phone, parsed.data.code);

    if (!isValid) {
      return NextResponse.json(
        { error: "Código inválido o expirado" },
        { status: 400 }
      );
    }

    return NextResponse.json({ status: "Verificado", phone: parsed.data.phone });
  } catch (error) {
    console.error("Error validando OTP:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
