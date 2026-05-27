// components/polla/OrganizerPanel.tsx — Tab "Organizar" (solo admin de la polla).
// Sección A.1: link de invitación abierta (token reusable, copiar/renovar).
// Sección A.2: código de invitación de 6 chars (copiar/rotar, mirror del link).
// Sección B: lista de participantes (toggle pago + expulsar).
// Sección C: estado de la polla (status, pozo total, completitud de pronósticos).
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { Copy, RefreshCw, Trash2, UserMinus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useToast } from "@/components/ui/Toast";
import FootballLoader from "@/components/ui/FootballLoader";
import EmptyState from "@/components/ui/EmptyState";
import { useIsIOSApp } from "@/components/platform/PlatformProvider";

interface Participant {
  id: string;
  user_id: string;
  role: string;
  status: string;
  paid: boolean;
  paid_at: string | null;
  payment_status: string;
  joined_at?: string;
  users: {
    id: string;
    display_name: string | null;
    whatsapp_number: string | null;
  } | null;
}

interface OrganizerPanelProps {
  pollaSlug: string;
  pollaName: string;
  pollaStatus: string;
  paymentMode: string;
  buyInAmount: number;
  matchIds: string[];
  joinCode: string | null;
}

const APP_URL =
  typeof window !== "undefined" ? window.location.origin : "https://lapollacolombiana.com";

export default function OrganizerPanel({
  pollaSlug,
  pollaName,
  pollaStatus,
  paymentMode,
  buyInAmount,
  matchIds,
  joinCode,
}: OrganizerPanelProps) {
  const t = useTranslations("Organizer");
  const locale = useLocale();
  const intlTag = locale === "en" ? "en-US" : "es-CO";
  const fmtCOP = (n: number): string => `$${n.toLocaleString(intlTag)}`;
  const { showToast } = useToast();
  const router = useRouter();
  const isIOSApp = useIsIOSApp();
  const [token, setToken] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(joinCode);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [predictionsCount, setPredictionsCount] = useState(0); // unique users with at least one prediction
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tk, payments] = await Promise.all([
        axios.get<{ token: string }>(`/api/pollas/${pollaSlug}/invite-token`),
        axios.get<{ payments: Participant[]; predictionsByUser?: Record<string, number> }>(
          `/api/pollas/${pollaSlug}/payments`
        ),
      ]);
      setToken(tk.data.token);
      const parts = payments.data.payments || [];
      setParticipants(parts);
      const predMap = payments.data.predictionsByUser ?? {};
      setPredictionsCount(Object.keys(predMap).filter((k) => (predMap[k] ?? 0) > 0).length);
    } catch (err) {
      console.error("[OrganizerPanel] load failed:", err);
      showToast(t("errLoad"), "error");
    } finally {
      setLoading(false);
    }
  }, [pollaSlug, showToast, t]);

  useEffect(() => { load(); }, [load]);

  async function copyLink() {
    if (!token) return;
    const url = `${APP_URL}/invites/polla/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast(t("linkCopied"), "success");
    } catch {
      showToast(t("linkCopyFail"), "error");
    }
  }

  async function rotateLink() {
    setBusy("rotate");
    try {
      const { data } = await axios.delete<{ token: string }>(
        `/api/pollas/${pollaSlug}/invite-token`
      );
      setToken(data.token);
      showToast(t("linkRenewed"), "success");
    } catch {
      showToast(t("linkRenewFail"), "error");
    } finally {
      setBusy(null);
    }
  }

  async function copyCode() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      showToast(t("codeCopied"), "success");
    } catch {
      showToast(t("linkCopyFail"), "error");
    }
  }

  async function rotateCode() {
    setBusy("rotate-code");
    try {
      const { data } = await axios.post<{ code: string }>(
        `/api/pollas/${pollaSlug}/rotate-code`
      );
      setCode(data.code);
      showToast(t("codeRenewed"), "success");
    } catch {
      showToast(t("codeRenewFail"), "error");
    } finally {
      setBusy(null);
    }
  }

  async function togglePaid(p: Participant) {
    if (paymentMode !== "admin_collects" || p.role === "admin") return;
    setBusy(`pay:${p.id}`);
    try {
      await axios.patch(`/api/pollas/${pollaSlug}/payments`, {
        participantId: p.id,
        action: p.paid ? "reject" : "approve",
      });
      await load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      showToast(e.response?.data?.error || t("errPaymentUpdate"), "error");
    } finally {
      setBusy(null);
    }
  }

  async function deletePolla() {
    // Two-line confirm so the consequence is unambiguous before the
    // user clicks OK. Matches the existing expel() pattern (browser
    // confirm) — the codebase blocks alert() but confirm() is OK.
    const ok = window.confirm(t("confirmDelete", { name: pollaName }));
    if (!ok) return;
    setBusy("delete");
    try {
      await axios.delete(`/api/pollas/${pollaSlug}`);
      showToast(t("deletedToast"), "success");
      // Send the user out before the now-empty page re-fetches and
      // 404s on its own. router.replace so the back button doesn't
      // bring them to a dead URL.
      router.replace("/inicio");
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      showToast(
        e.response?.data?.error || t("errDelete"),
        "error",
      );
      setBusy(null);
    }
  }

  async function expel(p: Participant) {
    if (p.role === "admin") return;
    const targetName = p.users?.display_name || p.users?.whatsapp_number || t("thisParticipant");
    if (!confirm(t("confirmExpel", { name: targetName }))) return;
    setBusy(`expel:${p.id}`);
    try {
      await axios.patch(`/api/pollas/${pollaSlug}/participants/${p.id}`, {
        status: "rejected",
      });
      await load();
      showToast(t("expelledToast"), "success");
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      showToast(e.response?.data?.error || t("errExpel"), "error");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl p-6 text-center lp-card flex flex-col items-center gap-2">
        <FootballLoader />
        <p className="text-text-muted text-sm">{t("loadingPanel")}</p>
      </div>
    );
  }

  const inviteUrl = token ? `${APP_URL}/invites/polla/${token}` : "";
  const approved = participants.filter((p) => p.status === "approved");
  // En 'admin_collects' (pago de entrada) el pozo solo refleja la plata
  // ya recaudada — solo cuentan los participantes marcados como pagados.
  // En 'pay_winner' no hay flujo de pagos intermedio, así que se cuentan
  // todos los aprobados.
  const counted =
    paymentMode === "admin_collects" ? approved.filter((p) => p.paid) : approved;
  const total = buyInAmount * counted.length;

  return (
    <div className="space-y-4">
      {/* Section A.1 — Invite link */}
      <section className="rounded-2xl p-5 lp-card space-y-3">
        <h3 className="text-sm font-bold text-text-primary">{t("linkSection")}</h3>
        <p className="text-xs text-text-muted">
          {t("linkHelp")}
        </p>
        <div className="rounded-xl p-3 bg-bg-elevated border border-border-subtle text-xs break-all text-text-secondary">
          {inviteUrl}
        </div>
        <div className="flex gap-2">
          <button
            onClick={copyLink}
            className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-gold text-bg-base font-semibold text-sm hover:brightness-110 transition-all"
          >
            <Copy className="w-4 h-4" /> {t("copyLink")}
          </button>
          <button
            onClick={rotateLink}
            disabled={busy === "rotate"}
            className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-border-subtle text-text-secondary text-sm hover:border-gold/40 hover:text-gold transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${busy === "rotate" ? "animate-spin" : ""}`} /> {t("renewLink")}
          </button>
        </div>
      </section>

      {/* Section A.2 — Invite code (mirror of A.1 for the 6-char join code) */}
      <section className="rounded-2xl p-5 lp-card space-y-3">
        <h3 className="text-sm font-bold text-text-primary">{t("codeSection")}</h3>
        <p className="text-xs text-text-muted">
          {t("codeHelp")}
        </p>
        <div className="rounded-xl p-4 bg-bg-elevated border border-border-subtle text-center">
          <p
            className="font-mono text-[32px] tracking-[0.32em] text-gold select-all"
            style={{ fontFeatureSettings: '"tnum"' }}
          >
            {code ?? "—"}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={copyCode}
            disabled={!code}
            className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-gold text-bg-base font-semibold text-sm hover:brightness-110 transition-all disabled:opacity-50"
          >
            <Copy className="w-4 h-4" /> {t("copyCode")}
          </button>
          <button
            onClick={rotateCode}
            disabled={busy === "rotate-code"}
            className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-border-subtle text-text-secondary text-sm hover:border-gold/40 hover:text-gold transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${busy === "rotate-code" ? "animate-spin" : ""}`} /> {t("renewCode")}
          </button>
        </div>
      </section>

      {/* Section B — Participants */}
      <section className="rounded-2xl p-5 lp-card space-y-3">
        <h3 className="text-sm font-bold text-text-primary">
          {t("participantsSection")} <span className="text-text-muted font-normal">· {participants.length}</span>
        </h3>
        {participants.length === 0 ? (
          <EmptyState
            title={t("noParticipantsTitle")}
            subtitle={t("noParticipantsBody")}
            size={80}
          />
        ) : (
          <ul className="space-y-2">
            {[...participants]
              .sort((a, b) => (a.status === b.status ? 0 : a.status === "approved" ? -1 : 1))
              .map((p) => {
                const name = p.users?.display_name?.trim() || p.users?.whatsapp_number || t("participantFallback");
                const sub = p.users?.display_name ? p.users?.whatsapp_number : null;
                const joined = p.joined_at ? new Date(p.joined_at).toLocaleDateString(intlTag) : null;
                const isExpelled = p.status === "rejected";
                return (
                  <li
                    key={p.id}
                    className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 bg-bg-elevated border border-border-subtle ${isExpelled ? "opacity-60" : ""}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text-primary truncate">
                        {name}
                        {p.role === "admin" && <span className="text-[10px] text-gold ml-1">{t("tagAdmin")}</span>}
                        {isExpelled && <span className="text-[10px] text-red-alert ml-1">{t("tagExpelled")}</span>}
                      </p>
                      <p className="text-[11px] text-text-muted truncate">
                        {sub ? `${sub} · ` : ""}{joined ? t("joinedAt", { date: joined }) : ""}
                      </p>
                    </div>
                    <div className="flex-shrink-0 flex items-center gap-2">
                      {/* En 'pay_winner' nadie está "pagado" hasta que la
                          polla termine y el ganador cobre — el indicador
                          solo agrega ruido. Solo se muestra el dot+label
                          cuando admin_collects. En iOS Capacitor wrapper se
                          oculta TODO el indicador de pago (App Store 5.3.4
                          + 5.1.1(ix)). */}
                      {!isIOSApp && paymentMode === "admin_collects" && (
                        <>
                          <span
                            className={`inline-block w-2 h-2 rounded-full ${p.paid ? "bg-green-live" : "bg-text-muted/50"}`}
                            style={p.paid ? { boxShadow: "0 0 5px rgba(0,230,118,0.6)" } : undefined}
                          />
                          <span className={`text-[11px] font-medium ${p.paid ? "text-green-live" : "text-text-muted"}`}>
                            {p.paid ? t("paid") : t("pending")}
                          </span>
                        </>
                      )}
                      {!isIOSApp && paymentMode === "admin_collects" && p.role !== "admin" && !isExpelled && (
                        <button
                          onClick={() => togglePaid(p)}
                          disabled={busy === `pay:${p.id}`}
                          className="text-[11px] px-2 py-1 rounded-lg border border-border-subtle hover:border-gold/40 text-text-secondary hover:text-gold disabled:opacity-50"
                        >
                          {busy === `pay:${p.id}` ? "…" : p.paid ? t("unmark") : t("mark")}
                        </button>
                      )}
                      {p.role !== "admin" && !isExpelled && (
                        <button
                          onClick={() => expel(p)}
                          disabled={busy === `expel:${p.id}`}
                          title={t("expelTitle")}
                          className="text-[11px] px-2 py-1 rounded-lg border border-border-subtle hover:border-red-alert/40 text-text-muted hover:text-red-alert disabled:opacity-50"
                        >
                          <UserMinus className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
          </ul>
        )}
      </section>

      {/* Section C — Polla status */}
      <section className="rounded-2xl p-5 lp-card space-y-3">
        <h3 className="text-sm font-bold text-text-primary">{t("statusSection")}</h3>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl p-3 bg-bg-elevated">
            <p className="text-[10px] text-text-muted uppercase">{t("statusLabel")}</p>
            <p className="font-medium text-text-primary">
              {pollaStatus === "ended" ? t("statusEnded") : pollaName ? t("statusActive") : pollaStatus}
            </p>
          </div>
          <div className="rounded-xl p-3 bg-bg-elevated">
            <p className="text-[10px] text-text-muted uppercase">{t("predictionsLabel")}</p>
            <p className="font-medium text-text-primary">
              {t("predictionsValue", { count: predictionsCount, total: approved.length })} {matchIds.length ? t("haveParticipated") : ""}
            </p>
          </div>
          {/* POZO row — oculta en iOS Capacitor wrapper (App Store 5.3.4
              + 5.1.1(ix)). El admin puede ver la totalidad de la sección
              en web y Android; en iOS la app se presenta como pronósticos
              + tabla sin manejo de dinero. */}
          {!isIOSApp && (
            <div className="rounded-xl p-3 bg-bg-elevated col-span-2">
              <p className="text-[10px] text-text-muted uppercase">{t("potLabel")}</p>
              <p className="font-medium text-text-primary">
                <span className="text-gold font-semibold">{t("potTotal", { amount: fmtCOP(total) })}</span>{" "}
                <span className="text-text-muted">{t("potPerPerson", { amount: fmtCOP(buyInAmount) })}</span>
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Section D — Danger zone. Hard-deletes the polla via DELETE
          /api/pollas/[slug]; cascade wipes participantes, pronósticos,
          notifications e invites. */}
      <section className="rounded-2xl p-5 border border-red-alert/30 bg-red-alert/5 space-y-3">
        <h3 className="text-sm font-bold text-red-alert flex items-center gap-2">
          <Trash2 className="w-4 h-4" /> {t("dangerZone")}
        </h3>
        <p className="text-xs text-text-muted">
          {t("deleteWarning")}
        </p>
        <button
          onClick={deletePolla}
          disabled={busy === "delete"}
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-3 rounded-xl bg-red-alert text-white font-semibold text-sm hover:brightness-110 transition-all disabled:opacity-50 cursor-pointer"
        >
          <Trash2 className={`w-4 h-4 ${busy === "delete" ? "animate-pulse" : ""}`} />
          {busy === "delete" ? t("deleting") : t("deletePolla")}
        </button>
      </section>
    </div>
  );
}
