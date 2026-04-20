// components/polla/OrganizerPanel.tsx — Tab "Organizar" (solo admin de la polla).
// Sección A.1: link de invitación abierta (token reusable, copiar/renovar).
// Sección A.2: código de invitación de 6 chars (copiar/rotar, mirror del link).
// Sección B: lista de participantes (toggle pago + expulsar).
// Sección C: estado de la polla (status, pozo total, completitud de pronósticos).
"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Copy, RefreshCw, UserMinus } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import FootballLoader from "@/components/ui/FootballLoader";
import EmptyState from "@/components/ui/EmptyState";

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
  typeof window !== "undefined" ? window.location.origin : "https://la-polla.vercel.app";

function fmtCOP(n: number): string {
  return `$${n.toLocaleString("es-CO")}`;
}

export default function OrganizerPanel({
  pollaSlug,
  pollaName,
  pollaStatus,
  paymentMode,
  buyInAmount,
  matchIds,
  joinCode,
}: OrganizerPanelProps) {
  const { showToast } = useToast();
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
      showToast("No pudimos cargar el panel del organizador", "error");
    } finally {
      setLoading(false);
    }
  }, [pollaSlug, showToast]);

  useEffect(() => { load(); }, [load]);

  async function copyLink() {
    if (!token) return;
    const url = `${APP_URL}/invites/polla/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link copiado", "success");
    } catch {
      showToast("No pudimos copiar — copialo a mano", "error");
    }
  }

  async function rotateLink() {
    setBusy("rotate");
    try {
      const { data } = await axios.delete<{ token: string }>(
        `/api/pollas/${pollaSlug}/invite-token`
      );
      setToken(data.token);
      showToast("Link renovado — el anterior ya no funciona", "success");
    } catch {
      showToast("No pudimos renovar el link", "error");
    } finally {
      setBusy(null);
    }
  }

  async function copyCode() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      showToast("Código copiado", "success");
    } catch {
      showToast("No pudimos copiar — copialo a mano", "error");
    }
  }

  async function rotateCode() {
    setBusy("rotate-code");
    try {
      const { data } = await axios.post<{ code: string }>(
        `/api/pollas/${pollaSlug}/rotate-code`
      );
      setCode(data.code);
      showToast("Código renovado", "success");
    } catch {
      showToast("No se pudo renovar el código", "error");
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
      showToast(e.response?.data?.error || "Error actualizando pago", "error");
    } finally {
      setBusy(null);
    }
  }

  async function expel(p: Participant) {
    if (p.role === "admin") return;
    if (!confirm(`¿Expulsar a ${p.users?.display_name || p.users?.whatsapp_number || "este participante"}?`)) return;
    setBusy(`expel:${p.id}`);
    try {
      await axios.patch(`/api/pollas/${pollaSlug}/participants/${p.id}`, {
        status: "rejected",
      });
      await load();
      showToast("Participante expulsado", "success");
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      showToast(e.response?.data?.error || "Error expulsando", "error");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl p-6 text-center bg-bg-card border border-border-subtle flex flex-col items-center gap-2">
        <FootballLoader />
        <p className="text-text-muted text-sm">Cargando panel del organizador…</p>
      </div>
    );
  }

  const inviteUrl = token ? `${APP_URL}/invites/polla/${token}` : "";
  const approved = participants.filter((p) => p.status === "approved");
  const total = buyInAmount * approved.length;

  return (
    <div className="space-y-4">
      {/* Section A.1 — Invite link */}
      <section className="rounded-2xl p-5 bg-bg-card border border-border-subtle space-y-3">
        <h3 className="text-sm font-bold text-text-primary">Link de invitación</h3>
        <p className="text-xs text-text-muted">
          Cualquier persona con este link puede unirse a tu polla.
        </p>
        <div className="rounded-xl p-3 bg-bg-elevated border border-border-subtle text-xs break-all text-text-secondary">
          {inviteUrl}
        </div>
        <div className="flex gap-2">
          <button
            onClick={copyLink}
            className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-gold text-bg-base font-semibold text-sm hover:brightness-110 transition-all"
          >
            <Copy className="w-4 h-4" /> Copiar link
          </button>
          <button
            onClick={rotateLink}
            disabled={busy === "rotate"}
            className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-border-subtle text-text-secondary text-sm hover:border-gold/40 hover:text-gold transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${busy === "rotate" ? "animate-spin" : ""}`} /> Renovar link
          </button>
        </div>
      </section>

      {/* Section A.2 — Invite code (mirror of A.1 for the 6-char join code) */}
      <section className="rounded-2xl p-5 bg-bg-card border border-border-subtle space-y-3">
        <h3 className="text-sm font-bold text-text-primary">Código de invitación</h3>
        <p className="text-xs text-text-muted">
          Compártelo con tus amigos para que se unan rápido.
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
            <Copy className="w-4 h-4" /> Copiar código
          </button>
          <button
            onClick={rotateCode}
            disabled={busy === "rotate-code"}
            className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-border-subtle text-text-secondary text-sm hover:border-gold/40 hover:text-gold transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${busy === "rotate-code" ? "animate-spin" : ""}`} /> Rotar código
          </button>
        </div>
      </section>

      {/* Section B — Participants */}
      <section className="rounded-2xl p-5 bg-bg-card border border-border-subtle space-y-3">
        <h3 className="text-sm font-bold text-text-primary">
          Participantes <span className="text-text-muted font-normal">· {participants.length}</span>
        </h3>
        {participants.length === 0 ? (
          <EmptyState
            title="Aún no hay participantes"
            subtitle="Compartí tu link de invitación arriba para que se unan."
            size={80}
          />
        ) : (
          <ul className="space-y-2">
            {[...participants]
              .sort((a, b) => (a.status === b.status ? 0 : a.status === "approved" ? -1 : 1))
              .map((p) => {
                const name = p.users?.display_name?.trim() || p.users?.whatsapp_number || "Participante";
                const sub = p.users?.display_name ? p.users?.whatsapp_number : null;
                const joined = p.joined_at ? new Date(p.joined_at).toLocaleDateString("es-CO") : null;
                const isExpelled = p.status === "rejected";
                return (
                  <li
                    key={p.id}
                    className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 bg-bg-elevated border border-border-subtle ${isExpelled ? "opacity-60" : ""}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text-primary truncate">
                        {name}
                        {p.role === "admin" && <span className="text-[10px] text-gold ml-1">· admin</span>}
                        {isExpelled && <span className="text-[10px] text-red-alert ml-1">· expulsado</span>}
                      </p>
                      <p className="text-[11px] text-text-muted truncate">
                        {sub ? `${sub} · ` : ""}{joined ? `desde ${joined}` : ""}
                      </p>
                    </div>
                    <div className="flex-shrink-0 flex items-center gap-2">
                      <span
                        className={`inline-block w-2 h-2 rounded-full ${p.paid ? "bg-green-live" : "bg-text-muted/50"}`}
                        style={p.paid ? { boxShadow: "0 0 5px rgba(0,230,118,0.6)" } : undefined}
                      />
                      <span className={`text-[11px] font-medium ${p.paid ? "text-green-live" : "text-text-muted"}`}>
                        {p.paid ? "Pagado" : "Pendiente"}
                      </span>
                      {paymentMode === "admin_collects" && p.role !== "admin" && !isExpelled && (
                        <button
                          onClick={() => togglePaid(p)}
                          disabled={busy === `pay:${p.id}`}
                          className="text-[11px] px-2 py-1 rounded-lg border border-border-subtle hover:border-gold/40 text-text-secondary hover:text-gold disabled:opacity-50"
                        >
                          {busy === `pay:${p.id}` ? "…" : p.paid ? "Desmarcar" : "Marcar"}
                        </button>
                      )}
                      {p.role !== "admin" && !isExpelled && (
                        <button
                          onClick={() => expel(p)}
                          disabled={busy === `expel:${p.id}`}
                          title="Expulsar"
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
      <section className="rounded-2xl p-5 bg-bg-card border border-border-subtle space-y-3">
        <h3 className="text-sm font-bold text-text-primary">Estado de la polla</h3>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl p-3 bg-bg-elevated">
            <p className="text-[10px] text-text-muted uppercase">Estado</p>
            <p className="font-medium text-text-primary">
              {pollaStatus === "ended" ? "Finalizada" : pollaName ? "Activa" : pollaStatus}
            </p>
          </div>
          <div className="rounded-xl p-3 bg-bg-elevated">
            <p className="text-[10px] text-text-muted uppercase">Pronósticos</p>
            <p className="font-medium text-text-primary">
              {predictionsCount} de {approved.length} {matchIds.length ? "han participado" : ""}
            </p>
          </div>
          <div className="rounded-xl p-3 bg-bg-elevated col-span-2">
            <p className="text-[10px] text-text-muted uppercase">Pozo</p>
            <p className="font-medium text-text-primary">
              {fmtCOP(buyInAmount)} por persona{" "}
              <span className="text-gold font-semibold">· {fmtCOP(total)} total</span>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
