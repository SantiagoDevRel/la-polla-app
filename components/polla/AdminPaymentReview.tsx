// components/polla/AdminPaymentReview.tsx — Panel del organizador para
// marcar pagos en pollas con payment_mode === 'admin_collects'.
// Dos buckets nada más: "No ha pagado" (con botón Marcar) y "Pagado"
// (con indicador verde + botón Desmarcar para deshacer errores).
"use client";

import { useState } from "react";
import axios from "axios";
import { Check } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

interface PaymentParticipant {
  id: string;
  user_id: string;
  role: string;
  status: "approved" | "rejected";
  paid: boolean;
  paid_at: string | null;
  paid_amount: number | null;
  payment_note: string | null;
  payment_proof_url: string | null;
  users: {
    id: string;
    display_name: string;
    whatsapp_number: string;
  };
}

interface AdminPaymentReviewProps {
  pollaSlug: string;
  payments: PaymentParticipant[];
  buyInAmount: number;
  currency: string;
  onPaymentUpdated: () => void;
}

export default function AdminPaymentReview({
  pollaSlug,
  payments,
  buyInAmount,
  currency,
  onPaymentUpdated,
}: AdminPaymentReviewProps) {
  const [processingId, setProcessingId] = useState<string | null>(null);
  const { showToast } = useToast();

  // Dos buckets: no pagado vs pagado. El admin siempre entra paid=true por
  // construcción; aparece en "Pagado" para que el conteo y pozo cuadren.
  const unpaid = payments.filter(
    (p) => p.role !== "admin" && !p.paid && p.status !== "rejected"
  );
  const paid = payments.filter((p) => p.paid);

  async function handleAction(
    participantId: string,
    action: "approve" | "reject"
  ) {
    setProcessingId(participantId);
    try {
      await axios.patch(`/api/pollas/${pollaSlug}/payments`, {
        participantId,
        action,
      });
      onPaymentUpdated();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      showToast(e.response?.data?.error || "Error procesando pago", "error");
    } finally {
      setProcessingId(null);
    }
  }

  const totalPlayers = payments.length;
  const totalPaid = paid.length;
  const totalCollected = totalPaid * buyInAmount;
  const fmt = new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: currency || "COP",
    maximumFractionDigits: 0,
  });

  return (
    <div className="space-y-4">
      {/* Resumen del pozo */}
      <div className="rounded-2xl p-5 bg-bg-elevated border border-border-subtle">
        <h3 className="font-bold text-text-primary text-lg mb-3">Estado de pagos</h3>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl p-2.5 bg-bg-card">
            <p className="score-font text-[28px] text-green-live">{totalPaid}</p>
            <p className="text-[10px] text-text-muted">Pagados</p>
          </div>
          <div className="rounded-xl p-2.5 bg-bg-card">
            <p className="score-font text-[28px] text-gold">{unpaid.length}</p>
            <p className="text-[10px] text-text-muted">No pagados</p>
          </div>
          <div className="rounded-xl p-2.5 bg-bg-card">
            <p className="score-font text-[28px] text-text-primary">{totalPlayers}</p>
            <p className="text-[10px] text-text-muted">Total</p>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-border-subtle text-center">
          <p className="text-xs text-text-muted">Recaudado:</p>
          <p className="score-font text-[24px] text-gold">
            {fmt.format(totalCollected)}
          </p>
          <p className="text-xs text-text-muted">
            de {fmt.format(totalPlayers * buyInAmount)} esperados
          </p>
        </div>
      </div>

      {/* No ha pagado */}
      {unpaid.length > 0 ? (
        <div>
          <h4 className="font-bold text-text-primary mb-2">
            No ha pagado ({unpaid.length})
          </h4>
          <div className="space-y-2">
            {unpaid.map((p) => (
              <div
                key={p.id}
                className="rounded-xl p-3 flex items-center justify-between bg-bg-card border border-border-subtle gap-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm text-text-primary truncate">
                    {p.users?.display_name || "Usuario"}
                  </p>
                  <p className="text-xs text-text-muted truncate">
                    {p.users?.whatsapp_number}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleAction(p.id, "approve")}
                  disabled={processingId === p.id}
                  className="bg-gold text-bg-base font-semibold px-3 py-1.5 rounded-lg text-xs hover:brightness-110 transition-all disabled:opacity-40 shrink-0"
                >
                  {processingId === p.id ? "..." : "Marcar como pagado"}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Pagado */}
      {paid.length > 0 ? (
        <div>
          <h4 className="font-bold text-text-primary mb-2">
            Pagado ({paid.length})
          </h4>
          <div className="space-y-2">
            {paid.map((p) => {
              const isAdminRow = p.role === "admin";
              return (
                <div
                  key={p.id}
                  className="rounded-xl p-3 flex items-center justify-between bg-green-dim border border-green-live/20 gap-3"
                >
                  <div className="min-w-0 flex-1 flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-live shrink-0" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="font-medium text-sm text-green-live truncate">
                        {p.users?.display_name || "Usuario"}
                        {isAdminRow ? (
                          <span className="text-[10px] text-gold ml-1">· organizador</span>
                        ) : null}
                      </p>
                      <p className="text-xs text-text-secondary truncate">
                        {p.users?.whatsapp_number}
                      </p>
                    </div>
                  </div>
                  {!isAdminRow ? (
                    <button
                      type="button"
                      onClick={() => handleAction(p.id, "reject")}
                      disabled={processingId === p.id}
                      className="bg-bg-card border border-border-medium text-text-secondary font-semibold px-3 py-1.5 rounded-lg text-xs hover:text-red-alert hover:border-red-alert/40 transition-all disabled:opacity-40 shrink-0"
                    >
                      {processingId === p.id ? "..." : "Desmarcar"}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {unpaid.length === 0 && paid.length === 0 ? (
        <p className="text-text-muted text-sm text-center py-6">
          Todavía no hay participantes en esta polla.
        </p>
      ) : null}
    </div>
  );
}
