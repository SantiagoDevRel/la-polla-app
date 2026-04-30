// app/api/admin/bypass-urls/route.ts
//
// Devuelve las URLs bookmarkeables del admin-bypass para los teléfonos
// admin (Santi PT + Santi CO). El server firma con ADMIN_BYPASS_SECRET
// y arma la URL completa — el secret nunca sale del backend.
//
// Solo accesible para admins. El layout `/admin/*` ya gatea, pero
// re-validamos acá como defensa en profundidad.
//
// Para revocar acceso bookmarkeado, rotar ADMIN_BYPASS_SECRET en
// Vercel — todas las URLs viejas mueren al instante.

import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { isCurrentUserAdmin } from "@/lib/auth/admin";

const ADMIN_PHONES: Array<{ phone: string; label: string }> = [
  { phone: "+573117312391", label: "Santi 🇨🇴 (CO)" },
  { phone: "+351934255581", label: "Santi 🇵🇹 (PT)" },
];

export async function GET() {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const secret = process.env.ADMIN_BYPASS_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "ADMIN_BYPASS_SECRET no está configurado en el server" },
      { status: 503 },
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://lapollacolombiana.com";
  const links = ADMIN_PHONES.map(({ phone, label }) => {
    const token = crypto.createHmac("sha256", secret).update(phone).digest("hex");
    return {
      phone,
      label,
      url: `${appUrl}/api/auth/admin-bypass?phone=${encodeURIComponent(phone)}&token=${token}`,
    };
  });

  return NextResponse.json({ links });
}
