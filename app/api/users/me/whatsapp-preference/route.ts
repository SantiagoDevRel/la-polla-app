import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { toE164 } from "@/lib/auth/phone";
import { marketingAllowed, setMarketingPreference } from "@/lib/whatsapp/marketing-preferences";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401, headers });
  const phone = toE164(user.phone);
  if (!phone) return NextResponse.json({ enabled: false, available: false }, { headers });
  try {
    return NextResponse.json({ enabled: await marketingAllowed(createAdminClient(), phone), available: true }, { headers });
  } catch { return NextResponse.json({ error: "No se pudo consultar la preferencia." }, { status: 503, headers }); }
}

export async function PATCH(request: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401, headers });
  if (request.headers.get("origin") !== request.nextUrl.origin) return new NextResponse(null, { status: 403, headers });
  const phone = toE164(user.phone);
  if (!phone) return NextResponse.json({ error: "Tu cuenta no tiene un teléfono verificado." }, { status: 409, headers });
  let body;
  try { body = await request.json(); } catch { return new NextResponse(null, { status: 400, headers }); }
  if (typeof body?.enabled !== "boolean" || Object.keys(body).some(k => k !== "enabled")) {
    return new NextResponse(null, { status: 400, headers });
  }
  try {
    const state = await setMarketingPreference(createAdminClient(), {
      phone, enabled: body.enabled, source: "profile", eventId: `profile:${randomUUID()}`,
    });
    return NextResponse.json({ enabled: state.enabled, available: true }, { headers });
  } catch { return NextResponse.json({ error: "No se pudo guardar la preferencia." }, { status: 503, headers }); }
}
