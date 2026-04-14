// components/polla/AdminPaymentReview.tsx — Panel del admin para ver y aprobar/rechazar pagos
// Se muestra cuando el usuario es admin de una polla con payment_mode === 'admin_collects'
// Lista todos los participantes con su estado de pago y permite aprobar o rechazar
"use client";

import { useState } from "react";
import axios from "axios";
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

  const formattedAmount = new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: currency || "COP",
    maximumFractionDigits: 0,
  }).format(buyInAmount);

  // La cola de "pendientes de aprobación" es: comprobante entregado pero
  // admin aún no marcó pagado. Ya no usamos status='pending' (retired en
  // migration 010). "rejected" = baneado de la polla.
  const pendingPayments = payments.filter(
    (p) => p.role !== "admin" && p.payment_note && !p.paid && p.status !== "rejected"
  );
  const approvedPayments = payments.filter(
    (p) => p.role !== "admin" && p.paid
  );
  const waitingPayments = payments.filter(
    (p) => p.role !== "admin" && !p.payment_note && !p.paid && p.status !== "rejected"
  );
  const rejectedPayments = payments.filter(
    (p) => p.role !== "admin" && p.status === "rejected"
  );

  async function handleReview(participantId: string, action: "approve" | "reject") {
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

  // Resumen rápido de estado de pagos
  const totalPlayers = payments.filter((p) => p.role !== "admin").length;
  const totalApproved = approvedPayments.length;
  const totalCollected = totalApproved * buyInAmount;

  return (
    <div className="space-y-4">
      {/* Resumen del pozo */}
      <div className="rounded-2xl p-5 bg-bg-elevated border border-border-subtle">
        <h3 className="font-bold text-text-primary text-lg mb-3">Estado de pagos</h3>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl p-2.5 bg-bg-card">
            <p className="score-font text-[28px] text-green-live">{totalApproved}</p>
            <p className="text-[10px] text-text-muted">Aprobados</p>
          </div>
          <div className="rounded-xl p-2.5 bg-bg-card">
            <p className="score-font text-[28px] text-gold">{pendingPayments.length}</p>
            <p className="text-[10px] text-text-muted">Pendientes</p>
          </div>
          <div className="rounded-xl p-2.5 bg-bg-card">
            <p className="score-font text-[28px] text-text-primary">{totalPlayers}</p>
            <p className="text-[10px] text-text-muted">Total</p>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-border-subtle text-center">
          <p className="text-xs text-text-muted">Recaudado:</p>
          <p className="score-font text-[24px] text-gold">
            {new Intl.NumberFormat("es-CO", {
              style: "currency",
              currency: currency || "COP",
              maximumFractionDigits: 0,
            }).format(totalCollected)}
          </p>
          <p className="text-xs text-text-muted">
            de{" "}
            {new Intl.NumberFormat("es-CO", {
              style: "currency",
              currency: currency || "COP",
              maximumFractionDigits: 0,
            }).format(totalPlayers * buyInAmount)}{" "}
            esperados
          </p>
        </div>
      </div>

      {/* Pagos pendientes de revisión */}
      {pendingPayments.length > 0 && (
        <div>
          <h4 className="font-bold text-text-primary mb-2 flex items-center gap-2">
            <span className="text-gold">⏳</span>
            Pendientes de aprobación ({pendingPayments.length})
          </h4>
          <div className="space-y-2">
            {pendingPayments.map((p) => (
              <PaymentCard
                key={p.id}
                participant={p}
                formattedAmount={formattedAmount}
                processingId={processingId}
                onApprove={() => handleReview(p.id, "approve")}
                onReject={() => handleReview(p.id, "reject")}
              />
            ))}
          </div>
        </div>
      )}

      {/* Sin comprobante aún */}
      {waitingPayments.length > 0 && (
        <div>
          <h4 className="font-bold text-text-primary mb-2 flex items-center gap-2">
            <span className="text-text-muted">🕐</span>
            Sin comprobante ({waitingPayments.length})
          </h4>
          <div className="space-y-2">
            {waitingPayments.map((p) => (
              <div
                key={p.id}
                className="rounded-xl p-3 flex items-center justify-between bg-bg-card border border-border-subtle"
              >
                <div>
                  <p className="font-medium text-sm text-text-primary">
                    {p.users?.display_name || "Usuario"}
                  </p>
                  <p className="text-xs text-text-muted">Aún no ha enviado comprobante</p>
                </div>
                <span className="text-[10px] bg-bg-elevated text-text-muted px-2 py-1 rounded-full">
                  Esperando
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pagos aprobados */}
      {approvedPayments.length > 0 && (
        <div>
          <h4 className="font-bold text-text-primary mb-2 flex items-center gap-2">
            <span className="text-green-live">✅</span>
            Aprobados ({approvedPayments.length})
          </h4>
          <div className="space-y-2">
            {approvedPayments.map((p) => (
              <div
                key={p.id}
                className="rounded-xl p-3 flex items-center justify-between bg-green-dim border border-green-live/20"
              >
                <div>
                  <p className="font-medium text-sm text-green-live">
                    {p.users?.display_name || "Usuario"}
                  </p>
                  <p className="text-xs text-text-secondary">{formattedAmount}</p>
                </div>
                <span className="text-[10px] bg-green-dim text-green-live px-2 py-1 rounded-full font-medium border border-green-live/20">
                  Aprobado
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pagos rechazados */}
      {rejectedPayments.length > 0 && (
        <div>
          <h4 className="font-bold text-text-primary mb-2 flex items-center gap-2">
            <span className="text-red-alert">❌</span>
            Rechazados ({rejectedPayments.length})
          </h4>
          <div className="space-y-2">
            {rejectedPayments.map((p) => (
              <div
                key={p.id}
                className="rounded-xl p-3 flex items-center justify-between bg-red-dim border border-red-alert/20"
              >
                <div>
                  <p className="font-medium text-sm text-red-alert">
                    {p.users?.display_name || "Usuario"}
                  </p>
                  <p className="text-xs text-text-secondary">Comprobante rechazado</p>
                </div>
                <span className="text-[10px] bg-red-dim text-red-alert px-2 py-1 rounded-full font-medium border border-red-alert/20">
                  Rechazado
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Tarjeta individual de pago pendiente con botones de aprobación
function PaymentCard({
  participant,
  formattedAmount,
  processingId,
  onApprove,
  onReject,
}: {
  participant: PaymentParticipant;
  formattedAmount: string;
  processingId: string | null;
  onApprove: () => void;
  onReject: () => void;
}) {
  const isProcessing = processingId === participant.id;

  return (
    <div className="rounded-xl overflow-hidden bg-bg-card border border-gold/20">
      <div className="p-4 space-y-3">
        {/* Header del participante */}
        <div className="flex items-center justify-between">
          <div>
            <p className="font-bold text-sm text-text-primary">
              {participant.users?.display_name || "Usuario"}
            </p>
            <p className="text-xs text-text-muted">
              {participant.users?.whatsapp_number}
            </p>
          </div>
          <p className="font-bold text-sm text-gold">{formattedAmount}</p>
        </div>

        {/* Nota/referencia del pago */}
        {participant.payment_note && (
          <div className="rounded-lg p-3 bg-bg-elevated border border-border-subtle">
            <p className="text-xs text-text-muted font-medium mb-1">Referencia:</p>
            <p className="text-sm text-text-primary">{participant.payment_note}</p>
          </div>
        )}

        {/* Placeholder para imagen del comprobante */}
        {participant.payment_proof_url && (
          <div className="rounded-lg p-3 text-center bg-bg-elevated border border-border-subtle">
            <p className="text-xs text-text-muted">
              📷 Comprobante adjunto — coming soon (viewer)
            </p>
          </div>
        )}

        {/* Botones de acción */}
        <div className="flex gap-2">
          <button
            onClick={onApprove}
            disabled={isProcessing}
            className="flex-1 bg-green-live text-bg-base font-bold py-2.5 rounded-lg hover:brightness-110 transition-all disabled:opacity-40 text-sm"
          >
            {isProcessing ? "..." : "Aprobar"}
          </button>
          <button
            onClick={onReject}
            disabled={isProcessing}
            className="flex-1 bg-red-alert text-bg-base font-bold py-2.5 rounded-lg hover:brightness-110 transition-all disabled:opacity-40 text-sm"
          >
            {isProcessing ? "..." : "Rechazar"}
          </button>
        </div>
      </div>
    </div>
  );
}
