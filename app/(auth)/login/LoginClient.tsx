// app/(auth)/login/LoginClient.tsx — Login con SMS OTP (orquestado por
// Supabase Phone Auth; el proveedor lo decide Supabase). Mismo patrón que
// los-del-sur-app:
//   • Send OTP corre server-side (/api/auth/start-otp → signInWithOtp)
//   • Verify OTP corre server-side (/api/auth/verify-otp) para que las cookies
//     queden persistidas via Set-Cookie HttpOnly — fix del bug iOS Safari.
// El SMS es la vía principal (input → otp). Sin contraseña.
//
// Alternativa: Telegram v2 (2026-09-13, migración 119). Si page.tsx recibe el
// bot de login configurado, el paso del teléfono y el del código ofrecen
// «Entrar con Telegram»: se crea una solicitud atada a este navegador
// (/api/auth/telegram/request, cookie httpOnly), se abre Telegram directo con
// t.me/<bot>?start=<nonce> y esta pestaña espera SIN input. Cuando la persona
// toca Iniciar en el bot, la solicitud queda aprobada y esta pestaña entra
// sola (/status → /complete). No hay código que escribir.
//
// NOTA Turnstile: el cableado del widget se rolleó back porque
// interaction-only no renderaba en algunos browsers y bloqueaba login.
// El gate anti-Twilio-bill-bombing queda en rate-limit por phone hasta
// que volvamos con un widget visible y testeado.
"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, MessageSquare, Loader2, Send } from "lucide-react";
import axios from "axios";
import { useTranslations } from "next-intl";
import { safeReturnTo } from "@/lib/auth/safe-return-to";
import { DAILY_SMS_CAP_CODE, SUPPORT_PATH } from "@/lib/auth/otp-codes";
import TournamentBadge from "@/components/shared/TournamentBadge";
import PhoneInput from "@/components/ui/PhoneInput";

function fmtCOP(n: number): string {
  return `$${n.toLocaleString("es-CO")}`;
}

const RETURN_TO_KEY = "lp_returnTo";
// 60s client-side cooldown after a successful OTP send. Persisted in
// sessionStorage so a refresh / navigation does not reset it. Server-side
// (Supabase auth) also rate-limits, but this gives the user a visible
// countdown instead of a generic "rate limit exceeded" error and stops
// accidental rapid taps from the same browser.
const OTP_COOLDOWN_MS = 60_000;
const OTP_COOLDOWN_KEY = "lp_otp_cooldown_until";

type Step = "input" | "otp" | "telegram";

// Espera de Telegram. En teléfonos con poca memoria el navegador puede recargar
// la pestaña al volver de Telegram: se guarda el deep link y el vencimiento
// (la cookie httpOnly de la solicitud sobrevive sola) para retomar la espera.
const TELEGRAM_PENDING_KEY = "lp_login_telegram_request";
const TELEGRAM_POLL_MS = 2_000;
// Tope absoluto de la espera: 5 min pendiente + 5 min del enlace aprobado.
const TELEGRAM_MAX_WAIT_MS = 10 * 60_000;

type TelegramPhase = "opening" | "waiting" | "completing" | "expired" | "sms_only" | "error";

interface TelegramState {
  phase: TelegramPhase;
  deepLink: string | null;
  popupBlocked: boolean;
  error: string | null;
}

const PRIMARY_BTN =
  "w-full min-h-[48px] bg-gold text-bg-base font-bold py-3 px-4 rounded-xl hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-base leading-snug inline-flex items-center justify-center gap-2 text-center break-words cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card";

// Secundario del sistema: borde sutil, sin oro, objetivo táctil ≥ 44 px.
const SECONDARY_BTN =
  "w-full min-h-[44px] rounded-xl border border-border-subtle bg-transparent px-4 py-3 text-sm leading-snug font-medium text-text-primary hover:border-gold/30 hover:bg-bg-card-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold/40 transition-all duration-200 cursor-pointer inline-flex items-center justify-center gap-2 text-center break-words";

const GHOST_BTN =
  "w-full min-h-[44px] text-text-secondary font-medium py-2 px-4 rounded-xl hover:text-gold hover:bg-bg-card-hover transition-colors flex items-center justify-center gap-1.5 text-sm leading-snug text-center cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold/40";

interface PollaPreview {
  slug: string;
  name: string;
  tournament: string;
  buy_in_amount: number;
  type: string;
  participantCount: number;
}

function readTelegramPending(): { deepLink: string; expiresAt: number; startedAt: number } | null {
  try {
    const raw = window.sessionStorage.getItem(TELEGRAM_PENDING_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { deepLink?: unknown; expiresAt?: unknown; startedAt?: unknown };
    if (
      typeof saved.deepLink === "string" &&
      /^https:\/\/t\.me\/[A-Za-z0-9_]+\?start=[A-Za-z0-9_-]{43}$/.test(saved.deepLink) &&
      typeof saved.expiresAt === "number" &&
      typeof saved.startedAt === "number" &&
      saved.expiresAt > Date.now() &&
      Date.now() - saved.startedAt < TELEGRAM_MAX_WAIT_MS
    ) {
      return { deepLink: saved.deepLink, expiresAt: saved.expiresAt, startedAt: saved.startedAt };
    }
    window.sessionStorage.removeItem(TELEGRAM_PENDING_KEY);
  } catch {
    /* storage bloqueado o JSON dañado: se empieza de cero */
  }
  return null;
}

function writeTelegramPending(value: { deepLink: string; expiresAt: number; startedAt: number } | null) {
  try {
    if (value) window.sessionStorage.setItem(TELEGRAM_PENDING_KEY, JSON.stringify(value));
    else window.sessionStorage.removeItem(TELEGRAM_PENDING_KEY);
  } catch {
    /* sin storage el flujo sigue funcionando, solo no sobrevive una recarga */
  }
}

function LoginInner({ telegramBotUsername }: LoginClientProps) {
  const t = useTranslations("Login");
  const searchParams = useSearchParams();
  const telegramEnabled = Boolean(telegramBotUsername);

  const [step, setStep] = useState<Step>("input");
  // Paso al que vuelve «Cancelar» desde la espera de Telegram.
  const [telegramReturnStep, setTelegramReturnStep] = useState<"input" | "otp">("input");
  const [telegram, setTelegram] = useState<TelegramState>({
    phase: "opening",
    deepLink: null,
    popupBlocked: false,
    error: null,
  });
  const telegramExpiresAt = useRef<number>(0);
  const telegramStartedAt = useRef<number>(0);
  const telegramBusy = useRef(false);
  const telegramHeading = useRef<HTMLHeadingElement>(null);
  // E.164 phone (e.g. "+573001234567") emitted by PhoneInput. The
  // country selector defaults to Colombia but accepts any country
  // Twilio Verify supports.
  const [phoneE164, setPhoneE164] = useState("");
  const [otp, setOtp] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PollaPreview | null>(null);
  // Client-side OTP send cooldown. cooldownUntil is the epoch ms when
  // the user can send again. nowTick triggers a re-render every second
  // so the visible countdown updates.
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());

  // Restore cooldown from sessionStorage on mount (survives refresh /
  // step navigation). If the stored timestamp is in the past, clean it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.sessionStorage.getItem(OTP_COOLDOWN_KEY);
    if (!raw) return;
    const ts = Number.parseInt(raw, 10);
    if (Number.isFinite(ts) && ts > Date.now()) {
      setCooldownUntil(ts);
    } else {
      window.sessionStorage.removeItem(OTP_COOLDOWN_KEY);
    }
  }, []);

  // Retomar la espera de Telegram si la pestaña se recargó al volver de la app.
  useEffect(() => {
    if (!telegramEnabled || typeof window === "undefined") return;
    const saved = readTelegramPending();
    if (!saved) return;
    telegramExpiresAt.current = saved.expiresAt;
    telegramStartedAt.current = saved.startedAt;
    setTelegram({ phase: "waiting", deepLink: saved.deepLink, popupBlocked: false, error: null });
    setStep("telegram");
  }, [telegramEnabled]);

  // Tick once per second only while a cooldown is active. When it
  // finishes, clean up so we are not running a no-op interval.
  useEffect(() => {
    if (!cooldownUntil) return;
    if (cooldownUntil <= Date.now()) {
      setCooldownUntil(null);
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(OTP_COOLDOWN_KEY);
      }
      return;
    }
    const interval = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [cooldownUntil]);

  const cooldownRemaining = cooldownUntil
    ? Math.max(0, Math.ceil((cooldownUntil - nowTick) / 1000))
    : 0;

  // ⛔ Acá NO va ningún signOut() on-mount. Lo hubo (hasta 2026-06-11) y
  // era un footgun: supabase-js signOut() default scope='global' revoca
  // TODAS las sesiones del user en el server. Cualquier visita a /login
  // con sesión válida (tile de "más visitados" de Chrome, bookmark, tab
  // restaurado, link viejo) destruía la sesión en todos los dispositivos
  // → "me pide login cada vez" (reportado por Fede/Lady). El caso real de
  // cambio de cuenta queda cubierto: verify-otp y wa-magic hacen signOut
  // server-side justo antes de mintear la sesión nueva, y además el
  // middleware redirige usuarios autenticados fuera de /login.

  // Capturar returnTo + cargar preview de polla si viene de invite link.
  // safeReturnTo: solo paths internos — sin sanitizar, /login?returnTo=
  // https://evil.com era un open redirect post-login (hallazgo codex
  // 2026-06-11).
  useEffect(() => {
    const rt = safeReturnTo(searchParams.get("returnTo"));
    if (rt && typeof window !== "undefined") {
      window.sessionStorage.setItem(RETURN_TO_KEY, rt);
    }
    const stored =
      rt ??
      (typeof window !== "undefined"
        ? safeReturnTo(window.sessionStorage.getItem(RETURN_TO_KEY))
        : null);
    if (!stored) return;
    const slugMatch = stored.match(/^\/(?:pollas|unirse)\/([^/?#]+)/);
    const tokenMatch = stored.match(/^\/invites\/polla\/([^/?#]+)/);
    if (!slugMatch && !tokenMatch) return;
    const params = new URLSearchParams(
      slugMatch ? { slug: slugMatch[1] } : { token: tokenMatch![1] },
    );
    axios
      .get<{
        polla: Omit<PollaPreview, "participantCount">;
        participantCount: number;
      }>(`/api/pollas/preview?${params.toString()}`)
      .then(({ data }) =>
        setPreview({ ...data.polla, participantCount: data.participantCount }),
      )
      .catch(() => {});
  }, [searchParams]);

  // Navegación post-login común a SMS y Telegram. safeReturnTo también acá:
  // el sessionStorage pudo ser escrito por una versión vieja sin sanitizar (o
  // manipulado) — sanitizar en el punto de NAVEGACIÓN es lo que realmente
  // cierra el open redirect. Hard redirect para que las cookies se apliquen al
  // siguiente request (router.push a veces las pierde en middleware).
  const goAfterLogin = useCallback((newUser: boolean) => {
    const rt =
      typeof window !== "undefined"
        ? safeReturnTo(window.sessionStorage.getItem(RETURN_TO_KEY))
        : null;
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(RETURN_TO_KEY);
    }
    window.location.href = newUser ? "/onboarding" : rt || "/casa";
  }, []);

  // PhoneInput emits an E.164 string already (e.g. "+573001234567")
  // or "" while the user types. Si por alguna razón el state quedó
  // vacío (caso reportado en Brave incognito 2026-05-26 con PhoneInput
  // emitiendo "" aunque el input visualmente tenga dígitos), caemos
  // al DOM y reconstruimos a partir del prefijo del país + número
  // tipeado. Es defense-in-depth: nunca queremos bloquear el send por
  // un bug de state.
  function buildPhone(): string {
    if (phoneE164.trim()) return phoneE164.trim();
    if (typeof document === "undefined") return "";
    const telInput = document.querySelector<HTMLInputElement>(
      'input[type="tel"]',
    );
    const digits = telInput?.value.replace(/\D/g, "") ?? "";
    if (!digits) return "";
    // Detectamos el código de país del botón de selector (texto "+57").
    const ccBtn = document.querySelector<HTMLButtonElement>(
      'button[type="button"] span',
    );
    const ccMatch = ccBtn?.textContent?.match(/\+(\d+)/);
    const cc = ccMatch ? ccMatch[1] : "57";
    return `+${cc}${digits}`;
  }

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // Block re-sends while the per-browser cooldown is active. Even if
    // the user clicks fast, the disabled state on the button covers the
    // happy path; this is the safety net (e.g. Enter key on the form).
    if (cooldownRemaining > 0) {
      setError(t("errCooldown", { seconds: cooldownRemaining }));
      return;
    }
    const phone = buildPhone();
    // Smallest plausible E.164 is "+CCNNNNNNN" (~9 chars total). Twilio
    // Verify itself will reject anything malformed.
    if (!phone.startsWith("+") || phone.replace(/\D/g, "").length < 8) {
      setError(t("errInvalidPhone"));
      return;
    }
    setSending(true);
    try {
      // Server-side: /api/auth/start-otp decide si dispara Supabase
      // (que llama Twilio) o si es un phone admin del bypass list,
      // en cuyo caso devuelve ok sin gastar Twilio. El cliente no se
      // entera de la diferencia — UX idéntica.
      const res = await fetch("/api/auth/start-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          json.code === DAILY_SMS_CAP_CODE
            ? t("errDailySmsCap")
            : json.error || t("errSendFailed"),
        );
        return;
      }
      // Arm the cooldown only after a successful send — failures don't
      // result in an SMS, so it would be unfair to lock the user out.
      const until = Date.now() + OTP_COOLDOWN_MS;
      setCooldownUntil(until);
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(OTP_COOLDOWN_KEY, String(until));
      }
      setStep("otp");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errNetwork"));
    } finally {
      setSending(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (otp.length !== 6) {
      setError(t("errOtpLength"));
      return;
    }
    setVerifying(true);
    try {
      const phone = buildPhone();
      // Server-side: persiste cookies via Set-Cookie HttpOnly (crítico
      // para iOS Safari, donde verifyOtp en el browser deja la sesión
      // en memory pero pierde cookies y al navegar parece no logueado).
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, token: otp }),
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? t("errOtpInvalid"));
        return;
      }
      const body = (await res.json()) as { newUser?: boolean };
      goAfterLogin(Boolean(body?.newUser));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errNetwork"));
    } finally {
      setVerifying(false);
    }
  }

  // ── Telegram ────────────────────────────────────────────────────────────

  // Abre Telegram directo. La ventana se abre en el mismo clic, ANTES del
  // fetch, para que el bloqueador de ventanas no la frene; cuando llega el
  // deep link se navega ahí (en el teléfono abre la app de Telegram). Si el
  // navegador no dejó abrirla, la pantalla de espera muestra un botón grande.
  async function startTelegram(from: "input" | "otp") {
    if (telegramBusy.current) return;
    telegramBusy.current = true;
    setError(null);
    setTelegramReturnStep(from);

    let popup: Window | null = null;
    try {
      popup = window.open("about:blank", "_blank");
      // Telegram no debe poder tocar esta pestaña (tabnabbing).
      if (popup) popup.opener = null;
    } catch {
      popup = null;
    }

    setTelegram({ phase: "opening", deepLink: null, popupBlocked: false, error: null });
    setStep("telegram");

    try {
      const res = await fetch("/api/auth/telegram/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        credentials: "same-origin",
      });
      const body = (await res.json().catch(() => null)) as {
        deepLink?: unknown;
        expiresAt?: unknown;
      } | null;
      const deepLink = typeof body?.deepLink === "string" ? body.deepLink : null;
      const expiresAt =
        typeof body?.expiresAt === "string" ? Date.parse(body.expiresAt) : Number.NaN;
      if (!res.ok || !deepLink || !Number.isFinite(expiresAt)) {
        popup?.close();
        setTelegram({
          phase: "error",
          deepLink: null,
          popupBlocked: false,
          error:
            res.status === 429
              ? t("tgErrRateLimited")
              : res.status === 404
                ? t("tgErrUnavailable")
                : t("tgErrGeneric"),
        });
        return;
      }

      let opened = false;
      if (popup && !popup.closed) {
        try {
          popup.location.href = deepLink;
          opened = true;
        } catch {
          popup.close();
        }
      }
      const startedAt = Date.now();
      telegramExpiresAt.current = expiresAt;
      telegramStartedAt.current = startedAt;
      writeTelegramPending({ deepLink, expiresAt, startedAt });
      setTelegram({ phase: "waiting", deepLink, popupBlocked: !opened, error: null });
    } catch {
      popup?.close();
      setTelegram({ phase: "error", deepLink: null, popupBlocked: false, error: t("errNetwork") });
    } finally {
      telegramBusy.current = false;
    }
  }

  const endTelegramWait = useCallback(
    (phase: Exclude<TelegramPhase, "opening" | "waiting" | "completing">) => {
      writeTelegramPending(null);
      setTelegram((prev) => ({ ...prev, phase }));
    },
    [],
  );

  async function cancelTelegram() {
    writeTelegramPending(null);
    setStep(telegramReturnStep);
    setTelegram({ phase: "opening", deepLink: null, popupBlocked: false, error: null });
    // Mejor esfuerzo: la solicitud también vence sola a los 5 minutos.
    try {
      await fetch("/api/auth/telegram/request", { method: "DELETE", credentials: "same-origin" });
    } catch {
      /* sin red: vence sola */
    }
  }

  const completeTelegram = useCallback(async (): Promise<void> => {
    setTelegram((prev) => ({ ...prev, phase: "completing" }));
    try {
      const res = await fetch("/api/auth/telegram/request/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        credentials: "same-origin",
      });
      const body = (await res.json().catch(() => null)) as {
        newUser?: boolean;
        error?: string;
      } | null;
      if (res.ok) {
        writeTelegramPending(null);
        goAfterLogin(Boolean(body?.newUser));
        return;
      }
      if (res.status === 409 && body?.error === "not_approved") {
        setTelegram((prev) => ({ ...prev, phase: "waiting" }));
        return;
      }
      writeTelegramPending(null);
      if (res.status === 409 && body?.error === "sms_only") {
        setTelegram((prev) => ({ ...prev, phase: "sms_only" }));
      } else if (res.status === 410) {
        setTelegram((prev) => ({ ...prev, phase: "expired" }));
      } else {
        setTelegram((prev) => ({ ...prev, phase: "error", error: t("tgErrGeneric") }));
      }
    } catch {
      setTelegram((prev) => ({ ...prev, phase: "waiting" }));
    }
  }, [goAfterLogin, t]);

  // Consulta el estado cada 2 s mientras la pestaña está visible, y al volver
  // a ella (visibilitychange/focus): al regresar de Telegram entra de una.
  useEffect(() => {
    if (step !== "telegram" || telegram.phase !== "waiting") return;
    let stopped = false;
    let inFlight = false;

    async function poll() {
      if (stopped || inFlight || document.visibilityState !== "visible") return;
      if (
        Date.now() > telegramExpiresAt.current + 5_000 ||
        Date.now() - telegramStartedAt.current > TELEGRAM_MAX_WAIT_MS
      ) {
        endTelegramWait("expired");
        return;
      }
      inFlight = true;
      try {
        const res = await fetch("/api/auth/telegram/request/status", {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (stopped || !res.ok) return;
        const body = (await res.json().catch(() => null)) as {
          status?: string;
          expiresAt?: string | null;
        } | null;
        const expires = body?.expiresAt ? Date.parse(body.expiresAt) : Number.NaN;
        if (Number.isFinite(expires)) telegramExpiresAt.current = expires;
        switch (body?.status) {
          case "approved":
            stopped = true;
            await completeTelegram();
            break;
          case "consumed":
            // Entró con el enlace del bot en este mismo navegador.
            stopped = true;
            writeTelegramPending(null);
            goAfterLogin(false);
            break;
          case "cancelled":
            stopped = true;
            endTelegramWait("sms_only");
            break;
          case "expired":
          case "invalid":
            stopped = true;
            endTelegramWait("expired");
            break;
          default:
            break;
        }
      } catch {
        /* sin red: se reintenta en el próximo ciclo */
      } finally {
        inFlight = false;
      }
    }

    const interval = window.setInterval(poll, TELEGRAM_POLL_MS);
    const onReturn = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    void poll();
    return () => {
      stopped = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [step, telegram.phase, completeTelegram, endTelegramWait, goAfterLogin]);

  // Al cambiar de estado la espera, el foco va al título: un lector de
  // pantalla anuncia la nueva situación y el teclado sigue en la tarjeta.
  useEffect(() => {
    if (step !== "telegram") return;
    if (telegram.phase === "expired" || telegram.phase === "sms_only" || telegram.phase === "error") {
      telegramHeading.current?.focus();
    }
  }, [step, telegram.phase]);

  const telegramTitle =
    telegram.phase === "expired"
      ? t("tgExpiredTitle")
      : telegram.phase === "sms_only"
        ? t("tgSmsOnlyTitle")
        : telegram.phase === "error"
          ? t("tgErrorTitle")
          : t("tgWaitTitle");

  const telegramMessage =
    telegram.phase === "expired"
      ? t("tgExpired")
      : telegram.phase === "sms_only"
        ? t("tgErrSmsOnly")
        : telegram.phase === "error"
          ? (telegram.error ?? t("tgErrGeneric"))
          : telegram.popupBlocked
            ? t("tgPopupBlocked")
            : t("tgWaitBody");

  const telegramStatus =
    telegram.phase === "opening"
      ? t("tgOpening")
      : telegram.phase === "completing"
        ? t("tgCompleting")
        : telegram.phase === "waiting"
          ? t("tgWaiting")
          : null;

  function backToSms() {
    writeTelegramPending(null);
    setError(null);
    setStep("input");
    setTelegram({ phase: "opening", deepLink: null, popupBlocked: false, error: null });
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {step === "input" && (
        <div className="w-full max-w-md rounded-2xl p-6 space-y-6 bg-bg-card/80 backdrop-blur-sm border border-border-subtle relative z-10">
          <div className="text-center space-y-2">
            <motion.div
              className="mx-auto"
              style={{ width: 80, height: 80, position: "relative" }}
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/pollitos/logo_realistic-192.webp"
                alt={t("brand")}
                width={80}
                height={80}
                style={{
                  width: 80,
                  height: 80,
                  objectFit: "contain",
                  position: "relative",
                }}
              />
            </motion.div>
            <h1
              className="font-display text-5xl tracking-wide"
              style={{
                color: "var(--gold)",

              }}
            >
              {t("brand")}
            </h1>
            <p className="text-text-muted text-sm">
              {t("tagline")}
            </p>
          </div>

          {preview && (
            <div className="rounded-2xl p-4 border border-gold/30 bg-gold/5 space-y-1.5 text-center">
              <p className="text-[11px] uppercase tracking-wider text-text-muted">
                {t("invitedTo")}
              </p>
              <p className="font-display text-2xl text-text-primary tracking-wide">
                {preview.name}
              </p>
              <div className="flex items-center justify-center gap-2 text-xs text-text-secondary">
                <TournamentBadge
                  tournamentSlug={preview.tournament}
                  size="sm"
                />
              </div>
              <p className="text-xs text-text-secondary">
                {t("participants", { count: preview.participantCount })}
                {preview.buy_in_amount > 0
                  ? ` · ${t("perPerson", { amount: fmtCOP(preview.buy_in_amount) })}`
                  : ` · ${t("free")}`}
              </p>
            </div>
          )}

          <form onSubmit={handleSendOtp} className="space-y-4">
            <div>
              <label
                htmlFor="phone"
                className="block text-sm font-medium text-text-secondary mb-1.5"
              >
                {t("phoneLabel")}
              </label>
              <PhoneInput onChange={setPhoneE164} />
            </div>

            {error && (
              <p className="text-red-alert text-sm text-center bg-red-dim rounded-xl p-2.5">
                {error}
                {/* Tope diario de SMS: la salida es soporte (WhatsApp está apagado). */}
                {error === t("errDailySmsCap") && (
                  <a
                    href={SUPPORT_PATH}
                    className="block py-2.5 font-semibold text-text-primary underline underline-offset-2 hover:text-gold transition-colors"
                  >
                    {t("errDailySmsCapSupport")}
                  </a>
                )}
              </p>
            )}

            <div className="grid grid-cols-1">
              <button
                type="submit"
                disabled={sending || cooldownRemaining > 0}
                className="bg-gold text-bg-base font-bold py-3.5 px-3 rounded-xl hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-base leading-snug inline-flex items-center justify-center gap-2 text-center break-words min-h-[48px]"
                style={{ boxShadow: "0 0 20px rgba(255, 215, 0, 0.15)" }}
              >
                {sending ? (
                  <>
                    <Loader2 className="w-5 h-5 shrink-0 animate-spin" />
                    {t("btnSending")}
                  </>
                ) : cooldownRemaining > 0 ? (
                  <>{t("btnWaitSeconds", { seconds: cooldownRemaining })}</>
                ) : (
                  <>
                    <MessageSquare className="w-5 h-5 shrink-0" aria-hidden="true" />
                    {t("btnSms")}
                  </>
                )}
              </button>

            </div>

            {telegramEnabled && (
              <div className="space-y-3">
                <div className="flex items-center gap-3" aria-hidden="true">
                  <span className="h-px flex-1 bg-border-subtle" />
                  <span className="text-xs text-text-muted">{t("tgOr")}</span>
                  <span className="h-px flex-1 bg-border-subtle" />
                </div>
                <button
                  type="button"
                  onClick={() => void startTelegram("input")}
                  className={SECONDARY_BTN}
                >
                  <Send className="w-5 h-5 shrink-0" aria-hidden="true" />
                  <span>{t("tgUseTelegram")}</span>
                </button>
              </div>
            )}
          </form>

          <p className="text-[10px] text-text-muted/70 text-center pt-1">
            {t("termsHint")}
          </p>
        </div>
      )}

      {step === "otp" && (
        <div className="w-full max-w-md rounded-2xl p-6 space-y-5 bg-bg-card/80 backdrop-blur-sm border border-border-subtle">
          <div className="text-center space-y-2">
            <h2 className="font-display text-2xl text-gold tracking-wide">
              {t("otpTitle")}
            </h2>
            <p className="text-text-secondary text-sm">
              {t("otpSentTo")}{" "}
              <span className="text-text-primary font-semibold [overflow-wrap:anywhere]">
                {buildPhone()}
              </span>
            </p>
            <button
              type="button"
              onClick={() => {
                setStep("input");
                setOtp("");
                setError(null);
              }}
              className="inline-flex min-h-[44px] items-center px-3 text-xs text-gold/70 hover:text-gold transition-colors"
            >
              {t("otpChangePhone")}
            </button>
          </div>

          <form onSubmit={handleVerifyOtp} className="space-y-3">
            <input
              type="text"
              maxLength={6}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              aria-label={t("otpTitle")}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              className="w-full px-4 py-4 rounded-xl outline-none text-center score-font text-[36px] tracking-[0.5em] [text-indent:0.5em] transition-colors bg-bg-base border border-border-subtle text-text-primary placeholder:text-text-muted focus:border-gold/50"
              required
              autoFocus
              disabled={verifying}
            />

            {error && (
              <p className="text-red-alert text-sm text-center bg-red-dim rounded-xl p-2.5">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={verifying || otp.length !== 6}
              className="w-full bg-gold text-bg-base font-bold py-3 px-4 rounded-xl hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-base inline-flex items-center justify-center gap-2"
              style={{ boxShadow: "0 0 20px rgba(255, 215, 0, 0.15)" }}
            >
              {verifying ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {t("otpVerifying")}
                </>
              ) : (
                t("otpVerify")
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setStep("input");
                setOtp("");
                setError(null);
              }}
              className="w-full min-h-[44px] text-text-secondary font-medium py-2 hover:text-gold transition-colors flex items-center justify-center gap-1.5 text-sm leading-snug text-center"
            >
              <ArrowLeft className="w-4 h-4 shrink-0" /> {t("otpResend")}
            </button>
          </form>

          {telegramEnabled && (
            <div className="space-y-3 border-t border-border-subtle pt-4">
              <p className="text-sm text-text-secondary text-center">
                {t("tgDidntArrive")}
              </p>
              <button
                type="button"
                onClick={() => void startTelegram("otp")}
                className={SECONDARY_BTN}
              >
                <Send className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span>{t("tgUseTelegram")}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {step === "telegram" && (
        <div
          className="w-full max-w-md rounded-2xl p-6 space-y-5 bg-bg-card/80 backdrop-blur-sm border border-border-subtle"
          data-testid="telegram-wait"
          data-phase={telegram.phase}
        >
          <div className="text-center space-y-3">
            <span
              aria-hidden="true"
              className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full border border-border-subtle bg-bg-elevated"
            >
              <Send className="h-6 w-6 text-text-primary" />
            </span>
            <h2
              ref={telegramHeading}
              tabIndex={-1}
              className="font-display text-2xl text-gold tracking-wide outline-none break-words"
            >
              {telegramTitle}
            </h2>
            <p className="text-text-secondary text-sm leading-relaxed break-words">
              {telegramMessage}
            </p>
          </div>

          <p
            role="status"
            aria-live="polite"
            className="flex items-center justify-center gap-2 text-center text-sm leading-snug text-text-primary empty:hidden"
          >
            {telegramStatus && (
              <>
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gold" aria-hidden="true" />
                <span className="min-w-0 break-words">{telegramStatus}</span>
              </>
            )}
          </p>

          <div className="space-y-3">
            {(telegram.phase === "waiting" || telegram.phase === "completing") && telegram.deepLink && (
              <a
                href={telegram.deepLink}
                target="_blank"
                rel="noopener noreferrer"
                className={telegram.popupBlocked ? PRIMARY_BTN : SECONDARY_BTN}
                style={telegram.popupBlocked ? { boxShadow: "0 0 20px rgba(255, 215, 0, 0.15)" } : undefined}
              >
                <Send className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span>{telegram.popupBlocked ? t("tgOpenBot") : t("tgOpenAgain")}</span>
              </a>
            )}

            {(telegram.phase === "expired" || telegram.phase === "error") && (
              <button
                type="button"
                onClick={() => void startTelegram(telegramReturnStep)}
                className={PRIMARY_BTN}
                style={{ boxShadow: "0 0 20px rgba(255, 215, 0, 0.15)" }}
              >
                <Send className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span>{t("tgRetry")}</span>
              </button>
            )}

            {telegram.phase === "sms_only" ? (
              <button type="button" onClick={backToSms} className={PRIMARY_BTN}>
                <MessageSquare className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span>{t("tgUseSms")}</span>
              </button>
            ) : telegram.phase === "expired" || telegram.phase === "error" ? (
              <button type="button" onClick={backToSms} className={SECONDARY_BTN}>
                <MessageSquare className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span>{t("tgUseSms")}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void cancelTelegram()}
                disabled={telegram.phase === "completing"}
                className={`${GHOST_BTN} disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                <ArrowLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{t("tgCancel")}</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface LoginClientProps {
  /** Usuario del bot de login de Telegram; null si el canal está apagado. */
  telegramBotUsername: string | null;
}

export default function LoginClient({ telegramBotUsername }: LoginClientProps) {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <LoginInner telegramBotUsername={telegramBotUsername} />
    </Suspense>
  );
}
