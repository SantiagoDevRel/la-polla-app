// app/api/whatsapp/send/route.ts — Endpoint para enviar mensajes salientes por WhatsApp
import { NextRequest, NextResponse } from "next/server";
import { sendWhatsAppMessage } from "@/lib/whatsapp/bot";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { to, message } = await request.json();

    if (!to || !message) {
      return NextResponse.json(
        { error: "Se requieren los campos 'to' y 'message'" },
        { status: 400 }
      );
    }

    await sendWhatsAppMessage(to, message);

    return NextResponse.json({ status: "Mensaje enviado" });
  } catch (error) {
    console.error("Error enviando mensaje de WhatsApp:", error);
    return NextResponse.json({ error: "Error al enviar mensaje" }, { status: 500 });
  }
}
