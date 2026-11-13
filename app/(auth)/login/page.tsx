// app/(auth)/login/page.tsx — Server wrapper del login.
// Desde 2026-11-13 el único ingreso es WhatsApp (decisión del dueño): sin SMS,
// contraseña ni Telegram en pantalla. Sus endpoints siguen en el servidor.
// Toda la UI vive en LoginClient.tsx; el enlace wa.me sale de la configuración
// del servidor (lib/auth/whatsapp-login.ts).
import { getWhatsAppLoginHref } from "@/lib/auth/whatsapp-login";
import { getPollaBySlug } from "@/lib/casa/queries";
import LoginClient from "./LoginClient";

// The WhatsApp link depends on server-side rollout settings.
export const dynamic = "force-dynamic";

/**
 * «Vas a entrar a <polla>» (informe de participación, 2026-10-29): solo con un
 * returnTo a /polla/<slug> de una polla publicada. Nombre y entrada son lo que
 * ya muestra la página pública de la polla; si la lectura falla, no hay tarjeta.
 */
async function pollaDestino(returnTo: string | string[] | undefined) {
  const slug = typeof returnTo === "string" ? /^\/polla\/([a-z0-9-]{1,80})(?:\/pagar)?(?:[?#].*)?$/i.exec(returnTo)?.[1] : undefined;
  if (!slug) return null;
  const polla = await getPollaBySlug(slug).catch(() => null);
  if (!polla || polla.status === "anulada") return null;
  return { name: polla.name, entryCop: polla.entry_price_cop };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[] }> }) {
  const destino = await pollaDestino((await searchParams).returnTo);
  return <LoginClient whatsappLoginHref={getWhatsAppLoginHref()} pollaDestino={destino} />;
}
