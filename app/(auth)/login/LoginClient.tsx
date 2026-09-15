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
// t.me/<bot>?start=<nonce> y esta pestaña espera SIN input, con los pasos.
// En Telegram, el bot manda el botón «Entrar a La Polla» (enlace de un solo
// uso): ese enlace es lo ÚNICO que abre sesión, en el navegador donde se abre.
// Esta pestaña nunca entra por la aprobación (eso sería phishing tipo device
// code); consulta /status y, si el enlace se abrió en este mismo navegador,
// ya tiene la sesión y sigue. Si se abrió en otro (el de Telegram), lo explica.
//
// Captcha (2026-09-14): si page.tsx recibe la site key de Turnstile, el paso
// del teléfono muestra el widget (components/auth/SmsCaptcha.tsx) y el envío
// del SMS lleva `captchaToken`. Quien decide es Supabase Auth
// (security_captcha_enabled) o, con SMS_CAPTCHA_ENFORCED, start-otp. Con la
// captcha obligatoria (smsCaptchaRequired) no se envía sin token: si
// Cloudflare no carga, se ofrece reintentar. Sin ella, un widget roto no
// bloquea y se envía sin token. Telegram no usa la captcha.
"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, MessageSquare, Loader2, Send } from "lucide-react";
import axios from "axios";
import { useTranslations } from "next-intl";
import { safeReturnTo } from "@/lib/auth/safe-return-to";
import { CAPTCHA_FAILED_CODE, DAILY_SMS_CAP_CODE, SUPPORT_PATH } from "@/lib/auth/otp-codes";
import { prefersSameTab } from "@/lib/auth/telegram-login/open-mode";
import SmsCaptcha, { type SmsCaptchaHandle, type SmsCaptchaStatus } from "@/components/auth/SmsCaptcha";
import TournamentBadge from "@/components/shared/TournamentBadge";
import PhoneInput from "@/components/ui/PhoneInput";
import {
  GHOST_BTN,
  LOGIN_CARD,
  LOGIN_TITLE,
  PRIMARY_BTN,
  PRIMARY_GLOW,
  SECONDARY_BTN,
} from "@/components/auth/login-styles";

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
// Tope absoluto de la espera: 5 min pendiente + 5 min del enlace emitido.
const TELEGRAM_MAX_WAIT_MS = 10 * 60_000;
// Consumida sin sesión: margen para que llegue la cookie si el enlace se abrió
// en otra pestaña de este mismo navegador.
const TELEGRAM_SESSION_GRACE_MS = 6_000;

type TelegramPhase =
  | "opening"
  | "waiting"
  | "elsewhere"
  | "expired"
  | "sms_only"
  | "rate_limited"
  | "unavailable"
  | "error";

interface TelegramState {
  phase: TelegramPhase;
  deepLink: string | null;
  /** Escritorio: el navegador no dejó abrir la ventana de Telegram. */
  popupBlocked: boolean;
  /** El bot ya mandó el botón del enlace (solicitud «approved»). */
  linkSent: boolean;
  /** Teléfono o tableta: Telegram se abre en ESTA pestaña, sin pestaña extra. */
  sameTab: boolean;
  error: string | null;
}

const TELEGRAM_IDLE: TelegramState = {
  phase: "opening",
  deepLink: null,
  popupBlocked: false,
  linkSent: false,
  sameTab: false,
  error: null,
};

interface PollaPreview {
  slug: string;
  name: string;
  tournament: string;
  buy_in_amount: number;
  type: string;
  participantCount: number;
}

interface TelegramPending {
  deepLink: string;
  expiresAt: number;
  startedAt: number;
  sameTab: boolean;
}

function readTelegramPending(): TelegramPending | null {
  try {
    const raw = window.sessionStorage.getItem(TELEGRAM_PENDING_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as {
      deepLink?: unknown;
      expiresAt?: unknown;
      startedAt?: unknown;
      sameTab?: unknown;
    };
    if (
      typeof saved.deepLink === "string" &&
      /^https:\/\/t\.me\/[A-Za-z0-9_]+\?start=[A-Za-z0-9_-]{43}$/.test(saved.deepLink) &&
      typeof saved.expiresAt === "number" &&
      typeof saved.startedAt === "number" &&
      saved.expiresAt > Date.now() &&
      Date.now() - saved.startedAt < TELEGRAM_MAX_WAIT_MS
    ) {
      return {
        deepLink: saved.deepLink,
        expiresAt: saved.expiresAt,
        startedAt: saved.startedAt,
        sameTab: saved.sameTab === true,
      };
    }
    window.sessionStorage.removeItem(TELEGRAM_PENDING_KEY);
  } catch {
    /* storage bloqueado o JSON dañado: se empieza de cero */
  }
  return null;
}

function writeTelegramPending(value: TelegramPending | null) {
  try {
    if (value) window.sessionStorage.setItem(TELEGRAM_PENDING_KEY, JSON.stringify(value));
    else window.sessionStorage.removeItem(TELEGRAM_PENDING_KEY);
  } catch {
    /* sin storage el flujo sigue funcionando, solo no sobrevive una recarga */
  }
}

function LoginInner({ telegramBotUsername, turnstileSiteKey, smsCaptchaRequired }: LoginClientProps) {
  const t = useTranslations("Login");
  const searchParams = useSearchParams();
  const telegramEnabled = Boolean(telegramBotUsername);

  // Captcha del SMS. El token vive en un ref (no re-renderiza el formulario).
  const captcha = useRef<SmsCaptchaHandle>(null);
  const captchaToken = useRef<string | null>(null);
  const [captchaStatus, setCaptchaStatus] = useState<SmsCaptchaStatus>("loading");
  const onCaptchaToken = useCallback((token: string | null) => {
    captchaToken.current = token;
  }, []);

  const [step, setStep] = useState<Step>("input");
  // Paso al que vuelve «Cancelar» desde la espera de Telegram.
  const [telegramReturnStep, setTelegramReturnStep] = useState<"input" | "otp">("input");
  const [telegram, setTelegram] = useState<TelegramState>(TELEGRAM_IDLE);
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
    setTelegram({
      ...TELEGRAM_IDLE,
      phase: "waiting",
      deepLink: saved.deepLink,
      sameTab: saved.sameTab,
    });
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
    // Con captcha: esperar el token si el widget sigue trabajando o pide la
    // casilla. Si el widget falló: con captcha obligatoria se pide reintentar;
    // sin ella, se envía sin token y decide Supabase.
    let token: string | null = null;
    if (turnstileSiteKey) {
      if (captchaStatus === "interactive") {
        setError(t("captchaCheckbox"));
        return;
      }
      token = captchaToken.current;
      if (!token && captchaStatus === "error" && smsCaptchaRequired) {
        setError(t("captchaFailed"));
        return;
      }
      if (!token && captchaStatus !== "error") {
        setError(t("captchaWait"));
        return;
      }
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
        body: JSON.stringify(token ? { phone, captchaToken: token } : { phone }),
      });
      // El token ya se usó (salga bien o mal): se pide uno nuevo.
      if (token) captcha.current?.reset();
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          json.code === DAILY_SMS_CAP_CODE
            ? t("errDailySmsCap")
            : json.code === CAPTCHA_FAILED_CODE
              ? t("errCaptchaRejected")
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

  // Abre Telegram directo.
  //   - Teléfono o tableta (open-mode.ts): pide la solicitud y navega ESTA pestaña al deep link
  //     (la app de Telegram lo intercepta). Al volver, el navegador muestra
  //     esta misma pestaña esperando. Si la pestaña se descarga, sessionStorage
  //     y la cookie retoman la espera.
  //   - Escritorio: la ventana se abre en el mismo clic, ANTES del fetch, para
  //     que el bloqueador no la frene; si igual la bloquea, un botón grande.
  async function startTelegram(from: "input" | "otp") {
    if (telegramBusy.current) return;
    telegramBusy.current = true;
    setError(null);
    setTelegramReturnStep(from);

    const sameTab = prefersSameTab();
    let popup: Window | null = null;
    if (!sameTab) {
      try {
        popup = window.open("about:blank", "_blank");
        // Telegram no debe poder tocar esta pestaña (tabnabbing).
        if (popup) popup.opener = null;
      } catch {
        popup = null;
      }
    }

    setTelegram({ ...TELEGRAM_IDLE, sameTab });
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
        // 429 y 404 no se arreglan reintentando: el SMS pasa a ser lo primero.
        setTelegram({
          ...TELEGRAM_IDLE,
          sameTab,
          phase: res.status === 429 ? "rate_limited" : res.status === 404 ? "unavailable" : "error",
        });
        return;
      }

      const startedAt = Date.now();
      telegramExpiresAt.current = expiresAt;
      telegramStartedAt.current = startedAt;
      writeTelegramPending({ deepLink, expiresAt, startedAt, sameTab });

      if (sameTab) {
        setTelegram({ ...TELEGRAM_IDLE, sameTab, phase: "waiting", deepLink });
        window.location.assign(deepLink);
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
      setTelegram({ ...TELEGRAM_IDLE, sameTab, phase: "waiting", deepLink, popupBlocked: !opened });
    } catch {
      popup?.close();
      setTelegram({ ...TELEGRAM_IDLE, sameTab, phase: "error", error: t("errNetwork") });
    } finally {
      telegramBusy.current = false;
    }
  }

  const endTelegramWait = useCallback(
    (phase: Exclude<TelegramPhase, "opening" | "waiting">) => {
      writeTelegramPending(null);
      setTelegram((prev) => ({ ...prev, phase }));
    },
    [],
  );

  async function cancelTelegram() {
    writeTelegramPending(null);
    setStep(telegramReturnStep);
    setTelegram(TELEGRAM_IDLE);
    // Mejor esfuerzo: la solicitud también vence sola a los 5 minutos.
    try {
      await fetch("/api/auth/telegram/request", { method: "DELETE", credentials: "same-origin" });
    } catch {
      /* sin red: vence sola */
    }
  }

  // Consulta el estado cada 2 s mientras la pestaña está visible, y al volver
  // a ella (visibilitychange/focus/pageshow). Esta pestaña NUNCA abre sesión:
  // si el enlace del bot se abrió en este mismo navegador la sesión ya está en
  // las cookies (signedIn) y sigue; si se abrió en otro, lo explica.
  useEffect(() => {
    if (step !== "telegram" || telegram.phase !== "waiting") return;
    let stopped = false;
    let inFlight = false;
    let consumedSince: number | null = null;

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
          signedIn?: boolean;
        } | null;
        const expires = body?.expiresAt ? Date.parse(body.expiresAt) : Number.NaN;
        if (Number.isFinite(expires)) telegramExpiresAt.current = expires;
        switch (body?.status) {
          case "approved":
            // El bot ya mandó el botón: se sigue esperando a que lo abran.
            setTelegram((prev) => (prev.linkSent ? prev : { ...prev, linkSent: true }));
            break;
          case "consumed":
            if (body.signedIn === true) {
              stopped = true;
              writeTelegramPending(null);
              goAfterLogin(false);
              break;
            }
            // La fila se consume en la base ANTES de que la otra pestaña de
            // este mismo navegador reciba las cookies de sesión: se espera un
            // poco antes de concluir que el enlace se abrió en otro navegador.
            consumedSince ??= Date.now();
            if (Date.now() - consumedSince >= TELEGRAM_SESSION_GRACE_MS) {
              stopped = true;
              endTelegramWait("elsewhere");
            }
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
    window.addEventListener("pageshow", onReturn);
    void poll();
    return () => {
      stopped = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
      window.removeEventListener("pageshow", onReturn);
    };
  }, [step, telegram.phase, endTelegramWait, goAfterLogin]);

  // Al cambiar de estado la espera, el foco va al título: un lector de
  // pantalla anuncia la nueva situación y el teclado sigue en la tarjeta.
  useEffect(() => {
    if (step !== "telegram") return;
    if (telegram.phase !== "opening" && telegram.phase !== "waiting") {
      telegramHeading.current?.focus();
    }
  }, [step, telegram.phase]);

  const telegramTitle = {
    opening: t("tgWaitTitle"),
    waiting: t("tgWaitTitle"),
    elsewhere: t("tgElsewhereTitle"),
    expired: t("tgExpiredTitle"),
    sms_only: t("tgSmsOnlyTitle"),
    rate_limited: t("tgRateLimitedTitle"),
    unavailable: t("tgSmsOnlyTitle"),
    error: t("tgErrorTitle"),
  }[telegram.phase];

  const telegramMessage = {
    opening: null,
    waiting: telegram.popupBlocked ? t("tgPopupBlocked") : null,
    elsewhere: t("tgElsewhere"),
    expired: t("tgExpired"),
    sms_only: t("tgErrSmsOnly"),
    rate_limited: t("tgErrRateLimited"),
    unavailable: t("tgErrUnavailable"),
    error: telegram.error ?? t("tgErrGeneric"),
  }[telegram.phase];

  const telegramWaiting = telegram.phase === "opening" || telegram.phase === "waiting";

  // Sin «Esperando…» mientras Telegram no se abrió (ventana bloqueada).
  const telegramStatus =
    telegram.phase === "opening"
      ? t("tgOpening")
      : telegram.phase === "waiting" && !telegram.popupBlocked
        ? telegram.linkSent
          ? t("tgLinkSent")
          : t("tgWaiting")
        : null;

  // Pantallas donde reintentar Telegram no sirve ahora: el SMS va primero.
  const telegramSmsFirst =
    telegram.phase === "sms_only" ||
    telegram.phase === "rate_limited" ||
    telegram.phase === "unavailable" ||
    telegram.phase === "elsewhere";

  function backToSms() {
    writeTelegramPending(null);
    setError(null);
    setStep("input");
    setTelegram(TELEGRAM_IDLE);
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

            <div className="grid grid-cols-1 gap-3">
              {turnstileSiteKey && (
                <SmsCaptcha
                  ref={captcha}
                  siteKey={turnstileSiteKey}
                  onToken={onCaptchaToken}
                  onStatus={setCaptchaStatus}
                />
              )}
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
            {t.rich("termsHint", {
              link: (chunks) => (
                <a
                  href="/privacy#sms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-text-secondary"
                >
                  {chunks}
                </a>
              ),
            })}
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
          className={LOGIN_CARD}
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
            <h2 ref={telegramHeading} tabIndex={-1} className={LOGIN_TITLE}>
              {telegramTitle}
            </h2>
            {telegramMessage && (
              <p className="text-text-secondary text-sm leading-relaxed break-words">
                {telegramMessage}
              </p>
            )}
          </div>

          {telegramWaiting && (
            <ol
              aria-label={t("tgStepsLabel")}
              className="space-y-2 text-left text-sm leading-relaxed text-text-secondary"
            >
              {[t("tgStep1"), t("tgStep2"), t("tgStep3")].map((text, i) => (
                <li key={i} className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className="font-display text-xl leading-6 text-text-primary tabular-nums shrink-0 w-5 text-center"
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 break-words">{text}</span>
                </li>
              ))}
            </ol>
          )}

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
            {telegram.phase === "waiting" && telegram.deepLink && (
              <a
                href={telegram.deepLink}
                // Teléfono o tableta: misma pestaña (la app intercepta y se vuelve aquí).
                target={telegram.sameTab ? undefined : "_blank"}
                rel="noopener noreferrer"
                onClick={() => {
                  if (telegram.popupBlocked) {
                    setTelegram((prev) => ({ ...prev, popupBlocked: false }));
                  }
                }}
                className={telegram.popupBlocked ? PRIMARY_BTN : SECONDARY_BTN}
                style={telegram.popupBlocked ? PRIMARY_GLOW : undefined}
              >
                <Send className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span>{telegram.popupBlocked ? t("tgOpenBot") : t("tgOpenAgain")}</span>
              </a>
            )}

            {(telegram.phase === "expired" || telegram.phase === "error") && (
              <>
                <button
                  type="button"
                  onClick={() => void startTelegram(telegramReturnStep)}
                  className={PRIMARY_BTN}
                  style={PRIMARY_GLOW}
                >
                  <Send className="w-5 h-5 shrink-0" aria-hidden="true" />
                  <span>{t("tgRetry")}</span>
                </button>
                <button type="button" onClick={backToSms} className={SECONDARY_BTN}>
                  <MessageSquare className="w-5 h-5 shrink-0" aria-hidden="true" />
                  <span>{t("tgUseSms")}</span>
                </button>
              </>
            )}

            {telegramSmsFirst && (
              <button type="button" onClick={backToSms} className={PRIMARY_BTN} style={PRIMARY_GLOW}>
                <MessageSquare className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span>{t("tgUseSms")}</span>
              </button>
            )}

            {telegram.phase === "elsewhere" && (
              <button
                type="button"
                onClick={() => void startTelegram(telegramReturnStep)}
                className={SECONDARY_BTN}
              >
                <Send className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span>{t("tgRetryTelegram")}</span>
              </button>
            )}

            {telegramWaiting && (
              <button type="button" onClick={() => void cancelTelegram()} className={GHOST_BTN}>
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
  /** Site key pública de Cloudflare Turnstile; null si la captcha no está configurada. */
  turnstileSiteKey: string | null;
  /** start-otp exige el token (SMS_CAPTCHA_ENFORCED): nunca enviar sin él. */
  smsCaptchaRequired: boolean;
}

export default function LoginClient({ telegramBotUsername, turnstileSiteKey, smsCaptchaRequired }: LoginClientProps) {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <LoginInner
        telegramBotUsername={telegramBotUsername}
        turnstileSiteKey={turnstileSiteKey}
        smsCaptchaRequired={smsCaptchaRequired}
      />
    </Suspense>
  );
}
