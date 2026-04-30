// components/polla/PollaProofsReview.tsx
//
// Embebido en /pollas/[slug] tab Pagos cuando el viewer es admin de
// esa polla específica. Muestra los comprobantes subidos por
// participantes + permite aprobar/rechazar. Re-usa la misma API que
// /admin/payment-proofs pero scoped a una polla. Cada organizador
// solo ve los comprobantes de sus propias pollas — no el global.
"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import Image from "next/image";
import { Check, X as XIcon, ChevronDown, Clock, AlertTriangle } from "lucide-react";

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
  created_at: string;
  expires_at: string;
  users: { display_name: string | null } | null | Array<{ display_name: string | null }>;
}

interface Props {
  pollaSlug: string;
  buyInAmount: number;
  expectedMethod: string | null;
  expectedAccount: string | null;
  expectedAccountName: string | null;
  /** Callback que el padre usa para refrescar la lista de pagos
   *  después de aprobar/rechazar (pue cambia paid). */
  onChanged?: () => void;
}

function fmtCOP(n: number | null): string {
  if (n === null) return "—";
  return `$${Math.round(n).toLocaleString("es-CO")}`;
}
function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}
function relTime(iso: string): string {
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "expirado";
  return `${days}d`;
}
function unwrap<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

export default function PollaProofsReview({
  pollaSlug,
  buyInAmount,
  expectedMethod,
  expectedAccount,
  expectedAccountName,
  onChanged,
}: Props) {
  const [proofs, setProofs] = useState<Proof[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await axios.get<{ proofs: Proof[] }>(
        `/api/pollas/${pollaSlug}/payment-proofs`,
      );
      setProofs(res.data.proofs);
    } catch {
      setProofs([]);
    } finally {
      setLoading(false);
    }
  }, [pollaSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(p: Proof, decision: "approve" | "reject") {
    setActingId(p.id);
    try {
      await axios.patch(`/api/admin/payment-proofs/${p.id}`, { decision });
      await load();
      onChanged?.();
    } catch {
      /* ignore — toast podría sumarse */
    } finally {
      setActingId(null);
    }
  }

  if (loading) return null;
  if (proofs.length === 0) return null;

  const pending = proofs.filter((p) => p.admin_decision === null);
  const reviewed = proofs.filter((p) => p.admin_decision !== null);

  return (
    <section className="rounded-2xl lp-card border border-border-subtle">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 p-4"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="font-bold text-text-primary text-sm">Comprobantes subidos</h3>
          {pending.length > 0 ? (
            <span className="text-[10px] uppercase px-2 py-0.5 rounded-full bg-amber/15 text-amber border border-amber/30 whitespace-nowrap">
              {pending.length} pendiente{pending.length !== 1 ? "s" : ""}
            </span>
          ) : (
            <span className="text-[10px] uppercase px-2 py-0.5 rounded-full bg-turf/10 text-turf border border-turf/30">
              al día
            </span>
          )}
        </div>
        <ChevronDown
          className={`w-4 h-4 text-text-muted transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div className="px-4 pb-4 space-y-3">
          {pending.length === 0 && reviewed.length === 0 ? null : (
            <>
              {pending.map((p) => (
                <ProofItem
                  key={p.id}
                  proof={p}
                  buyInAmount={buyInAmount}
                  expectedMethod={expectedMethod}
                  expectedAccount={expectedAccount}
                  expectedAccountName={expectedAccountName}
                  acting={actingId === p.id}
                  onDecide={(d) => decide(p, d)}
                />
              ))}
              {reviewed.length > 0 ? (
                <details className="rounded-lg border border-border-subtle">
                  <summary className="cursor-pointer px-3 py-2 text-[12px] text-text-secondary hover:text-text-primary">
                    Ya revisados ({reviewed.length})
                  </summary>
                  <div className="space-y-2 p-2">
                    {reviewed.map((p) => (
                      <ProofItem
                        key={p.id}
                        proof={p}
                        buyInAmount={buyInAmount}
                        expectedMethod={expectedMethod}
                        expectedAccount={expectedAccount}
                        expectedAccountName={expectedAccountName}
                        acting={actingId === p.id}
                        onDecide={(d) => decide(p, d)}
                      />
                    ))}
                  </div>
                </details>
              ) : null}
            </>
          )}
          <p className="text-[10px] text-text-muted text-center">
            <AlertTriangle className="w-3 h-3 inline" /> AI puede equivocarse — confirmá si es necesario. Las imágenes se borran a los 7 días.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function ProofItem({
  proof: p,
  buyInAmount,
  expectedMethod,
  expectedAccount,
  expectedAccountName,
  acting,
  onDecide,
}: {
  proof: Proof;
  buyInAmount: number;
  expectedMethod: string | null;
  expectedAccount: string | null;
  expectedAccountName: string | null;
  acting: boolean;
  onDecide: (d: "approve" | "reject") => void;
}) {
  const userInfo = unwrap(p.users);
  const aiOk = p.ai_valid === true;
  const aiBad = p.ai_valid === false;
  return (
    <article className="rounded-xl p-3 bg-bg-elevated border border-border-subtle space-y-2">
      <header className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-semibold text-text-primary truncate">
          {userInfo?.display_name ?? "Usuario"}
        </p>
        <p className="text-[10px] text-text-muted flex items-center gap-0.5">
          <Clock className="w-3 h-3" /> {fmtDate(p.created_at)} · {relTime(p.expires_at)}
        </p>
      </header>

      <div
        className={`rounded-md px-2 py-1.5 text-[11px] border ${
          p.admin_decision === true
            ? "bg-turf/10 border-turf/30 text-turf"
            : p.admin_decision === false
              ? "bg-red-alert/10 border-red-alert/30 text-red-alert"
              : aiOk
                ? "bg-turf/5 border-turf/20 text-turf"
                : aiBad
                  ? "bg-amber/10 border-amber/30 text-amber"
                  : "bg-bg-base border-border-subtle text-text-secondary"
        }`}
      >
        <p className="font-semibold">
          {p.admin_decision === true
            ? "✓ Aprobado por vos"
            : p.admin_decision === false
              ? "✗ Rechazado por vos"
              : aiOk
                ? "AI: válido (auto-aprobado)"
                : aiBad
                  ? "AI: inválido — pendiente de revisión"
                  : "AI: pendiente"}
        </p>
        {p.ai_rejection_reason ? (
          <p className="text-[10px] mt-0.5 opacity-80">{p.ai_rejection_reason}</p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-1.5 text-[10px]">
        <div className="rounded p-1.5 bg-bg-base border border-border-subtle">
          <p className="text-text-muted uppercase">Esperado</p>
          <p className="text-text-primary tabular-nums" style={{ fontFeatureSettings: '"tnum"' }}>
            {fmtCOP(buyInAmount)}
          </p>
          <p className="text-text-secondary truncate">
            {expectedMethod} · {expectedAccount}
          </p>
          {expectedAccountName ? (
            <p className="text-text-muted truncate">{expectedAccountName}</p>
          ) : null}
        </div>
        <div className="rounded p-1.5 bg-bg-base border border-border-subtle">
          <p className="text-text-muted uppercase">Detectado</p>
          <p className="text-text-primary tabular-nums" style={{ fontFeatureSettings: '"tnum"' }}>
            {fmtCOP(p.ai_detected_amount)}
          </p>
          <p className="text-text-secondary truncate">
            {p.ai_source_type ?? "—"} · {p.ai_detected_account ?? "—"}
          </p>
          {p.ai_detected_recipient_name ? (
            <p className="text-text-muted truncate">{p.ai_detected_recipient_name}</p>
          ) : null}
        </div>
      </div>

      {p.signed_url ? (
        <a
          href={p.signed_url}
          target="_blank"
          rel="noreferrer"
          className="block rounded-lg overflow-hidden border border-border-subtle relative"
          style={{ height: 200 }}
        >
          <Image
            src={p.signed_url}
            alt="comprobante"
            fill
            style={{ objectFit: "contain" }}
            unoptimized
          />
        </a>
      ) : null}

      {p.admin_decision === null ? (
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => onDecide("reject")}
            disabled={acting}
            className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-red-alert/10 border border-red-alert/30 text-red-alert font-semibold text-[12px] hover:bg-red-alert/20 transition-colors disabled:opacity-50"
          >
            <XIcon className="w-3.5 h-3.5" /> Rechazar
          </button>
          <button
            type="button"
            onClick={() => onDecide("approve")}
            disabled={acting}
            className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-turf/15 border border-turf/30 text-turf font-semibold text-[12px] hover:bg-turf/20 transition-colors disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" /> Aprobar
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onDecide(p.admin_decision ? "reject" : "approve")}
          disabled={acting}
          className="w-full text-[11px] underline text-text-muted hover:text-text-primary"
        >
          Cambiar a {p.admin_decision ? "rechazado" : "aprobado"}
        </button>
      )}
    </article>
  );
}
