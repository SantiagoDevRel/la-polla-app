// app/(auth)/login/LoginClient.tsx — Login con SMS OTP (orquestado por
// Supabase Phone Auth; el proveedor lo decide Supabase). Mismo patrón que
// los-del-sur-app:
//   • Send OTP corre server-side (/api/auth/start-otp → signInWithOtp)
//   • Verify OTP corre server-side (/api/auth/verify-otp) para que las cookies
//     queden persistidas via Set-Cookie HttpOnly — fix del bug iOS Safari.
// WhatsApp ofrece el acceso principal; SMS y contraseña son alternativas.
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
import { ArrowLeft, ArrowRight, MessageSquare, KeyRound, Loader2, Send } from "lucide-react";
import axios from "axios";
import { useTranslations, useLocale } from "next-intl";
import { safeReturnTo } from "@/lib/auth/safe-return-to";
import { loginRequest, readLoginStorage, writeLoginStorage } from "@/lib/auth/login-request";
import { loadProfile } from "@/lib/users/profile-client";
import { needsName } from "@/lib/users/needs-name";
import { normalizePhone } from "@/lib/auth/phone";
import {
  CAPTCHA_FAILED_CODE,
  COUNTRY_NOT_ALLOWED_CODE,
  DAILY_SMS_CAP_CODE,
  SUPPORT_PATH,
} from "@/lib/auth/otp-codes";
import { prefersSameTab } from "@/lib/auth/telegram-login/open-mode";
import SmsCaptcha, { type SmsCaptchaHandle, type SmsCaptchaStatus } from "@/components/auth/SmsCaptcha";
import PasswordInput from "@/components/auth/PasswordInput";
import TournamentBadge from "@/components/shared/TournamentBadge";
import PhoneInput from "@/components/ui/PhoneInput";
import { PAISES_SMS } from "@/lib/sms/paises";
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
const OTP_PENDING_KEY = "lp_otp_pending";

type Step = "input" | "otp" | "telegram" | "recovery";

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

function WhatsAppLoginButton({ href, en }: { href: string; en: boolean }) {
  return <a href={href} className="w-full min-h-[52px] inline-flex flex-wrap items-center justify-center gap-2 rounded-xl bg-whatsapp px-4 py-3.5 text-base leading-snug font-semibold text-bg-base text-center cursor-pointer hover:brightness-110 active:scale-[0.98] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whatsapp focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card">
    <svg className="h-6 w-6 shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.002-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
    </svg>
    <span className="min-w-0 [overflow-wrap:anywhere]">{en ? "Sign in with WhatsApp" : "Entrar con WhatsApp"}</span>
  </a>;
}

function LoginInner({ telegramBotUsername, turnstileSiteKey, smsCaptchaRequired, deliveryChannel = "sms", passwordLoginEnabled = false, whatsappLoginHref = null }: LoginClientProps) {
  const en = useLocale() === "en";
  const [passwordMode, setPasswordMode] = useState(false);
  const [password, setPassword] = useState("");
  const recoveryHeading = useRef<HTMLHeadingElement>(null);
  const t = useTranslations("Login");
  const channelText = useTranslations("PhoneOtp");
  const channelLabel = deliveryChannel === "whatsapp" ? "WhatsApp" : "SMS";
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
  useEffect(() => {
    if (step === "recovery") recoveryHeading.current?.focus();
  }, [step]);
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
  const otpPhone = useRef("");
  const loginBusy = useRef(false);
  const returnTo = useRef<string | null>(null);
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
    const raw = readLoginStorage(OTP_COOLDOWN_KEY);
    if (!raw) return;
    const ts = Number.parseInt(raw, 10);
    if (Number.isFinite(ts) && ts > Date.now() && ts <= Date.now() + OTP_COOLDOWN_MS) {
      setCooldownUntil(ts);
    } else {
      writeLoginStorage(OTP_COOLDOWN_KEY, null);
    }
  }, []);

  // Do not force another paid code when a browser reloads while waiting for it.
  useEffect(() => {
    try {
      const pending = JSON.parse(readLoginStorage(OTP_PENDING_KEY) || "null");
      if (pending && /^\+[1-9]\d{7,14}$/.test(pending.phone) &&
          typeof pending.sentAt === "number" && pending.sentAt <= Date.now() && Date.now() - pending.sentAt < 10 * 60_000) {
        otpPhone.current = pending.phone;
        setPhoneE164(pending.phone);
        setStep("otp");
      } else writeLoginStorage(OTP_PENDING_KEY, null);
    } catch { writeLoginStorage(OTP_PENDING_KEY, null); }
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
        writeLoginStorage(OTP_COOLDOWN_KEY, null);
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
  // cambio de cuenta queda cubierto: verifyOtp reemplaza las cookies
  // server-side cuando confirma la sesión nueva, y además el
  // middleware redirige usuarios autenticados fuera de /login.

  // Capturar returnTo + cargar preview de polla si viene de invite link.
  // safeReturnTo: solo paths internos — sin sanitizar, /login?returnTo=
  // https://evil.com era un open redirect post-login (hallazgo codex
  // 2026-06-11).
  useEffect(() => {
    const rt = safeReturnTo(searchParams.get("returnTo"));
    if (rt && typeof window !== "undefined") {
      writeLoginStorage(RETURN_TO_KEY, rt);
    }
    const stored =
      rt ??
      (typeof window !== "undefined"
        ? safeReturnTo(readLoginStorage(RETURN_TO_KEY))
        : null);
    returnTo.current = stored;
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
        ? returnTo.current || safeReturnTo(readLoginStorage(RETURN_TO_KEY))
        : null;
    if (typeof window !== "undefined" && !newUser) {
      writeLoginStorage(RETURN_TO_KEY, null);
    }
    writeLoginStorage(OTP_PENDING_KEY, null);
    window.location.href = newUser ? `/onboarding${rt ? `?returnTo=${encodeURIComponent(rt)}` : ""}` : rt || "/inicio";
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
    if (loginBusy.current) return;
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
    if (navigator.onLine === false) { setError(t("errNetwork")); return; }
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
    loginBusy.current = true;
    setSending(true);
    try {
      // Server-side: /api/auth/start-otp decide si dispara Supabase
      // (que llama Twilio) o si es un phone admin del bypass list,
      // en cuyo caso devuelve ok sin gastar Twilio. El cliente no se
      // entera de la diferencia — UX idéntica.
      const res = await loginRequest("/api/auth/start-otp", { phone, deliveryChannel, ...(token ? { captchaToken: token } : {}) });
      // El token ya se usó (salga bien o mal): se pide uno nuevo.
      if (token) captcha.current?.reset();
      const json = res.body;
      if (!res.ok) {
        setError(
          json.code === DAILY_SMS_CAP_CODE
            ? channelText("errDailySmsCap", { channel: channelLabel })
            : json.code === CAPTCHA_FAILED_CODE
              ? t("errCaptchaRejected")
              : json.code === COUNTRY_NOT_ALLOWED_CODE
                ? channelText("errCountryNotAllowed", { channel: channelLabel })
                : typeof json.error === "string" ? json.error : t("errSendFailed"),
        );
        return;
      }
      if (json.ok !== true) throw new Error("Invalid login acknowledgement");
      // Arm the cooldown only after a successful send — failures don't
      // result in an SMS, so it would be unfair to lock the user out.
      const until = Date.now() + OTP_COOLDOWN_MS;
      setCooldownUntil(until);
      if (typeof window !== "undefined") {
        writeLoginStorage(OTP_COOLDOWN_KEY, String(until));
      }
      otpPhone.current = phone;
      writeLoginStorage(OTP_PENDING_KEY, JSON.stringify({ phone, sentAt: Date.now() }));
      setStep("otp");
    } catch {
      // A timeout is not proof of non-delivery. Let the person use a code
      // that arrived instead of immediately spending another send.
      const until = Date.now() + OTP_COOLDOWN_MS;
      setCooldownUntil(until);
      writeLoginStorage(OTP_COOLDOWN_KEY, String(until));
      otpPhone.current = phone;
      writeLoginStorage(OTP_PENDING_KEY, JSON.stringify({ phone, sentAt: Date.now() }));
      setStep("otp");
      setError(en ? "We could not confirm delivery. If a code arrives, enter it here. Otherwise, wait a minute and request another." : "No pudimos confirmar el envío. Si te llega un código, escríbelo aquí. Si no llega, espera un minuto y pide otro.");
    } finally {
      if (token) captcha.current?.reset();
      loginBusy.current = false;
      setSending(false);
    }
  }

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (loginBusy.current) return;
    if (!/^\d{6}$/.test(password)) { setError(en ? "Enter your 6-digit password." : "Escribe tu contraseña de 6 dígitos."); return; }
    loginBusy.current = true;
    setSending(true);
    try {
      const response = await loginRequest("/api/auth/login-password", { phone: buildPhone(), password, returnTo: returnTo.current || safeReturnTo(readLoginStorage(RETURN_TO_KEY)) });
      const body = response.body;
      if (!response.ok) { setError(typeof body.error === "string" ? body.error : (en ? "Could not sign in. Try SMS." : "No pudimos iniciar sesión. Puedes entrar por SMS.")); return; }
      if (body.ok !== true) throw new Error("Invalid login acknowledgement");
      setPassword("");
      const destination = safeReturnTo(typeof body.redirectTo === "string" ? body.redirectTo : null) || "/inicio";
      if (!destination.startsWith("/onboarding")) writeLoginStorage(RETURN_TO_KEY, null);
      writeLoginStorage(OTP_PENDING_KEY, null);
      window.location.assign(destination);
    } catch {
      const profile = await loadProfile();
      if (profile.ok && normalizePhone(profile.data.whatsapp_number || "") === normalizePhone(buildPhone())) {
        setPassword("");
        goAfterLogin(needsName(profile.data.display_name) || !profile.data.avatar_url);
      } else setError(en ? "Could not confirm sign-in. You can retry or use SMS." : "No pudimos confirmar el ingreso. Puedes reintentar o entrar por SMS.");
    }
    finally { loginBusy.current = false; setSending(false); }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (loginBusy.current) return;
    setError(null);
    if (otp.length !== 6) {
      setError(t("errOtpLength"));
      return;
    }
    loginBusy.current = true;
    setVerifying(true);
    try {
      const phone = otpPhone.current || buildPhone();
      // Server-side: persiste cookies via Set-Cookie HttpOnly (crítico
      // para iOS Safari, donde verifyOtp en el browser deja la sesión
      // en memory pero pierde cookies y al navegar parece no logueado).
      const res = await loginRequest("/api/auth/verify-otp", { phone, token: otp });
      if (!res.ok) {
        setError(typeof res.body.error === "string" ? res.body.error : t("errOtpInvalid"));
        return;
      }
      const body = res.body;
      if (body.ok !== true || typeof body.newUser !== "boolean") throw new Error("Invalid login acknowledgement");
      goAfterLogin(Boolean(body?.newUser));
    } catch {
      // The session cookie may have arrived before the response body failed.
      // Confirm the actual account before treating a consumed code as a failure.
      const profile = await loadProfile();
      if (profile.ok && normalizePhone(profile.data.whatsapp_number || "") === normalizePhone(otpPhone.current || buildPhone())) {
        goAfterLogin(needsName(profile.data.display_name) || !profile.data.avatar_url);
      } else {
        setError(en ? "We could not confirm sign-in. Your code is kept here; try verifying again when your connection returns." : "No pudimos confirmar el ingreso. Conservamos tu código; vuelve a verificar cuando regrese tu conexión.");
      }
    } finally {
      loginBusy.current = false;
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
    sms_only: channelText("tgSmsOnlyTitle", { channel: channelLabel }),
    rate_limited: t("tgRateLimitedTitle"),
    unavailable: channelText("tgSmsOnlyTitle", { channel: channelLabel }),
    error: t("tgErrorTitle"),
  }[telegram.phase];

  const telegramMessage = {
    opening: null,
    waiting: telegram.popupBlocked ? t("tgPopupBlocked") : null,
    elsewhere: channelText("tgElsewhere", { channel: channelLabel }),
    expired: t("tgExpired"),
    sms_only: channelText("tgErrSmsOnly", { channel: channelLabel }),
    rate_limited: channelText("tgErrRateLimited", { channel: channelLabel }),
    unavailable: channelText("tgErrUnavailable", { channel: channelLabel }),
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
              className="-mx-4 font-display text-5xl leading-tight tracking-wide [overflow-wrap:anywhere]"
              style={{
                color: "var(--gold)",

              }}
            >
              {t("brand")}
            </h1>
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

          {whatsappLoginHref && <div className="space-y-4">
            <WhatsAppLoginButton href={whatsappLoginHref} en={en} />
            <div className="flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-border-subtle" />
              <span className="text-sm text-text-secondary">{en ? "or" : "o"}</span>
              <span className="h-px flex-1 bg-border-subtle" />
            </div>
          </div>}

          <form onSubmit={passwordMode ? handlePasswordLogin : handleSendOtp} className="space-y-4">
            <div>
              <label
                htmlFor="phone"
                className="block text-sm leading-normal font-medium text-text-secondary mb-1.5"
              >
                {t("phoneLabel")}
              </label>
              <PhoneInput inputId="phone" initialValue={phoneE164} onChange={setPhoneE164} countries={PAISES_SMS} />
            </div>

            {passwordMode && <PasswordInput id="login-password" label={en ? "6-digit password" : "Contraseña de 6 dígitos"}
              value={password} onChange={setPassword} autoComplete="current-password" disabled={sending} />}

            {error && (
              <p className="text-red-alert text-sm text-center bg-red-dim rounded-xl p-2.5">
                {error}
                {/* Tope diario de SMS: la salida es soporte (WhatsApp está apagado). */}
                {error === channelText("errDailySmsCap", { channel: channelLabel }) && (
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
              {!passwordMode && turnstileSiteKey && (
                <SmsCaptcha
                  ref={captcha}
                  siteKey={turnstileSiteKey}
                  onToken={onCaptchaToken}
                  onStatus={setCaptchaStatus}
                />
              )}
              <button
                type="submit"
                disabled={sending || (!passwordMode && cooldownRemaining > 0)}
                className={whatsappLoginHref ? `${SECONDARY_BTN} flex-wrap text-base min-h-[48px] disabled:opacity-40 disabled:cursor-not-allowed` : PRIMARY_BTN}
                style={whatsappLoginHref ? undefined : PRIMARY_GLOW}
              >
                {sending ? (
                  <>
                    <Loader2 className="w-5 h-5 shrink-0 animate-spin" />
                    {t("btnSending")}
                  </>
                ) : passwordMode ? (
                  <><KeyRound className="w-5 h-5 shrink-0" aria-hidden="true" /><span className="min-w-0 [overflow-wrap:anywhere]">{en ? "Sign in" : "Entrar"}</span></>
                ) : cooldownRemaining > 0 ? (
                  <>{t("btnWaitSeconds", { seconds: cooldownRemaining })}</>
                ) : (
                  <>
                    <MessageSquare className="w-5 h-5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 [overflow-wrap:anywhere]">{channelText("btnSms", { channel: channelLabel })}</span>
                  </>
                )}
              </button>

            </div>

            {passwordLoginEnabled && <button type="button" className={`${passwordMode ? GHOST_BTN : SECONDARY_BTN} flex-wrap`} disabled={sending} onClick={() => {
              if (passwordMode) {
                setStep("recovery"); setPassword(""); setError(null); return;
              }
              setPasswordMode(true); setPassword(""); setError(null);
            }}>
              <KeyRound className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="min-w-min flex-1">{passwordMode ? (en ? "Forgot your password?" : "¿Olvidaste tu contraseña?") : (en ? "Sign in with password" : "Entrar con contraseña")}</span>
              {!passwordMode && <ArrowRight className="h-5 w-5 shrink-0" aria-hidden="true" />}
            </button>}

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
            {channelText.rich("termsHint", {
              channel: channelLabel,
              link: (chunks) => (
                <a
                  href="/privacy"
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

      {step === "recovery" && (
        <section className={LOGIN_CARD} aria-labelledby="password-recovery-title">
          <KeyRound className="mx-auto h-6 w-6 text-text-secondary" aria-hidden="true" />
          <div className="space-y-2 text-center">
            <h1 ref={recoveryHeading} id="password-recovery-title" tabIndex={-1} className={`${LOGIN_TITLE} -mx-4 leading-tight`}>
              {en ? "RECOVER PASSWORD" : "RECUPERAR CONTRASEÑA"}
            </h1>
            <p className="text-sm leading-relaxed text-text-secondary">{en
              ? "Sign in again with your account's WhatsApp or SMS number. Then you can change your password in Profile."
              : "Vuelve a ingresar con el WhatsApp o el SMS del celular de tu cuenta. Después puedes cambiar tu contraseña en Perfil."}</p>
          </div>
          <div className="space-y-3">
            {whatsappLoginHref && <WhatsAppLoginButton href={whatsappLoginHref} en={en} />}
            <button type="button" className={whatsappLoginHref ? SECONDARY_BTN : PRIMARY_BTN} onClick={() => {
              const destination = returnTo.current || safeReturnTo(readLoginStorage(RETURN_TO_KEY)) || "/perfil";
              if (!destination.startsWith("/set-password")) {
                returnTo.current = `/set-password?returnTo=${encodeURIComponent(destination)}`;
                writeLoginStorage(RETURN_TO_KEY, returnTo.current);
              }
              setPasswordMode(false); setStep("input"); setError(null);
            }}>
              <MessageSquare className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{en ? "Sign in by SMS" : "Entrar por SMS"}</span>
            </button>
          </div>
          <button type="button" className={GHOST_BTN} onClick={() => { setStep("input"); setError(null); }}>
            <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{en ? "Back to sign in" : "Volver al ingreso"}</span>
          </button>
        </section>
      )}

      {step === "otp" && (
        <div className="w-full max-w-md rounded-2xl p-6 space-y-5 bg-bg-card/80 backdrop-blur-sm border border-border-subtle">
          <div className="text-center space-y-2">
            <h2 className="font-display text-2xl leading-tight text-gold tracking-wide">
              {t("otpTitle")}
            </h2>
            <p className="text-text-secondary text-sm leading-normal">
              {channelText("otpSentTo", { channel: channelLabel })}{" "}
              <span className="text-text-primary font-semibold [overflow-wrap:anywhere]">
                {otpPhone.current || buildPhone()}
              </span>
            </p>
            <button
              type="button"
              disabled={verifying}
              onClick={() => {
                writeLoginStorage(OTP_PENDING_KEY, null);
                setStep("input");
                setOtp("");
                setError(null);
              }}
              className="inline-flex min-h-[44px] items-center px-3 text-xs leading-normal text-gold/70 hover:text-gold transition-colors"
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
              className="w-full px-4 py-4 rounded-xl outline-none text-center score-font text-[36px] !tracking-normal [text-indent:0] transition-colors bg-bg-base border border-border-subtle text-text-primary placeholder:text-text-muted focus:border-gold/50"
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
              disabled={verifying}
              onClick={() => {
                writeLoginStorage(OTP_PENDING_KEY, null);
                setStep("input");
                setOtp("");
                setError(null);
              }}
              className="w-full min-h-[44px] text-text-secondary font-medium py-2 hover:text-gold transition-colors flex items-center justify-center gap-1.5 text-sm leading-snug text-center"
            >
              <ArrowLeft className="w-4 h-4 shrink-0" /> {t("otpResend")}
            </button>
          </form>

          {whatsappLoginHref && <WhatsAppLoginButton href={whatsappLoginHref} en={en} />}

          {telegramEnabled && (
            <div className="space-y-3 border-t border-border-subtle pt-4">
              <p className="text-sm text-text-secondary text-center">
                {channelText("tgDidntArrive", { channel: channelLabel })}
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
                  <span>{channelText("tgUseSms", { channel: channelLabel })}</span>
                </button>
              </>
            )}

            {telegramSmsFirst && (
              <button type="button" onClick={backToSms} className={PRIMARY_BTN} style={PRIMARY_GLOW}>
                <MessageSquare className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span>{channelText("tgUseSms", { channel: channelLabel })}</span>
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
  passwordLoginEnabled?: boolean;
  whatsappLoginHref?: string | null;
  /** Usuario del bot de login de Telegram; null si el canal está apagado. */
  telegramBotUsername: string | null;
  /** Public channel label only; credentials never leave the server. */
  deliveryChannel?: "sms" | "whatsapp";
  /** Site key pública de Cloudflare Turnstile; null si la captcha no está configurada. */
  turnstileSiteKey: string | null;
  /** start-otp exige el token (SMS_CAPTCHA_ENFORCED): nunca enviar sin él. */
  smsCaptchaRequired: boolean;
}

export default function LoginClient({ telegramBotUsername, turnstileSiteKey, smsCaptchaRequired, deliveryChannel = "sms", passwordLoginEnabled = false, whatsappLoginHref = null }: LoginClientProps) {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <LoginInner
        passwordLoginEnabled={passwordLoginEnabled}
        whatsappLoginHref={whatsappLoginHref}
        telegramBotUsername={telegramBotUsername}
        turnstileSiteKey={turnstileSiteKey}
        smsCaptchaRequired={smsCaptchaRequired}
        deliveryChannel={deliveryChannel}
      />
    </Suspense>
  );
}
