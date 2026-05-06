// app/api/admin/twilio-by-phone/route.ts
//
// GET → breakdown del costo de Twilio agrupado por numero de celular
// destino. Usa Twilio Messages API (no Usage API, que solo da
// agregados).
//
// El admin lo usa para identificar:
//   - usuarios que estan generando muchos SMS (login repetido, abuse)
//   - costo real por usuario (NUM × precio_promedio_por_sms)
//
// Trae los ultimos N mensajes (default 250 = 1 page de Twilio) del mes
// en curso, agrupa por `to`, devuelve top 30 por costo.

import { NextResponse } from "next/server";
import { isCurrentUserAdmin } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

interface TwilioMessage {
  sid: string;
  to: string;
  from: string;
  body: string | null;
  status: string;
  price: string | null;
  price_unit: string | null;
  date_sent: string | null;
  date_created: string;
  num_segments: string;
}

interface TwilioMessagesResponse {
  messages: TwilioMessage[];
}

export async function GET() {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    return NextResponse.json({ configured: false, byPhone: [] });
  }

  const auth = Buffer.from(`${sid}:${token}`).toString("base64");

  // Window: ultimos 30 dias (mes en curso aprox).
  const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json?DateSent%3E=${start}&PageSize=1000`;

  let messages: TwilioMessage[] = [];
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 240).replace(/\s+/g, " ");
      return NextResponse.json(
        { configured: true, error: `Twilio ${res.status} ${detail}` },
        { status: 502 },
      );
    }
    const data = (await res.json()) as TwilioMessagesResponse;
    messages = data.messages ?? [];
  } catch (e) {
    return NextResponse.json(
      {
        configured: true,
        error: e instanceof Error ? e.message : "fetch failed",
      },
      { status: 500 },
    );
  }

  // Agrupar por destino. Twilio reporta `price` en negativo (costo, ej.
  // "-0.05000"). Lo invertimos para mostrar positivo.
  const byPhone = new Map<
    string,
    { phone: string; count: number; cost: number; lastSent: string }
  >();
  for (const m of messages) {
    const cost = m.price ? Math.abs(parseFloat(m.price)) : 0;
    const cur = byPhone.get(m.to) ?? {
      phone: m.to,
      count: 0,
      cost: 0,
      lastSent: m.date_sent ?? m.date_created,
    };
    cur.count += 1;
    cur.cost += cost;
    if ((m.date_sent ?? m.date_created) > cur.lastSent) {
      cur.lastSent = m.date_sent ?? m.date_created;
    }
    byPhone.set(m.to, cur);
  }

  // Resolver display_name por phone (si está en nuestra DB).
  const phones = Array.from(byPhone.keys()).map((p) => p.replace(/^\+/, ""));
  const admin = createAdminClient();
  const { data: usersData } = await admin
    .from("users")
    .select("display_name, whatsapp_number")
    .in("whatsapp_number", phones);
  const nameByPhone = new Map<string, string | null>();
  for (const u of (usersData ?? []) as Array<{
    display_name: string | null;
    whatsapp_number: string;
  }>) {
    nameByPhone.set(u.whatsapp_number, u.display_name);
  }

  const rows = Array.from(byPhone.values())
    .map((r) => ({
      phone: r.phone,
      displayName: nameByPhone.get(r.phone.replace(/^\+/, "")) ?? null,
      count: r.count,
      cost: Math.round(r.cost * 10000) / 10000,
      lastSent: r.lastSent,
    }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 30);

  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const totalCount = rows.reduce((s, r) => s + r.count, 0);

  return NextResponse.json({
    configured: true,
    period: { start, end: new Date().toISOString().slice(0, 10) },
    sample_size: messages.length,
    truncated: messages.length === 1000,
    totals: {
      cost: Math.round(totalCost * 10000) / 10000,
      count: totalCount,
    },
    byPhone: rows,
  });
}
