// components/shared/InstallAppBubble.tsx — la puerta para dejar la app en la
// pantalla del telefono. Vive en el header, al lado de "Reportar un problema".
//
// La app YA era instalable (manifest + service worker) desde siempre; lo que
// faltaba era que alguien lo ofreciera. Nadie llega solo a "Compartir >
// Agregar a pantalla de inicio".
//
// Opciones según el dispositivo (ver lib/pwa/install-mode.ts):
//   · apk     Android descarga directamente el APK firmado.
//   · prompt  Otros sistemas con `beforeinstallprompt` abren el diálogo PWA.
//   · ios     Safari no permite instalar con un clic, asi que se ensenan los
//             tres pasos con capturas.
// Cualquier otro caso no muestra nada.
//
// Preview local (SOLO en dev): ?instalar=apk | prompt | ios fuerza una cara sin
// necesidad de un telefono. En produccion no existe.
"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/Toast";
import { captureEvent } from "@/app/providers";
import { ANDROID_APK_URL } from "@/lib/platform/android-release";
import {
  isInAppBrowser,
  resolveInstallMode,
  type InstallMode,
} from "@/lib/pwa/install-mode";

// El evento no esta en lib.dom: Chrome lo expone, TypeScript no lo declara.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean })
    .standalone;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    window.matchMedia?.("(display-mode: fullscreen)").matches === true ||
    iosStandalone === true
  );
}

function isCapacitorShell(): boolean {
  const cap = (window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean };
  }).Capacitor;
  return typeof cap?.isNativePlatform === "function" && cap.isNativePlatform();
}

// El evento que atrapo el script del <head> (ver app/layout.tsx). Chrome lo
// emite una sola vez por carga y puede llegar antes de que esto se monte —
// estando en login/onboarding, por ejemplo — asi que no alcanza con escuchar
// desde aca: hay que recoger tambien el que ya paso.
function tomarEventoGuardado(): BeforeInstallPromptEvent | null {
  const w = window as unknown as { __lpInstallEvent?: BeforeInstallPromptEvent | null };
  return w.__lpInstallEvent ?? null;
}

function olvidarEventoGuardado(): void {
  (window as unknown as { __lpInstallEvent?: unknown }).__lpInstallEvent = null;
}

// Todo lo que el resolver necesita saber del telefono, leido una sola vez.
function readEnvironment(hasInstallPrompt: boolean) {
  return {
    userAgent: navigator.userAgent,
    standalone: isStandalone(),
    nativeShell: isCapacitorShell(),
    maxTouchPoints: navigator.maxTouchPoints,
    hasInstallPrompt,
  };
}

export default function InstallAppBubble({
  className = "",
}: {
  className?: string;
}) {
  const t = useTranslations("Install");
  const tCommon = useTranslations("Common");
  const { showToast } = useToast();
  const [mode, setMode] = useState<InstallMode>("hidden");
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [open, setOpen] = useState(false);
  const [inApp, setInApp] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Preview local, solo en desarrollo.
    if (process.env.NODE_ENV === "development") {
      const forced = new URLSearchParams(window.location.search).get("instalar");
      if (forced === "apk" || forced === "prompt" || forced === "ios") {
        setMode(forced);
        return;
      }
    }

    if (isStandalone() || isCapacitorShell()) return;

    setInApp(isInAppBrowser(navigator.userAgent));

    // Primero el que ya paso (lo tiene el script del head), despues los que
    // lleguen mientras la persona navega.
    const yaEmitido = tomarEventoGuardado();
    if (yaEmitido) setDeferred(yaEmitido);
    setMode(resolveInstallMode(readEnvironment(Boolean(yaEmitido))));

    const onBeforeInstall = (event: Event) => {
      // Sin preventDefault Chrome decide solo cuando mostrar su barrita. Nos
      // guardamos el evento para dispararlo desde NUESTRO boton.
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
      setMode(resolveInstallMode(readEnvironment(true)));
    };

    const onInstalled = () => {
      setMode("hidden");
      setOpen(false);
      setDeferred(null);
      olvidarEventoGuardado();
      captureEvent("pwa_installed");
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // Escape cierra; el fondo no scrollea mientras la hoja esta abierta.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const install = useCallback(async () => {
    // La instalación PWA requiere un evento guardado de un solo uso.
    if (!deferred) {
      setMode("hidden");
      return;
    }
    captureEvent("pwa_install_prompt_shown");
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      captureEvent("pwa_install_choice", { outcome });
      // El evento es de un solo uso; Chrome lo vuelve a emitir si hace falta.
      setDeferred(null);
      olvidarEventoGuardado();
      if (outcome === "dismissed") setMode("hidden");
    } catch {
      setDeferred(null);
      olvidarEventoGuardado();
      setMode("hidden");
    }
  }, [deferred]);

  const onButtonClick = useCallback(() => {
    if (mode === "ios") {
      captureEvent("pwa_install_help_opened");
      setOpen(true);
      return;
    }
    void install();
  }, [install, mode]);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setCopied(true);
      showToast(tCommon("copied"), "success");
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      showToast(t("copyError"), "error");
    }
  }, [showToast, t, tCommon]);

  if (mode === "hidden") return null;

  const buttonClassName = `inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border-default bg-bg-elevated text-gold transition-colors hover:border-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold active:bg-bg-card ${className}`;

  if (mode === "apk") {
    return (
      <a
        href={ANDROID_APK_URL}
        aria-label={t("ariaButtonAndroid")}
        title={t("ariaButtonAndroid")}
        onClick={() => captureEvent("android_apk_download_clicked")}
        className={buttonClassName}
      >
        <Download size={22} strokeWidth={2.25} aria-hidden="true" />
      </a>
    );
  }

  const isIOS = mode === "ios";
  // Capturas de la app REAL dentro del Safari del iPhone (mockup armado con la
  // pantalla verdadera), las tres al mismo alto para que se vean parejas.
  const steps = [
    { text: t("iosStep1"), image: "/install/ios-paso-1.webp" },
    { text: t("iosStep2"), image: "/install/ios-paso-2.webp" },
    { text: t("iosStep3"), image: "/install/ios-paso-3.webp" },
  ];
  const buttonLabel = isIOS ? t("ariaButtonIOS") : t("ariaButton");

  return (
    <>
      <button
        type="button"
        onClick={onButtonClick}
        aria-label={buttonLabel}
        title={buttonLabel}
        className={buttonClassName}
      >
        {isIOS ? (
          // La manzanita. lucide-react no trae logos de marca, asi que va el
          // glyph como SVG propio, al mismo tamano optico que el otro icono.
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M17.05 12.54c-.02-2.2 1.8-3.26 1.88-3.31-1.02-1.5-2.61-1.7-3.18-1.73-1.36-.14-2.65.8-3.34.8-.69 0-1.75-.78-2.87-.76-1.48.02-2.84.86-3.6 2.18-1.53 2.66-.39 6.6 1.1 8.76.73 1.06 1.6 2.25 2.75 2.2 1.1-.04 1.52-.71 2.85-.71 1.33 0 1.71.71 2.87.69 1.19-.02 1.94-1.08 2.66-2.14.84-1.23 1.19-2.42 1.21-2.48-.03-.01-2.32-.89-2.33-3.5zM14.9 5.99c.61-.74 1.02-1.77.91-2.79-.88.04-1.94.59-2.57 1.32-.56.65-1.06 1.7-.93 2.7.98.08 1.98-.5 2.59-1.23z" />
          </svg>
        ) : (
          <Download size={22} strokeWidth={2.25} aria-hidden="true" />
        )}
      </button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-bg-base/80 p-4 backdrop-blur-md"
            onClick={() => setOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-app-title"
          >
            <div
              onClick={(event) => event.stopPropagation()}
              className="animate-slide-up flex max-h-[85dvh] w-full max-w-md flex-col rounded-2xl border border-border-medium bg-bg-elevated shadow-2xl"
            >
              <div className="flex items-start justify-between gap-3 p-5 pb-3">
                <div className="min-w-0">
                  <h2
                    id="install-app-title"
                    className="font-display text-xl leading-none text-text-primary"
                  >
                    {t("iosTitle")}
                  </h2>
                  <p className="mt-2 text-sm text-text-secondary">{t("subtitle")}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={tCommon("close")}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-bg-card"
                >
                  <X size={20} className="text-text-secondary" aria-hidden="true" />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
                {inApp && (
                  <div className="mb-4 rounded-xl border border-gold/30 bg-gold/10 p-3">
                    <p className="text-sm font-medium text-gold">{t("inAppIOS")}</p>
                    <button
                      type="button"
                      onClick={copyLink}
                      className="mt-2 inline-flex min-h-11 items-center rounded-xl border border-gold/40 px-4 text-sm font-medium text-gold transition-colors hover:bg-gold/10"
                    >
                      {copied ? tCommon("copied") : t("copyLink")}
                    </button>
                  </div>
                )}

                <ol className="space-y-5">
                  {steps.map((step, index) => (
                    <li key={step.text} className="space-y-2">
                      <div className="flex items-start gap-3">
                        <span className="font-display mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gold text-base leading-none text-bg-base">
                          {index + 1}
                        </span>
                        <p className="min-w-0 flex-1 text-[15px] leading-snug text-text-primary [overflow-wrap:anywhere]">
                          {step.text}
                        </p>
                      </div>
                      {/* Sin next/image a proposito: consume cuota de Image
                          Optimization en Vercel y el repo es free-tier. Un
                          archivo ya del tamano correcto no gasta nada.

                          Y sin loading="lazy": dentro de este panel con scroll
                          Chrome no llegaba a dispararlo al montarse la hoja y
                          los tres pasos quedaban en blanco. No hace falta: la
                          hoja entera solo se monta cuando alguien la abre. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={step.image}
                        alt=""
                        width={280}
                        height={373}
                        decoding="async"
                        className="h-auto w-full max-w-[280px] rounded-xl border border-border-default"
                      />
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
