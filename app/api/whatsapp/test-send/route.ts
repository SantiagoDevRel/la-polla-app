// app/api/whatsapp/test-send/route.ts — Dev-only endpoint to test WhatsApp interactive messages
import { NextRequest, NextResponse } from "next/server";
import { sendReplyButtons } from "@/lib/whatsapp/interactive";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Only allow in dev or with secret matching WEBHOOK_VERIFY_TOKEN
  const secret = request.nextUrl.searchParams.get("secret");
  const isAllowed =
    process.env.NODE_ENV !== "production" ||
    (secret && secret === process.env.META_WA_WEBHOOK_VERIFY_TOKEN);

  if (!isAllowed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  // TODO: Replace with your test phone number (Colombian format: 57XXXXXXXXXX)
  const testPhone = request.nextUrl.searchParams.get("phone") || "57XXXXXXXXXX";

  try {
    await sendReplyButtons(
      testPhone,
      "¡Hola parce! 🐔 Este es un mensaje de prueba de La Polla Colombiana.",
      [
        { id: "test_1", title: "Funciona ✅" },
        { id: "test_2", title: "Bacano 🎉" },
      ],
      "🐔 Test La Polla",
      "🐔 La Polla Colombiana"
    );

    return NextResponse.json({
      success: true,
      message: `Test message sent to ${testPhone}`,
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("[test-send] Error:", err.message);
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}
