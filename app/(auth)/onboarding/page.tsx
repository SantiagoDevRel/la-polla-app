// app/(auth)/onboarding/page.tsx — Onboarding: name + pollito selection
// Step 1: "¿Cómo te llamas?" → Step 2: "Elige tu pollito"
"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  POLLITO_TYPES,
  DEFAULT_POLLITO,
  getPollitoBase,
  getPollitoByPosition,
} from "@/lib/pollitos";
import FootballLoader from "@/components/ui/FootballLoader";
import { needsName, isValidDisplayName } from "@/lib/users/needs-name";
import { readLoginStorage, writeLoginStorage } from "@/lib/auth/login-request";
import { safeReturnTo } from "@/lib/auth/safe-return-to";
import { requestJson } from "@/lib/http/json-request";
import { retryProfilePatch, loadProfile, saveProfilePatch, type PendingProfileMutation } from "@/lib/users/profile-client";

function returnDestination() {
  const destination = safeReturnTo(new URLSearchParams(window.location.search).get("returnTo"))
    || safeReturnTo(readLoginStorage("lp_returnTo"));
  writeLoginStorage("lp_returnTo", null);
  return destination || "/inicio";
}

function StepDots({
  total,
  current,
  ariaLabel,
}: {
  total: number;
  current: number;
  ariaLabel: string;
}) {
  return (
    <div className="flex gap-1 mb-3" aria-label={ariaLabel}>
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={
            "flex-1 h-[3px] rounded-full " +
            (i < current ? "bg-gold" : "bg-[rgba(255,255,255,0.08)]")
          }
        />
      ))}
    </div>
  );
}

export default function OnboardingPage() {
  const t = useTranslations("Onboarding");
  const tc = useTranslations("Common");
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [selectedPollito, setSelectedPollito] = useState(DEFAULT_POLLITO);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [checkIssue, setCheckIssue] = useState<{ error: string; kind: string; code?: string } | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [sessionChanged, setSessionChanged] = useState(false);
  const [confirmationPending, setConfirmationPending] = useState(false);
  const [latestSaved, setLatestSaved] = useState<string | null>(null);
  const pendingPatch = useRef<PendingProfileMutation | null>(null);
  const finishLock = useRef(false);
  const ownerId = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    async function checkProfile() {
        setChecking(true);
        setCheckIssue(null);
        const [result, config] = await Promise.all([
          loadProfile(ownerId.current ?? undefined),
          requestJson("/api/auth/password", { method: "GET" },
            (value): value is { enabled: boolean } => !!value && typeof value === "object" && "enabled" in value && typeof value.enabled === "boolean"),
        ]);
        if (!active) return;
        setPasswordEnabled(config.ok && config.data.enabled);
        if (!result.ok) {
          setCheckIssue(result);
          setChecking(false);
          return;
        }
        const profile = result.data;
        ownerId.current ??= profile.id;
        const nameOk = !needsName(profile.display_name);
        const pollitoOk = !!profile.avatar_url;

        if (nameOk && pollitoOk) {
          router.push(returnDestination());
          setChecking(false);
          return;
        }

        // Pre-fill what we already have and jump to the missing step.
        if (nameOk) {
          setName(profile.display_name as string);
          setStep(2);
        }
        if (profile.avatar_url && POLLITO_TYPES.some(pollito => pollito.id === profile.avatar_url)) {
          setSelectedPollito(profile.avatar_url);
        }
        setChecking(false);
    }
    checkProfile();
    return () => { active = false; };
  }, [router, checkAttempt]);

  function handleNameSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError(t("errNameMin"));
      return;
    }
    if (!isValidDisplayName(trimmed)) {
      setError("Escribe tu nombre, no tu número de celular.");
      return;
    }
    setStep(2);
  }

  async function handleFinish() {
    if (finishLock.current) return;
    if (!ownerId.current) return;
    finishLock.current = true;
    setError("");
    setLatestSaved(null);
    setSessionExpired(false);
    setSessionChanged(false);
    setLoading(true);
    try {
      const patch = { display_name: name.trim(), avatar_url: selectedPollito };
      const result = pendingPatch.current ? await retryProfilePatch(pendingPatch.current) : await saveProfilePatch(patch, ownerId.current);
      if (!result.ok) {
        if (result.pending) { pendingPatch.current = result.pending; setConfirmationPending(true); }
        else { pendingPatch.current = null; setConfirmationPending(false); }
        setSessionExpired(result.kind === "auth");
        setSessionChanged(result.code === "SESSION_CHANGED");
        setError(result.error);
        if (result.code === "PROFILE_CHANGED" && result.latestProfile) setLatestSaved(`${result.latestProfile.display_name ?? "Sin nombre"} · ${POLLITO_TYPES.find(pollito => pollito.id === result.latestProfile?.avatar_url)?.label ?? "Sin pollito"}`);
        return;
      }
      pendingPatch.current = null;
      setConfirmationPending(false);
      // safeReturnTo: solo paths internos — cierra open redirect vía
      // sessionStorage envenenado (hallazgo codex 2026-06-11).
      const destination = returnDestination();
      router.push(passwordEnabled ? `/set-password?returnTo=${encodeURIComponent(destination)}` : destination);
    } catch {
      setError("No pudimos continuar. Conservamos tu nombre y tu pollito.");
    } finally {
      setLoading(false);
      finishLock.current = false;
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <FootballLoader />
          <p className="text-text-muted text-sm">{tc("loading")}</p>
        </div>
      </div>
    );
  }
  if (checkIssue) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-sm space-y-4 text-center">
          <p role="alert" className="text-text-secondary">{checkIssue.error}</p>
          <button type="button" onClick={() => setCheckAttempt(value => value + 1)} className="min-h-11 rounded-xl border border-border-subtle px-4 py-2 text-text-primary transition-colors hover:bg-bg-elevated">{tc("retry")}</button>
          {(checkIssue.kind === "auth" || checkIssue.code === "SESSION_CHANGED") && <Link href={checkIssue.code === "SESSION_CHANGED" ? "/perfil" : "/login?returnTo=%2Fonboarding"} target="_blank" rel="noopener noreferrer" className="block min-h-11 rounded-xl border border-border-subtle px-4 py-2 text-text-primary">{tc(checkIssue.code === "SESSION_CHANGED" ? "reviewAccount" : "loginAgain")}</Link>}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      {step === 1 && (
        <div
          className="w-full max-w-md rounded-2xl p-6 space-y-6"
          style={{
            background: "var(--bg-card)",
            border: "1px solid rgba(255,255,255,0.06)",
            boxShadow: "0 0 60px rgba(255, 215, 0, 0.05)",
          }}
        >
          <StepDots total={2} current={1} ariaLabel={t("stepLabel", { current: 1, total: 2 })} />
          <div className="text-center">
            <div className="text-[10px] font-bold tracking-[0.14em] text-text-muted uppercase">
              {t("stepLabel", { current: 1, total: 2 })}
            </div>
            <motion.img
              src={getPollitoBase(DEFAULT_POLLITO)}
              alt=""
              style={{ width: 72, height: 72, objectFit: "contain", margin: "8px auto 8px" }}
              animate={{ y: [0, -3, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            />
            <h1 className="font-display text-gold" style={{ fontSize: 28, letterSpacing: "0.1em" }}>
              {t("step1Title")}
            </h1>
            <p style={{ color: "#F5F7FA", fontSize: 13, marginTop: 4 }}>
              {t("step1Subtitle")}
            </p>
          </div>

          <form onSubmit={handleNameSubmit} className="space-y-4">
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(""); }}
              placeholder={t("namePlaceholder")}
              autoFocus
              maxLength={50}
              style={{
                width: "100%",
                padding: "14px 16px",
                borderRadius: 12,
                outline: "none",
                textAlign: "center",
                fontSize: 16,
                fontWeight: 500,
                fontFamily: "'Outfit', sans-serif",
                background: "#131d2e",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "#f0f4ff",
              }}
            />

            {error && (
              <p style={{ color: "#ff3d57", fontSize: 13, textAlign: "center", background: "rgba(255,61,87,0.1)", borderRadius: 10, padding: 8 }}>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={name.trim().length < 2}
              style={{
                width: "100%",
                background: "var(--gold)",
                color: "var(--bg-base)",
                fontWeight: 700,
                padding: "14px 16px",
                borderRadius: 12,
                border: "none",
                fontSize: 16,
                cursor: "pointer",
                fontFamily: "'Outfit', sans-serif",
                opacity: name.trim().length < 2 ? 0.4 : 1,
                boxShadow: "0 0 20px rgba(255, 215, 0, 0.15)",
              }}
            >
              {tc("continue")}
            </button>
          </form>
        </div>
      )}

      {step === 2 && (
        <div
          className="w-full max-w-md rounded-2xl p-5 space-y-4"
          style={{
            background: "var(--bg-card)",
            border: "1px solid rgba(255,255,255,0.06)",
            boxShadow: "0 0 60px rgba(255, 215, 0, 0.05)",
            maxHeight: "90vh",
            overflowY: "auto",
          }}
        >
          <StepDots total={2} current={2} ariaLabel={t("stepLabel", { current: 2, total: 2 })} />
          <div className="text-center">
            <div className="text-[10px] font-bold tracking-[0.14em] text-text-muted uppercase">
              {t("stepLabel", { current: 2, total: 2 })}
            </div>
            <h1
              className="font-display text-gold mt-1"
              style={{ fontSize: 28, letterSpacing: "0.06em", lineHeight: 1 }}
            >
              {t("step2Title")}
            </h1>
            <p style={{ color: "#F5F7FA", fontSize: 13, marginTop: 4 }}>
              {t("step2Subtitle")}
            </p>
          </div>

          {/* Breathing hero pollito with radial glow — mirrors the design
              spec; always shows the current selection in its lider pose so
              users get instant visual feedback on tap. */}
          <div
            className="mx-auto flex items-center justify-center"
            style={{
              width: 140,
              height: 140,
              position: "relative",
            }}
          >
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: "50%",
                background:
                  "radial-gradient(circle, rgba(255, 215, 0, 0.28) 0%, transparent 70%)",
                filter: "blur(6px)",
              }}
            />
            <motion.img
              key={selectedPollito}
              src={getPollitoByPosition(selectedPollito, 1, 1)}
              alt=""
              style={{
                width: 120,
                height: 120,
                objectFit: "contain",
                position: "relative",
              }}
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
              initial={false}
              onAnimationStart={undefined}
            />
          </div>
          <div className="text-center">
            <div
              className="font-display text-gold"
              style={{ fontSize: 18, letterSpacing: "0.08em" }}
            >
              {(POLLITO_TYPES.find((p) => p.id === selectedPollito)?.label || "").toUpperCase()}
            </div>
          </div>

          {/* Pollito grid */}
          <div className="grid grid-cols-2 gap-2 min-[400px]:grid-cols-4">
            {POLLITO_TYPES.map((p) => {
              const isSelected = selectedPollito === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={loading || confirmationPending}
                  className="min-w-0"
                  onClick={() => setSelectedPollito(p.id)}
                  style={{
                    background: isSelected ? "rgba(255, 215, 0, 0.08)" : "#131d2e",
                    border: isSelected ? "2px solid var(--gold)" : "2px solid rgba(255,255,255,0.06)",
                    borderRadius: 12,
                    padding: "8px 4px 6px",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 4,
                    transition: "border-color 0.15s, background 0.15s",
                  }}
                >
                  <img
                    src={getPollitoBase(p.id)}
                    alt={p.label}
                    style={{ width: 48, height: 48, objectFit: "contain" }}
                  />
                  <span className="w-full [overflow-wrap:anywhere]" style={{
                    fontSize: 9,
                    color: isSelected ? "var(--gold)" : "#F5F7FA",
                    fontWeight: isSelected ? 600 : 400,
                    fontFamily: "'Outfit', sans-serif",
                    textAlign: "center",
                    lineHeight: 1.2,
                  }}>
                    {p.label}
                  </span>
                </button>
              );
            })}
          </div>

          {error && (
            <p role="alert" style={{ color: "#ff3d57", fontSize: 13, textAlign: "center", background: "rgba(255,61,87,0.1)", borderRadius: 10, padding: 8 }}>
              {error}
            </p>
          )}
          {latestSaved && <p className="text-[13px] leading-normal text-text-secondary [overflow-wrap:anywhere]">Datos guardados: {latestSaved}</p>}
          {(sessionExpired || sessionChanged) && <Link href={sessionChanged ? "/perfil" : "/login?returnTo=%2Fonboarding"} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center justify-center rounded-xl border border-border-subtle px-4 py-2 text-text-primary">{tc(sessionChanged ? "reviewAccount" : "loginAgain")}</Link>}

          <div style={{ display: "flex", gap: 8, position: "sticky", bottom: 0, zIndex: 1, background: "var(--bg-card)", paddingTop: 12, paddingBottom: 4, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            <button
              type="button"
              disabled={loading || confirmationPending}
              onClick={() => setStep(1)}
              style={{
                flex: 1,
                background: "#131d2e",
                color: "#F5F7FA",
                fontWeight: 600,
                padding: "12px",
                borderRadius: 11,
                border: "1px solid rgba(255,255,255,0.08)",
                cursor: "pointer",
                fontFamily: "'Outfit', sans-serif",
                fontSize: 14,
              }}
            >
              {tc("back")}
            </button>
            <button
              type="button"
              onClick={handleFinish}
              disabled={loading}
              style={{
                flex: 2,
                background: "var(--gold)",
                color: "var(--bg-base)",
                fontWeight: 700,
                padding: "12px",
                borderRadius: 11,
                border: "none",
                cursor: "pointer",
                fontFamily: "'Outfit', sans-serif",
                fontSize: 14,
                opacity: loading ? 0.4 : 1,
                boxShadow: "0 0 20px rgba(255, 215, 0, 0.15)",
              }}
            >
              {loading ? tc("saving") : confirmationPending ? tc("retry") : t("finish")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
