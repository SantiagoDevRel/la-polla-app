import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCuentaPendiente } from "@/lib/casa/prize-account-reminder";

// ¿Le falta al usuario decir dónde le pagamos? Lo consulta PremioCuentaAviso al
// cambiar de pantalla: el layout no se vuelve a pintar al navegar, y justo
// después de pagar una polla el usuario llega a ella por router.push.
export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "No autorizado" }, { status: 401, headers });
    return NextResponse.json({ pendiente: await getCuentaPendiente(user.id) }, { headers });
  } catch {
    return NextResponse.json({ error: "No pudimos revisar tu cuenta de pago" }, { status: 500, headers });
  }
}
