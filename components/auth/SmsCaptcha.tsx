// components/auth/SmsCaptcha.tsx — Widget de Cloudflare Turnstile junto al
// botón «Enviar código por SMS» de /login (anti bombeo de SMS).
//
// - Modo Managed, SIEMPRE visible (appearance "always"). La versión anterior
//   usaba "interaction-only" y en algunos navegadores no aparecía: el login se
//   quedaba sin token y sin nada que tocar. Aquí la persona siempre ve el
//   estado del widget y, si falla, un botón para reintentar.
// - El script (challenges.cloudflare.com/turnstile/v0/api.js) lo inyecta
//   @marsidev/react-turnstile SOLO cuando este componente se monta, es decir,
//   solo en /login. La CSP de next.config.mjs ya permite ese origen en
//   script-src y frame-src (lo que pide la doc de Cloudflare).
// - Ancho: "flexible" ocupa la tarjeta pero exige 300 px; en pantallas de
//   320 px la tarjeta deja ~240 px, así que ahí se usa "compact" (150 px).
// - El token es de un solo uso: el padre llama reset() después de cada envío.
// - Telegram no pasa por aquí: su botón nunca depende de este widget.
"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { RotateCcw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { SECONDARY_BTN } from "@/components/auth/login-styles";

export type SmsCaptchaStatus =
  /** Cargando el script o resolviendo sin interacción. */
  | "loading"
  /** Cloudflare pide marcar la casilla. */
  | "interactive"
  /** Hay token vigente. */
  | "ready"
  /** No cargó, falló, venció sin renovarse o el navegador no es compatible. */
  | "error";

export interface SmsCaptchaHandle {
  /** Descarta el token usado y pide uno nuevo. */
  reset: () => void;
}

interface SmsCaptchaProps {
  siteKey: string;
  onToken: (token: string | null) => void;
  onStatus: (status: SmsCaptchaStatus) => void;
}

// Si el script no responde en este tiempo (bloqueador, red caída), se ofrece
// reintentar en vez de dejar el botón esperando para siempre.
const LOAD_TIMEOUT_MS = 20_000;
const FLEXIBLE_MIN_PX = 300;

const SmsCaptcha = forwardRef<SmsCaptchaHandle, SmsCaptchaProps>(function SmsCaptcha(
  { siteKey, onToken, onStatus },
  ref,
) {
  const t = useTranslations("Login");
  const locale = useLocale();
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<TurnstileInstance | null>(null);
  const [size, setSize] = useState<"flexible" | "compact" | null>(null);
  const [status, setStatusState] = useState<SmsCaptchaStatus>("loading");
  // Cambiar la key remonta el widget (reintento completo, script incluido).
  const [attempt, setAttempt] = useState(0);

  const setStatus = useCallback(
    (next: SmsCaptchaStatus) => {
      setStatusState(next);
      onStatus(next);
    },
    [onStatus],
  );

  useLayoutEffect(() => {
    const width = box.current?.clientWidth ?? 0;
    setSize(width >= FLEXIBLE_MIN_PX ? "flexible" : "compact");
    // Al volver del paso del código el widget se monta de nuevo: el padre no
    // debe conservar el token ni el estado de la vez anterior.
    onToken(null);
    onStatus("loading");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar
  }, []);

  useEffect(() => {
    if (status !== "loading") return;
    const timer = window.setTimeout(() => {
      onToken(null);
      setStatus("error");
    }, LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [status, attempt, onToken, setStatus]);

  const retry = useCallback(() => {
    // Si el SCRIPT nunca cargó (bloqueador, red), la librería deja su carga
    // colgada a nivel de módulo y remontar no lo vuelve a pedir: se recarga la
    // página. Si el script cargó y falló el desafío, basta con remontar.
    if (typeof window !== "undefined" && !window.turnstile) {
      window.location.reload();
      return;
    }
    onToken(null);
    setStatus("loading");
    setAttempt((n) => n + 1);
  }, [onToken, setStatus]);

  useImperativeHandle(
    ref,
    () => ({
      reset: () => {
        onToken(null);
        setStatus("loading");
        if (widget.current) widget.current.reset();
        else setAttempt((n) => n + 1);
      },
    }),
    [onToken, setStatus],
  );

  const fail = () => {
    onToken(null);
    setStatus("error");
  };

  return (
    <div className="space-y-2" data-testid="sms-captcha" data-status={status}>
      <div
        ref={box}
        // Con error el recuadro vacío solo deja un hueco: se oculta y queda el
        // mensaje con «Reintentar verificación».
        className={status === "error" ? "hidden" : "flex min-h-[65px] w-full items-center justify-center"}
      >
        {size && (
          <Turnstile
            key={attempt}
            ref={widget}
            siteKey={siteKey}
            className={size === "flexible" ? "w-full" : undefined}
            options={{
              action: "sms-otp",
              theme: "dark",
              size,
              appearance: "always",
              language: locale === "en" ? "en" : "es",
              refreshExpired: "auto",
              refreshTimeout: "auto",
              retry: "auto",
              // El token viaja por onSuccess; sin input oculto dentro del form.
              responseField: false,
            }}
            scriptOptions={{ onError: fail }}
            onSuccess={(token) => {
              onToken(token);
              setStatus("ready");
            }}
            onBeforeInteractive={() => setStatus("interactive")}
            onExpire={() => {
              onToken(null);
              setStatus("loading");
            }}
            onTimeout={() => {
              onToken(null);
              setStatus("loading");
            }}
            onError={() => {
              fail();
              // Deja que la persona pida el reintento; evita bucles de errores.
              return true;
            }}
            onUnsupported={fail}
          />
        )}
      </div>
      <p role="status" aria-live="polite" className="text-center text-sm leading-snug text-text-secondary empty:hidden">
        {status === "interactive" ? t("captchaCheckbox") : status === "error" ? t("captchaFailed") : null}
      </p>
      {status === "error" && (
        <button type="button" onClick={retry} className={SECONDARY_BTN}>
          <RotateCcw className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span>{t("captchaRetry")}</span>
        </button>
      )}
    </div>
  );
});

export default SmsCaptcha;
