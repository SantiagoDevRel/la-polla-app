// components/perfil/LanguageToggle.tsx — Selector de idioma (ES/EN) en /perfil.
//
// En producción: redirige al otro dominio (lapollacolombiana.com ↔
// chickenpicks.app). NO setea cookie en prod — el dominio dicta el locale,
// la cookie quedaría inerte.
//
// En localhost / Vercel preview: setea la cookie NEXT_LOCALE y refresca
// la ruta para que el middleware re-renderee con el nuevo locale.
//
// Dentro de la app nativa (Capacitor): NO se renderiza. El wrapper apunta
// solo a lapollacolombiana.com — chickenpicks.app no está en
// `allowNavigation`, así que tocar "English" abriría Safari en vez de
// cambiar de idioma. No hay app nativa en inglés, el toggle cross-domain
// no aplica acá.
//
// Loader: si el cambio se demora más de 200 ms se muestra un FootballLoader
// (pollito rebotando). Si es instantáneo, no aparece nada — evita flash.
"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { Languages } from "lucide-react";
import FootballLoader from "@/components/ui/FootballLoader";

type Locale = "es" | "en";

const HOST_ES = "lapollacolombiana.com";
const HOST_EN = "chickenpicks.app";
const LOADER_DELAY_MS = 200;

const OPTIONS: { value: Locale; flag: string; label: string }[] = [
  { value: "es", flag: "🇨🇴", label: "Español" },
  { value: "en", flag: "🇺🇸", label: "English" },
];

function setLocaleCookie(locale: Locale) {
  const oneYear = 60 * 60 * 24 * 365;
  const isHttps =
    typeof window !== "undefined" && window.location.protocol === "https:";
  const secure = isHttps ? "; Secure" : "";
  document.cookie = `NEXT_LOCALE=${locale}; Max-Age=${oneYear}; Path=/; SameSite=Lax${secure}`;
}

function isProductionHost(host: string): boolean {
  if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) return false;
  if (host.endsWith(".vercel.app")) return false;
  return host === HOST_ES || host === HOST_EN;
}

export default function LanguageToggle() {
  const current = useLocale() as Locale;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [switching, setSwitching] = useState<Locale | null>(null);
  const [showLoader, setShowLoader] = useState(false);
  // Dentro de la app nativa el toggle no se muestra (ver header del archivo).
  // Detección client-side: el SSR no sabe que es Capacitor, así que el
  // toggle puede aparecer ~1 frame antes de ocultarse — aceptable en una
  // pantalla de settings.
  const [isNativeApp, setIsNativeApp] = useState(false);

  useEffect(() => {
    const cap = (
      window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }
    ).Capacitor;
    if (cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform()) {
      setIsNativeApp(true);
    }
  }, []);

  // Limpia el flag de switching cuando la transición de RSC termina.
  // (En el path de redirect a otro dominio, switching se queda hasta que
  // la página navega — eso es correcto, mantiene el loader visible.)
  useEffect(() => {
    if (!pending && switching !== null) {
      setSwitching(null);
    }
  }, [pending, switching]);

  // Loader delayed: solo aparece si switching pasa de LOADER_DELAY_MS.
  // Si el cambio es instantáneo, nunca se renderiza.
  useEffect(() => {
    if (switching === null) {
      setShowLoader(false);
      return;
    }
    const timer = window.setTimeout(() => setShowLoader(true), LOADER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [switching]);

  async function pick(next: Locale) {
    if (next === current || switching !== null) return;
    setSwitching(next);

    const host = window.location.hostname.toLowerCase();
    if (isProductionHost(host)) {
      const target = next === "es" ? HOST_ES : HOST_EN;
      if (host !== target) {
        // SSO handoff: pedimos al backend un token firmado con la sesión
        // actual y navegamos al endpoint /consume del dominio destino.
        // El destino valida + setSession + redirect al path original →
        // el user llega ya logueado, sin re-loguear.
        try {
          const res = await fetch("/api/auth/handoff", {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              target: next,
              path: window.location.pathname + window.location.search,
            }),
          });
          if (res.ok) {
            const data = (await res.json()) as { url?: string };
            if (data.url) {
              window.location.href = data.url;
              return;
            }
          }
          // Si el handoff falla (no estaba logueado, server error, etc.):
          // fallback al redirect simple. El user va a tener que re-loguearse
          // en el dominio destino, pero al menos llega allí.
        } catch {
          /* network error → fallback */
        }
        window.location.href = `https://${target}${window.location.pathname}${window.location.search}`;
        return;
      }
      // Mismo dominio en prod (caso raro: ya están donde quieren) → refresh.
      startTransition(() => {
        router.refresh();
      });
      return;
    }

    // Localhost / Vercel preview: cookie + refresh. El middleware en
    // non-prod respeta la cookie, así que el RSC re-renderiza con el
    // nuevo locale al refresh.
    setLocaleCookie(next);
    startTransition(() => {
      router.refresh();
    });
  }

  // App nativa: el selector de idioma cross-domain no aplica. Ver header.
  if (isNativeApp) return null;

  return (
    <section className="lp-card relative" style={{ padding: 14 }}>
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: "#f0f4ff",
          marginBottom: 10,
          display: "flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        <Languages className="w-3.5 h-3.5" style={{ color: "#FFD700" }} />
        {current === "es" ? "Idioma" : "Language"}
      </div>
      <div
        role="radiogroup"
        aria-label={current === "es" ? "Idioma" : "Language"}
        style={{ display: "flex", gap: 8 }}
      >
        {OPTIONS.map((opt) => {
          const active = current === opt.value;
          const busy = switching === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={switching !== null}
              onClick={() => pick(opt.value)}
              className="flex-1 rounded-xl flex items-center justify-center gap-2 transition-all"
              style={{
                background: active
                  ? "rgba(255,215,0,0.12)"
                  : "var(--bg-elevated, #131b2b)",
                border: active
                  ? "1px solid rgba(255,215,0,0.4)"
                  : "1px solid rgba(255,255,255,0.08)",
                color: active ? "#FFD700" : "#F5F7FA",
                padding: "10px 6px",
                fontFamily: "'Outfit', sans-serif",
                fontWeight: active ? 700 : 500,
                fontSize: 13,
                lineHeight: 1,
                cursor: switching !== null ? "wait" : "pointer",
                opacity: switching !== null && !busy ? 0.5 : 1,
              }}
            >
              <span style={{ fontSize: 18 }} aria-hidden>
                {opt.flag}
              </span>
              <span>{opt.label}</span>
            </button>
          );
        })}
      </div>

      {showLoader && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(8, 12, 16, 0.7)",
            backdropFilter: "blur(2px)",
            borderRadius: "inherit",
            zIndex: 10,
          }}
        >
          <FootballLoader size={48} />
        </div>
      )}
    </section>
  );
}
