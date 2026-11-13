// app/(auth)/login/LoginClient.tsx — Ingreso SOLO por WhatsApp (2026-11-13).
//
// Decisión del dueño: «quita la opción SMS… y deja solo WhatsApp», sin
// contraseña ni Telegram. Los endpoints de SMS, contraseña y Telegram siguen en
// el servidor (no se borró backend), pero ninguna pantalla los ofrece.
//
// Flujo (lib/auth/whatsapp-login.ts):
//   1. «Entrar con WhatsApp» abre wa.me con el mensaje ya escrito.
//   2. El bot responde con el botón «Haz clic para entrar» (enlace personal).
//   3. /login/whatsapp pide confirmar con «Entrar a La Polla».
// La primera vez en cada celular, antes de abrir WhatsApp, se muestra el
// tutorial animado de esos tres toques (components/auth/TutorialWhatsApp.tsx,
// mismo diseño que Los Del Sur) y «Abrir WhatsApp» se activa al terminarlo.
//
// WhatsApp se abre en otra pestaña: esta queda en «Escríbele al bot» con los
// pasos y, al volver, revisa si la sesión ya se abrió para seguir sola. El
// returnTo viaja en la cookie lp_return_to porque el enlace del bot abre otra
// pestaña sin este sessionStorage.
"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, PlayCircle } from "lucide-react";
import axios from "axios";
import { useTranslations, useLocale } from "next-intl";
import { safeReturnTo } from "@/lib/auth/safe-return-to";
import { readLoginStorage, writeLoginStorage } from "@/lib/auth/login-request";
import { loadProfile } from "@/lib/users/profile-client";
import { needsName } from "@/lib/users/needs-name";
import { SUPPORT_PATH } from "@/lib/auth/otp-codes";
import TournamentBadge from "@/components/shared/TournamentBadge";
import { WhatsAppGlyph } from "@/components/ui/WhatsAppGlyph";
import { rememberReturnTo } from "@/lib/auth/return-to-cookie";
import { TutorialWhatsApp, marcarTutorialWhatsAppVisto, tutorialWhatsAppVisto } from "@/components/auth/TutorialWhatsApp";
import { GHOST_BTN, LOGIN_CARD, LOGIN_TITLE, SECONDARY_BTN } from "@/components/auth/login-styles";

function fmtCOP(n: number): string {
  return `$${n.toLocaleString("es-CO")}`;
}

const RETURN_TO_KEY = "lp_returnTo";
// «Ya abrió WhatsApp»: si el navegador recarga la pestaña al volver, se
// conserva la pantalla de los pasos (el enlace del bot vence a los 10 min).
const WA_OPENED_KEY = "lp_wa_login_opened";
const WA_OPENED_TTL_MS = 10 * 60_000;

const WA_BTN = "w-full min-h-[52px] inline-flex flex-wrap items-center justify-center gap-2 rounded-xl bg-whatsapp px-4 py-3.5 text-base leading-snug font-semibold text-bg-base text-center cursor-pointer hover:brightness-110 active:scale-[0.98] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whatsapp focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card aria-disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:active:scale-100";

type View = "start" | "tutorial" | "sent";

interface PollaPreview {
  slug: string;
  name: string;
  tournament: string;
  buy_in_amount: number;
  type: string;
  participantCount: number;
}

function readOpened(): boolean {
  const at = Number.parseInt(readLoginStorage(WA_OPENED_KEY) ?? "", 10);
  if (Number.isFinite(at) && at <= Date.now() && Date.now() - at < WA_OPENED_TTL_MS) return true;
  writeLoginStorage(WA_OPENED_KEY, null);
  return false;
}

function LoginInner({ whatsappLoginHref = null, pollaDestino = null }: LoginClientProps) {
  const en = useLocale() === "en";
  const t = useTranslations("Login");
  const searchParams = useSearchParams();
  const returnTo = useRef<string | null>(null);
  const sentHeading = useRef<HTMLHeadingElement>(null);
  const [view, setView] = useState<View>("start");
  const [tutorialListo, setTutorialListo] = useState(false);
  const alTerminarTutorial = useCallback(() => setTutorialListo(true), []);
  const [preview, setPreview] = useState<PollaPreview | null>(null);

  // ⛔ Acá NO va ningún signOut() on-mount: supabase-js lo hace global y una
  // visita accidental a /login cerraba la sesión en todos los dispositivos.
  // El middleware ya saca de /login a quien tiene sesión.

  // Volver a la pantalla de pasos si la pestaña se recargó al regresar.
  useEffect(() => { if (readOpened()) setView("sent"); }, []);

  // Capturar returnTo + cargar preview de polla si viene de invite link.
  // safeReturnTo: solo rutas internas (evita open redirect).
  useEffect(() => {
    const rt = safeReturnTo(searchParams.get("returnTo"));
    if (rt) writeLoginStorage(RETURN_TO_KEY, rt);
    const stored = rt ?? safeReturnTo(readLoginStorage(RETURN_TO_KEY));
    returnTo.current = stored;
    if (!stored) return;
    // El enlace de WhatsApp abre otra pestaña sin este sessionStorage.
    rememberReturnTo(stored);
    const slugMatch = stored.match(/^\/(?:pollas|unirse)\/([^/?#]+)/);
    const tokenMatch = stored.match(/^\/invites\/polla\/([^/?#]+)/);
    if (!slugMatch && !tokenMatch) return;
    const params = new URLSearchParams(slugMatch ? { slug: slugMatch[1] } : { token: tokenMatch![1] });
    axios
      .get<{ polla: Omit<PollaPreview, "participantCount">; participantCount: number }>(`/api/pollas/preview?${params.toString()}`)
      .then(({ data }) => setPreview({ ...data.polla, participantCount: data.participantCount }))
      .catch(() => {});
  }, [searchParams]);

  // Al volver de WhatsApp: si el enlace del bot se abrió en este navegador, la
  // sesión ya está en las cookies y se sigue sin pedir nada más.
  useEffect(() => {
    if (view !== "sent") return;
    let busy = false;
    let done = false;
    async function check() {
      if (busy || done || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const profile = await loadProfile();
        if (!profile.ok || done) return;
        done = true;
        writeLoginStorage(WA_OPENED_KEY, null);
        const rt = returnTo.current || safeReturnTo(readLoginStorage(RETURN_TO_KEY));
        const newUser = needsName(profile.data.display_name) || !profile.data.avatar_url;
        if (!newUser) writeLoginStorage(RETURN_TO_KEY, null);
        rememberReturnTo(null);
        window.location.href = newUser ? `/onboarding${rt ? `?returnTo=${encodeURIComponent(rt)}` : ""}` : rt || "/";
      } catch { /* sin red: se revisa al volver otra vez */ } finally { busy = false; }
    }
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    return () => {
      done = true;
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
    };
  }, [view]);

  useEffect(() => { if (view === "sent") sentHeading.current?.focus(); }, [view]);

  function opened() {
    if (returnTo.current) rememberReturnTo(returnTo.current);
    writeLoginStorage(WA_OPENED_KEY, String(Date.now()));
    setView("sent");
  }

  // Primer toque en este celular: el tutorial va antes de abrir WhatsApp.
  function onStartClick(event: React.MouseEvent<HTMLAnchorElement>) {
    if (!tutorialWhatsAppVisto()) {
      event.preventDefault();
      setTutorialListo(false);
      setView("tutorial");
      return;
    }
    opened();
  }

  const destinoCard = preview ? (
    <div className="rounded-2xl p-4 border border-gold/30 bg-gold/5 space-y-1.5 text-center">
      <p className="text-[13px] text-text-secondary">{t("invitedTo")}</p>
      <p className="font-display text-2xl text-text-primary tracking-wide [overflow-wrap:anywhere]">{preview.name}</p>
      <div className="flex items-center justify-center gap-2 text-xs text-text-secondary">
        <TournamentBadge tournamentSlug={preview.tournament} size="sm" />
      </div>
      <p className="text-[13px] text-text-secondary">
        {t("participants", { count: preview.participantCount })}
        {preview.buy_in_amount > 0 ? ` · ${t("perPerson", { amount: fmtCOP(preview.buy_in_amount) })}` : ` · ${t("free")}`}
      </p>
    </div>
  ) : pollaDestino ? (
    // Casa (2026-10-29): quien llega desde el enlace de una polla ve a cuál entra.
    <div className="rounded-2xl p-4 border border-gold/30 bg-gold/5 space-y-1.5 text-center">
      <p className="text-[13px] text-text-secondary">{t("goingTo")}</p>
      <p className="font-display text-2xl leading-tight text-text-primary tracking-wide [overflow-wrap:anywhere]">{pollaDestino.name}</p>
      <p className="text-[15px] text-text-secondary">
        {pollaDestino.entryCop > 0 ? t("entryPrice", { amount: fmtCOP(pollaDestino.entryCop) }) : t("entryFree")}
      </p>
    </div>
  ) : null;

  const terms = (
    <p className="text-[11px] leading-snug text-text-muted text-center">
      {en ? "By continuing, you accept our " : "Al continuar, aceptas nuestros "}
      <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-text-secondary">
        {en ? "terms and conditions" : "términos y condiciones"}
      </a>.
    </p>
  );

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {view === "start" && (
        <main className="w-full max-w-md rounded-2xl p-6 space-y-6 bg-bg-card/80 backdrop-blur-sm border border-border-subtle relative z-10" data-testid="login-whatsapp" data-view="start">
          <div className="text-center space-y-2">
            <motion.div
              className="mx-auto"
              style={{ width: 80, height: 80, position: "relative" }}
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/pollitos/logo_realistic-192.webp" alt={t("brand")} width={80} height={80} className="h-20 w-20 max-w-none object-contain" />
            </motion.div>
            <h1 className="-mx-4 font-display text-5xl leading-tight tracking-wide text-gold [overflow-wrap:anywhere]">{t("brand")}</h1>
          </div>

          {destinoCard}

          {whatsappLoginHref ? (
            <div className="space-y-3">
              <a href={whatsappLoginHref} target="_blank" rel="noopener noreferrer" className={WA_BTN} onClick={onStartClick}>
                <WhatsAppGlyph />
                <span className="min-w-0 [overflow-wrap:anywhere]">{en ? "Sign in with WhatsApp" : "Entrar con WhatsApp"}</span>
              </a>
              <p className="text-center text-[15px] leading-snug text-text-secondary">
                {en ? "WhatsApp opens with the message already written: just send it." : "Se abre WhatsApp con el mensaje ya escrito: solo envíalo."}
              </p>
            </div>
          ) : (
            <div className="space-y-3 text-center" role="status">
              <p className="text-[15px] leading-snug text-text-secondary">
                {en ? "Signing in is not available right now. Try again in a few minutes." : "El ingreso no está disponible en este momento. Inténtalo de nuevo en unos minutos."}
              </p>
              <a href={SUPPORT_PATH} className={SECONDARY_BTN}>{en ? "Contact support" : "Escribir a soporte"}</a>
            </div>
          )}

          {terms}
        </main>
      )}

      {view === "tutorial" && whatsappLoginHref && (
        <main className={`${LOGIN_CARD} relative z-10`} data-testid="login-whatsapp" data-view="tutorial">
          <div className="space-y-1">
            <h1 className="font-display text-4xl leading-none tracking-wide text-text-primary [overflow-wrap:anywhere]">
              {en ? "HOW TO SIGN IN WITH WHATSAPP" : "ASÍ ENTRAS CON WHATSAPP"}
            </h1>
            <p className="text-[15px] font-semibold text-text-secondary">
              {en ? <>It takes <strong className="text-text-primary">3 steps</strong>.</> : <>Son <strong className="text-text-primary">3 pasos</strong>.</>}
            </p>
          </div>
          <TutorialWhatsApp onListo={alTerminarTutorial} en={en} />
          <a
            href={whatsappLoginHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={tutorialListo ? undefined : true}
            className={WA_BTN}
            onClick={(event) => {
              if (!tutorialListo) { event.preventDefault(); return; }
              marcarTutorialWhatsAppVisto();
              opened();
            }}
          >
            <WhatsAppGlyph />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {tutorialListo ? (en ? "Open WhatsApp" : "Abrir WhatsApp") : (en ? "Watch the 3 steps…" : "Mira los 3 pasos…")}
            </span>
          </a>
          <button type="button" className={GHOST_BTN} onClick={() => setView("start")}>
            <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{en ? "Back" : "Volver"}</span>
          </button>
        </main>
      )}

      {view === "sent" && (
        <main className={`${LOGIN_CARD} relative z-10`} data-testid="login-whatsapp" data-view="sent">
          <div className="text-center space-y-2">
            <span aria-hidden="true" className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full border border-whatsapp/40 bg-whatsapp/10 text-whatsapp">
              <WhatsAppGlyph className="h-7 w-7" />
            </span>
            <h1 ref={sentHeading} tabIndex={-1} className={`${LOGIN_TITLE} text-3xl leading-tight`}>
              {en ? "FINISH IN WHATSAPP" : "TERMINA EN WHATSAPP"}
            </h1>
          </div>
          <ol className="space-y-3" aria-label={en ? "Steps in WhatsApp" : "Pasos en WhatsApp"}>
            {(en
              ? ["Send the message that is already written.", "Tap «Haz clic para entrar» in the bot's reply.", "Tap «Entrar a La Polla»."]
              : ["Envía el mensaje que ya está escrito.", "Toca «Haz clic para entrar» en la respuesta del bot.", "Toca «Entrar a La Polla»."]
            ).map((text, i) => (
              <li key={i} className="flex items-start gap-3">
                <span aria-hidden="true" className="grid min-h-8 min-w-8 flex-none place-items-center rounded-full px-1 bg-whatsapp font-display text-lg leading-none text-bg-base">{i + 1}</span>
                <span className="min-w-0 pt-1 text-[15px] leading-snug text-text-primary [overflow-wrap:anywhere]">{text}</span>
              </li>
            ))}
          </ol>
          <div className="space-y-3">
            {whatsappLoginHref && (
              <a href={whatsappLoginHref} target="_blank" rel="noopener noreferrer" className={WA_BTN} onClick={opened}>
                <WhatsAppGlyph />
                <span className="min-w-0 [overflow-wrap:anywhere]">{en ? "Open WhatsApp again" : "Volver a WhatsApp"}</span>
              </a>
            )}
            {whatsappLoginHref && (
              <button type="button" className={SECONDARY_BTN} onClick={() => { setTutorialListo(false); setView("tutorial"); }}>
                <PlayCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span>{en ? "See how it works" : "Ver cómo se hace"}</span>
              </button>
            )}
            <button type="button" className={GHOST_BTN} onClick={() => { writeLoginStorage(WA_OPENED_KEY, null); setView("start"); }}>
              <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{en ? "Back" : "Volver"}</span>
            </button>
          </div>
        </main>
      )}
    </div>
  );
}

interface LoginClientProps {
  /** wa.me con el mensaje ya escrito; null si el ingreso por WhatsApp está apagado. */
  whatsappLoginHref?: string | null;
  /** Polla Casa publicada a la que lleva el returnTo, si hay una. */
  pollaDestino?: { name: string; entryCop: number } | null;
}

export default function LoginClient({ whatsappLoginHref = null, pollaDestino = null }: LoginClientProps) {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <LoginInner whatsappLoginHref={whatsappLoginHref} pollaDestino={pollaDestino} />
    </Suspense>
  );
}
