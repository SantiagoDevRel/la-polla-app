import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { phonePasswordEnabled } from "@/lib/auth/password-config";
import { hasPhonePassword } from "@/lib/auth/password-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return reply({ error: "Ingresa para consultar tu contraseña." }, 401);
    const enabled = phonePasswordEnabled();
    if (!enabled) return reply({ enabled: false });
    return reply({ enabled: true, hasPassword: await hasPhonePassword(user) });
  } catch {
    return reply({ error: "No pudimos consultar el estado de tu contraseña." }, 503);
  }
}
