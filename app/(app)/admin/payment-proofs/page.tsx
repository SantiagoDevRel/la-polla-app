// app/(app)/admin/payment-proofs/page.tsx
// Cola de revisión de comprobantes para el admin. Muestra cada
// payment_proof con la imagen, el veredicto AI, y botones para
// aprobar / rechazar. Aplica a admins de pollas + global admins.
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import Image from "next/image";
import { ArrowLeft, Check, X as XIcon, AlertTriangle, Clock } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import FootballLoader from "@/components/ui/FootballLoader";

interface Proof {
  id: string;
  polla_id: string;
  user_id: string;
  storage_path: string;
  signed_url: string | null;
  ai_source_type: string | null;
  ai_valid: boolean | null;
  ai_confidence: string | null;
  ai_detected_amount: number | null;
  ai_detected_account: string | null;
  ai_detected_recipient_name: string | null;
  ai_detected_date: string | null;
  ai_rejection_reason: string | null;
  ai_evidence: string | null;
  ai_cost_usd: number | string;
  admin_decision: boolean | null;
  admin_reviewed_at: string | null;
  admin_notes: string | null;
  created_at: string;
  expires_at: string;
  pollas: {
    slug: string;
    name: string;
    buy_in_amount: number;
    admin_payout_method: string | null;
    admin_payout_account: string | null;
    admin_payout_account_name: string | null;
  } | null | Array<{
    slug: string;
    name: string;
    buy_in_amount: number;
    admin_payout_method: string | null;
    admin_payout_account: string | null;
    admin_payout_account_name: string | null;
  }>;
  users: {
    display_name: string | null;
    whatsapp_number: string | null;
  } | null | Array<{
    display_name: string | null;
    whatsapp_number: string | null;
  }>;
}

function fmtCOP(n: number | null): string {
  if (n === null) return "—";
  return `$${Math.round(n).toLocaleString("es-CO")}`;
}

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function relTime(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  const days = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  if (days <= 0) return "expirado";
  if (days === 1) return "1 día";
  return `${days} días`;
}

function unwrap<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

export default function PaymentProofsAdminPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [proofs, setProofs] = useState<Proof[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "pending">("pending");

  const load = useCallback(async () => {
    try {
      const res = await axios.get<{ proofs: Proof[] }>("/api/admin/payment-proofs");
      setProofs(res.data.proofs);
    } catch {
      showToast("No se pudieron cargar los comprobantes", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(p: Proof, decision: "approve" | "reject") {
    setActingId(p.id);
    try {
      await axios.patch(`/api/admin/payment-proofs/${p.id}`, { decision });
      showToast(decision === "approve" ? "Aprobado" : "Rechazado", "success");
      await load();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? "Error guardando";
      showToast(msg, "error");
    } finally {
      setActingId(null);
    }
  }

  const visible = filter === "pending"
    ? proofs.filter((p) => p.admin_decision === null)
    : proofs;
  const pendingCount = proofs.filter((p) => p.admin_decision === null).length;

  return (
    <div className="min-h-screen" style={{ background: "#080c10" }}>
      <header className="px-4 pt-4 pb-3">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button
            onClick={() => router.push("/admin")}
            className="text-text-secondary hover:text-gold transition-colors"
            aria-label="Volver"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-bold text-text-primary">Revisar comprobantes</h1>
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-3">
        <div className="flex gap-1.5">
          {(["pending", "all"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                filter === f
                  ? "bg-gold text-bg-base border-gold"
                  : "bg-bg-elevated text-text-secondary border-border-subtle"
              }`}
            >
              {f === "pending" ? `Pendientes (${pendingCount})` : "Todos"}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex flex-col items-center gap-2 py-8">
            <FootballLoader />
            <p className="text-text-muted text-sm">Cargando…</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-2xl p-6 lp-card text-center space-y-2">
            <Check className="w-8 h-8 text-turf mx-auto" />
            <p className="text-sm text-text-primary font-semibold">
              {filter === "pending" ? "Sin comprobantes pendientes" : "Sin comprobantes"}
            </p>
            <p className="text-[12px] text-text-muted">
              {filter === "pending"
                ? "Cuando alguien suba un comprobante a una polla tuya, aparece acá."
                : "No hay comprobantes en los últimos 7 días."}
            </p>
          </div>
        ) : (
          visible.map((p) => {
            const polla = unwrap(p.pollas);
            const userInfo = unwrap(p.users);
            const aiOk = p.ai_valid === true;
            const aiBad = p.ai_valid === false;
            return (
              <article key={p.id} className="lp-card p-4 space-y-3 border border-border-subtle">
                <header className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-[0.1em] text-text-muted truncate">
                      {polla?.name ?? "Polla"}
                    </p>
                    <p className="text-sm font-semibold text-text-primary truncate">
                      {userInfo?.display_name ?? "Usuario"}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[11px] text-text-muted">{fmtDate(p.created_at)}</p>
                    <p className="text-[10px] text-text-muted flex items-center justify-end gap-0.5">
                      <Clock className="w-3 h-3" /> expira en {relTime(p.expires_at)}
                    </p>
                  </div>
                </header>

                {/* AI verdict */}
                <div
                  className={`rounded-lg px-3 py-2 border text-[12px] ${
                    p.admin_decision === true
                      ? "bg-turf/10 border-turf/30"
                      : p.admin_decision === false
                      ? "bg-red-alert/10 border-red-alert/30"
                      : aiOk
                      ? "bg-turf/5 border-turf/20"
                      : aiBad
                      ? "bg-amber/10 border-amber/30"
                      : "bg-bg-elevated border-border-subtle"
                  }`}
                >
                  <p className="font-semibold text-text-primary text-[12px]">
                    {p.admin_decision === true
                      ? "✓ Aprobado por admin"
                      : p.admin_decision === false
                      ? "✗ Rechazado por admin"
                      : aiOk
                      ? "AI: VÁLIDO (auto-aprobado)"
                      : aiBad
                      ? "AI: INVÁLIDO"
                      : "AI: sin veredicto"}
                  </p>
                  {p.ai_rejection_reason ? (
                    <p className="text-[11px] text-text-secondary mt-0.5">
                      {p.ai_rejection_reason}
                    </p>
                  ) : null}
                  {p.ai_evidence ? (
                    <p className="text-[10px] text-text-muted mt-1 italic">
                      &ldquo;{p.ai_evidence}&rdquo;
                    </p>
                  ) : null}
                </div>

                {/* Side-by-side: expected vs detected */}
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-lg p-2 bg-bg-elevated border border-border-subtle">
                    <p className="text-[9px] uppercase text-text-muted mb-0.5">Esperado</p>
                    <p className="text-text-primary tabular-nums" style={{ fontFeatureSettings: '"tnum"' }}>
                      {fmtCOP(polla?.buy_in_amount ?? null)}
                    </p>
                    <p className="text-text-secondary truncate">
                      {polla?.admin_payout_method} · {polla?.admin_payout_account}
                    </p>
                    {polla?.admin_payout_account_name ? (
                      <p className="text-text-muted truncate text-[10px]">
                        {polla.admin_payout_account_name}
                      </p>
                    ) : null}
                  </div>
                  <div className="rounded-lg p-2 bg-bg-elevated border border-border-subtle">
                    <p className="text-[9px] uppercase text-text-muted mb-0.5">Detectado</p>
                    <p className="text-text-primary tabular-nums" style={{ fontFeatureSettings: '"tnum"' }}>
                      {fmtCOP(p.ai_detected_amount)}
                    </p>
                    <p className="text-text-secondary truncate">
                      {p.ai_source_type ?? "—"} · {p.ai_detected_account ?? "—"}
                    </p>
                    {p.ai_detected_recipient_name ? (
                      <p className="text-text-muted truncate text-[10px]">
                        {p.ai_detected_recipient_name}
                      </p>
                    ) : null}
                  </div>
                </div>

                {/* Image */}
                {p.signed_url ? (
                  <a
                    href={p.signed_url}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-xl overflow-hidden border border-border-subtle relative"
                    style={{ height: 280 }}
                  >
                    <Image
                      src={p.signed_url}
                      alt="comprobante"
                      fill
                      style={{ objectFit: "contain" }}
                      unoptimized
                    />
                  </a>
                ) : (
                  <p className="text-[11px] text-text-muted">Imagen no disponible.</p>
                )}

                {/* Actions */}
                {p.admin_decision === null ? (
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => decide(p, "reject")}
                      disabled={actingId === p.id}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-red-alert/10 border border-red-alert/30 text-red-alert font-semibold text-sm hover:bg-red-alert/20 transition-colors disabled:opacity-50"
                    >
                      <XIcon className="w-4 h-4" /> Rechazar
                    </button>
                    <button
                      type="button"
                      onClick={() => decide(p, "approve")}
                      disabled={actingId === p.id}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-turf/15 border border-turf/30 text-turf font-semibold text-sm hover:bg-turf/20 transition-colors disabled:opacity-50"
                    >
                      <Check className="w-4 h-4" /> Aprobar
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between text-[11px] text-text-muted">
                    <span>Revisado {p.admin_reviewed_at ? fmtDate(p.admin_reviewed_at) : ""}</span>
                    <button
                      type="button"
                      onClick={() => decide(p, p.admin_decision ? "reject" : "approve")}
                      disabled={actingId === p.id}
                      className="text-[11px] underline hover:text-text-primary"
                    >
                      Cambiar a {p.admin_decision ? "rechazado" : "aprobado"}
                    </button>
                  </div>
                )}

                {p.admin_notes ? (
                  <p className="text-[11px] text-text-secondary italic">{p.admin_notes}</p>
                ) : null}

                <p className="text-[10px] text-text-muted text-right tabular-nums" style={{ fontFeatureSettings: '"tnum"' }}>
                  Costo AI: ${Number(p.ai_cost_usd).toFixed(4)}
                </p>
              </article>
            );
          })
        )}

        <p className="text-[10px] text-text-muted text-center pt-2">
          <AlertTriangle className="w-3 h-3 inline" /> Los screenshots se borran solos a los 7 días.
        </p>
      </main>
    </div>
  );
}
