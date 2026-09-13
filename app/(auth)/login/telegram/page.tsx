// app/(auth)/login/telegram/page.tsx — Página del enlace de un solo uso del bot
// de login de Telegram (v2, migración 119). Vive dentro de (auth) para verse
// con el sistema de diseño (Bebas/Outfit, tarjetas del login), no como una
// página suelta del servidor.
//
// GET nunca abre sesión (ni lo quema un escáner o una vista previa):
//   - ?t=<token> de un enlace vigente:
//       · si este navegador tiene la cookie lp_tg_req de ESA solicitud (lo
//         abrió quien tocó «Entrar con Telegram» aquí mismo), envía solo el
//         formulario al canje;
//       · si no, «Confirma tu ingreso» con el número enmascarado y un botón
//         (protege contra login CSRF: nadie te deja dentro de SU cuenta).
//   - ?t= usado o vencido, o ?estado=… después de un POST fallido: el estado
//     con una salida clara, sin rutas como texto.
// El canje es POST a /api/auth/telegram/link. Referrer solo al mismo origen (el
// token va en la URL) y sin índice. /login/* ya es público y NetworkOnly en el service worker;
// con sesión abierta el middleware manda a /casa sin tocar el enlace.

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Loader2, LogIn, MessageSquare, Send } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTelegramLoginConfig } from "@/lib/auth/telegram-login/config";
import { resolveLinkPageView } from "@/lib/auth/telegram-login/link-page";
import { LOGIN_LINK_ACTION } from "@/lib/auth/telegram-login/links";
import { browserHashFromCookies } from "@/lib/auth/telegram-login/request-cookie";
import {
  GHOST_BTN,
  LOGIN_CARD,
  LOGIN_TITLE,
  PRIMARY_BTN,
  PRIMARY_GLOW,
} from "@/components/auth/login-styles";
import TelegramLinkAutoSubmit from "./TelegramLinkAutoSubmit";

export const dynamic = "force-dynamic";

// same-origin y NO no-referrer: con no-referrer Chrome manda «Origin: null» en
// el POST del formulario y el canje lo rechaza como otro sitio. same-origin no
// deja salir la URL (con el token) hacia ningún otro dominio.
export const metadata: Metadata = {
  referrer: "same-origin",
  robots: { index: false, follow: false },
};

export default async function TelegramLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string | string[]; estado?: string | string[] }>;
}) {
  const t = await getTranslations("Login");
  const view = await resolveLinkPageView({
    params: await searchParams,
    config: getTelegramLoginConfig(),
    browserHash: browserHashFromCookies(await cookies()),
    db: createAdminClient,
  });

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <main className={`${LOGIN_CARD} relative z-10`} data-testid="telegram-link" data-view={view.kind === "state" ? view.state : view.kind}>
        <div className="text-center space-y-3">
          <span
            aria-hidden="true"
            className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full border border-border-subtle bg-bg-elevated"
          >
            <Send className="h-6 w-6 text-text-primary" />
          </span>

          {view.kind === "auto" && (
            <>
              <h1 className={LOGIN_TITLE}>{t("tgLinkAutoTitle")}</h1>
              <p role="status" aria-live="polite" className="flex items-center justify-center gap-2 text-sm leading-relaxed text-text-secondary break-words">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gold" aria-hidden="true" />
                <span className="min-w-0">{t("tgLinkAutoBody")}</span>
              </p>
            </>
          )}

          {view.kind === "confirm" && (
            <>
              <h1 className={LOGIN_TITLE}>{t("tgLinkConfirmTitle")}</h1>
              <p className="text-sm leading-relaxed text-text-secondary break-words">{t("tgLinkConfirmLead")}</p>
              <p className="font-body text-xl font-semibold tracking-wide text-text-primary tabular-nums [overflow-wrap:anywhere]">
                {view.maskedPhone}
              </p>
              <p className="text-sm leading-relaxed text-text-secondary break-words">{t("tgLinkConfirmNotYours")}</p>
            </>
          )}

          {view.kind === "state" && (
            <>
              <h1 className={LOGIN_TITLE}>{t(`tgLinkState.${view.state}.title`)}</h1>
              <p className="text-sm leading-relaxed text-text-secondary break-words">
                {t(`tgLinkState.${view.state}.body`)}
              </p>
            </>
          )}
        </div>

        {view.kind === "auto" && (
          <TelegramLinkAutoSubmit action={LOGIN_LINK_ACTION} token={view.token} label={t("tgLinkSubmit")} />
        )}

        {view.kind === "confirm" && (
          <div className="space-y-3">
            <form method="post" action={LOGIN_LINK_ACTION}>
              <input type="hidden" name="t" value={view.token} />
              <button type="submit" className={PRIMARY_BTN} style={PRIMARY_GLOW}>
                <LogIn className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span>{t("tgLinkSubmit")}</span>
              </button>
            </form>
            <a href="/login" className={GHOST_BTN}>
              <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{t("tgCancel")}</span>
            </a>
            <p className="text-center text-[13px] leading-relaxed text-text-muted break-words">
              {t("tgLinkOtherBrowser")}
            </p>
          </div>
        )}

        {view.kind === "state" && (
          // Una sola acción: volver al inicio de sesión (SMS o Telegram otra vez).
          <a href="/login" className={PRIMARY_BTN} style={PRIMARY_GLOW}>
            {view.state === "sms_only" || view.state === "unavailable" ? (
              <MessageSquare className="h-5 w-5 shrink-0" aria-hidden="true" />
            ) : (
              <ArrowLeft className="h-5 w-5 shrink-0" aria-hidden="true" />
            )}
            <span>
              {view.state === "sms_only" || view.state === "unavailable"
                ? t("tgUseSms")
                : t("tgLinkBackToLogin")}
            </span>
          </a>
        )}
      </main>
    </div>
  );
}
