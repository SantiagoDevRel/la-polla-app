import type { Metadata } from "next";
import { MessageCircle, LogIn } from "lucide-react";
import { LOGIN_CARD, LOGIN_TITLE, PRIMARY_BTN, GHOST_BTN } from "@/components/auth/login-styles";
import { peekWhatsAppLogin, WHATSAPP_LINK_ACTION } from "@/lib/auth/whatsapp-login";
import { maskPhone } from "@/lib/auth/telegram-login/mask-phone";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { referrer: "same-origin", robots: { index: false, follow: false } };

export default async function WhatsAppLinkPage({ searchParams }: {
  searchParams: Promise<{ t?: string | string[]; estado?: string | string[] }>;
}) {
  const params = await searchParams;
  let row = null;
  let unavailable = params.estado === "unavailable";
  try { row = await peekWhatsAppLogin(params.t); } catch { unavailable = true; }
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative">
      <main className={`${LOGIN_CARD} relative z-10`} data-testid="whatsapp-link" data-view={row ? "confirm" : unavailable ? "unavailable" : "expired"}>
        <div className="text-center space-y-3">
          <span aria-hidden="true" className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full border border-border-subtle bg-bg-elevated">
            <MessageCircle className="h-6 w-6 text-text-primary" />
          </span>
          <h1 className={`${LOGIN_TITLE} leading-tight`}>{row ? "Confirma tu ingreso" : unavailable ? "No pudimos iniciar sesión" : "Solicita un nuevo enlace"}</h1>
          <p className="text-sm leading-relaxed text-text-secondary break-words">
            {row ? "Vas a entrar con el número de WhatsApp:" : unavailable ? "Inténtalo de nuevo desde WhatsApp o ingresa con SMS." : "Este enlace ya se usó, venció o no está disponible. Escribe Hola de nuevo en WhatsApp o ingresa con SMS."}
          </p>
          {row && <>
            <p className="font-body text-xl leading-snug font-semibold tracking-wide text-text-primary tabular-nums [overflow-wrap:anywhere]">{maskPhone(row.phone_number)}</p>
            <p className="text-sm leading-relaxed text-text-secondary break-words">Continúa solo si este es tu número.</p>
          </>}
        </div>
        {row && typeof params.t === "string" ? <div className="space-y-3">
          <form method="post" action={WHATSAPP_LINK_ACTION}>
            <input type="hidden" name="t" value={params.t} />
            <button type="submit" className={PRIMARY_BTN}><LogIn className="h-5 w-5 shrink-0" aria-hidden="true" /><span>Entrar a La Polla</span></button>
          </form>
          <a href="/login" className={GHOST_BTN}>Usar otro número</a>
        </div> : <a href="/login" className={PRIMARY_BTN}>Volver al inicio de sesión</a>}
      </main>
    </div>
  );
}
