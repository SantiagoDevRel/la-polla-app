// app/(auth)/login/page.tsx — Login con SMS OTP via Twilio Verify (orquestado
// por Supabase Phone Auth). Mismo patrón que los-del-sur-app:
//   • Send OTP corre client-side (no hay sesión todavía, signInWithOtp directo)
//   • Verify OTP corre server-side (/api/auth/verify-otp) para que las cookies
//     queden persistidas via Set-Cookie HttpOnly — fix del bug iOS Safari.
// 2 pasos (input → otp). Sin contraseña, sin WhatsApp bot.
//
// NOTA Turnstile: el cableado del widget se rolleó back porque
// interaction-only no renderaba en algunos browsers y bloqueaba login.
// El gate anti-Twilio-bill-bombing queda en rate-limit por phone hasta
// que volvamos con un widget visible y testeado.
"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, MessageSquare, Loader2 } from "lucide-react";
import axios from "axios";
import { useTranslations } from "next-intl";
import { safeReturnTo } from "@/lib/auth/safe-return-to";
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

type Step = "input" | "otp";

interface PollaPreview {
  slug: string;
  name: string;
  tournament: string;
  buy_in_amount: number;
  type: string;
  participantCount: number;
}

function LoginInner() {
  const t = useTranslations("Login");
  const searchParams = useSearchParams();

  const [step, setStep] = useState<Step>("input");
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
        setError(json.error || t("errSendFailed"));
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
      // safeReturnTo también acá: el sessionStorage pudo ser escrito por
      // una versión vieja sin sanitizar (o manipulado) — sanitizar en el
      // punto de NAVEGACIÓN es lo que realmente cierra el open redirect.
      const rt =
        typeof window !== "undefined"
          ? safeReturnTo(window.sessionStorage.getItem(RETURN_TO_KEY))
          : null;
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(RETURN_TO_KEY);
      }
      // Hard redirect para asegurar que las cookies se apliquen al
      // siguiente request (router.push a veces las pierde en middleware).
      window.location.href = body?.newUser ? "/onboarding" : rt || "/casa";
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errNetwork"));
    } finally {
      setVerifying(false);
    }
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
              </p>
            )}

            <div className="grid grid-cols-1">
              <button
                type="submit"
                disabled={sending || cooldownRemaining > 0}
                className="bg-gold text-bg-base font-bold py-3.5 px-3 rounded-xl hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-base inline-flex items-center justify-center gap-2"
                style={{ boxShadow: "0 0 20px rgba(255, 215, 0, 0.15)" }}
              >
                {sending ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    {t("btnSending")}
                  </>
                ) : cooldownRemaining > 0 ? (
                  <>{t("btnWaitSeconds", { seconds: cooldownRemaining })}</>
                ) : (
                  <>
                    <MessageSquare className="w-5 h-5" />
                    {t("btnSms")}
                  </>
                )}
              </button>

            </div>
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
              <span className="text-text-primary font-semibold">
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
              className="text-xs text-gold/70 hover:text-gold transition-colors"
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
              className="w-full text-text-secondary font-medium py-2 hover:text-gold transition-colors flex items-center justify-center gap-1.5 text-sm"
            >
              <ArrowLeft className="w-4 h-4" /> {t("otpResend")}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <LoginInner />
    </Suspense>
  );
}
