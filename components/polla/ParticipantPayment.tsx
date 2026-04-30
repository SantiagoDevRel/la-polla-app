// components/polla/ParticipantPayment.tsx — Pestaña de Pagos.
// Routing:
//   admin_collects + admin              → AdminPaymentReview (marcar pagos)
//   admin_collects + player + no pagado → tarjeta "Esperando aprobación"
//                                         + (opcional) instrucciones + PaymentsList
//   admin_collects + player + pagado    → PaymentsList
//   pay_winner                          → PaymentsList (read-only)
"use client";

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { Banknote, CreditCard } from "lucide-react";
import AdminPaymentReview from "./AdminPaymentReview";
import PaymentsList from "./PaymentsList";
import PaymentProofUpload from "./PaymentProofUpload";
import FootballLoader from "@/components/ui/FootballLoader";

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
    display_name: string | null;
    whatsapp_number: string | null;
  } | null;
}

interface PollaPaymentInfo {
  adminPaymentInstructions: string | null;
  adminPayoutMethod: "nequi" | "bancolombia" | "otro" | null;
  adminPayoutAccount: string | null;
  adminPayoutAccountName: string | null;
  buyInAmount: number;
  currency: string;
  paymentMode: string;
}

interface ParticipantPaymentProps {
  pollaSlug: string;
  currentUserId: string;
  currentUserRole: string;
}

export default function ParticipantPayment({
  pollaSlug,
  currentUserId,
  currentUserRole,
}: ParticipantPaymentProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payments, setPayments] = useState<PaymentParticipant[]>([]);
  const [pollaPaymentInfo, setPollaPaymentInfo] = useState<PollaPaymentInfo | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const loadPayments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const { data } = await axios.get(`/api/pollas/${pollaSlug}/payments`);
      setPayments(data.payments);
      setPollaPaymentInfo(data.pollaPaymentInfo);
      setIsAdmin(data.isAdmin);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || "No pudimos cargar los pagos.");
    } finally {
      setLoading(false);
    }
  }, [pollaSlug]);

  useEffect(() => {
    loadPayments();
  }, [loadPayments]);

  if (loading) {
    return (
      <div className="rounded-xl p-4 text-center lp-card flex flex-col items-center gap-2">
        <FootballLoader variant="plata" />
        <p className="text-text-muted text-sm">Cargando pagos...</p>
      </div>
    );
  }

  if (error || !pollaPaymentInfo) {
    return (
      <div className="rounded-xl p-4 text-center lp-card space-y-2">
        <p className="text-sm font-medium text-text-primary">No pudimos cargar los pagos</p>
        <p className="text-xs text-text-muted">{error || "Intentá de nuevo."}</p>
        <button
          type="button"
          onClick={loadPayments}
          className="text-xs px-3 py-1.5 rounded-lg border border-border-subtle hover:border-gold/40 text-text-secondary hover:text-gold transition-colors"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const mode = pollaPaymentInfo.paymentMode;
  const amIAdmin = isAdmin || currentUserRole === "admin";

  // admin_collects + admin → review panel clásico
  if (mode === "admin_collects" && amIAdmin) {
    return (
      <AdminPaymentReview
        pollaSlug={pollaSlug}
        payments={payments.map((p) => ({
          ...p,
          users: p.users
            ? {
                id: p.users.id,
                display_name: p.users.display_name ?? "",
                whatsapp_number: p.users.whatsapp_number ?? "",
              }
            : { id: "", display_name: "", whatsapp_number: "" },
        }))}
        buyInAmount={pollaPaymentInfo.buyInAmount}
        currency={pollaPaymentInfo.currency}
        onPaymentUpdated={loadPayments}
      />
    );
  }

  // admin_collects + player + paid=false → tarjeta informativa read-only.
  // El pago es offline: el participante le paga al organizador por fuera
  // de la app (Nequi, efectivo, transferencia) y el organizador marca la
  // fila como pagada desde su panel. No hay formulario, nota, ni upload.
  const myPayment = payments.find((p) => p.user_id === currentUserId);
  const awaitingApproval =
    mode === "admin_collects" && !amIAdmin && !myPayment?.paid;
  const instructions = pollaPaymentInfo.adminPaymentInstructions?.trim() ?? "";

  return (
    <div className="space-y-4">
      {awaitingApproval ? (
        <>
          {/* Upload con AI-assist — solo cuando el admin configuró
              cuenta estructurada. Si no, fallback al banner clásico. */}
          {pollaPaymentInfo.adminPayoutMethod && pollaPaymentInfo.adminPayoutAccount ? (
            <PaymentProofUpload
              pollaSlug={pollaSlug}
              buyInAmount={pollaPaymentInfo.buyInAmount}
              payoutMethod={pollaPaymentInfo.adminPayoutMethod}
              payoutAccount={pollaPaymentInfo.adminPayoutAccount}
              payoutAccountName={pollaPaymentInfo.adminPayoutAccountName}
              extraInstructions={instructions || null}
              onApproved={() => {
                void loadPayments();
              }}
              onPendingReview={() => {
                void loadPayments();
              }}
            />
          ) : (
            <>
              <div className="rounded-2xl p-5 space-y-2 lp-card">
                <div className="flex items-center gap-2">
                  <Banknote className="w-5 h-5 text-gold" aria-hidden="true" />
                  <h3 className="font-bold text-text-primary">Esperando aprobación del organizador</h3>
                </div>
                <p className="text-sm text-text-secondary leading-snug">
                  Pagale al organizador por fuera de la app. Una vez que él te marque como pagado, vas a poder pronosticar.
                </p>
              </div>
              {instructions ? (
                <div className="rounded-xl p-4 space-y-2 bg-bg-elevated border border-border-subtle">
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-gold" aria-hidden="true" />
                    <p className="text-sm font-semibold text-text-primary">Cómo pagar</p>
                  </div>
                  <p className="text-sm text-text-secondary whitespace-pre-wrap leading-snug">
                    {instructions}
                  </p>
                </div>
              ) : null}
            </>
          )}
        </>
      ) : null}
      <PaymentsList
        pollaSlug={pollaSlug}
        payments={payments}
        paymentMode={mode}
        isAdmin={amIAdmin}
        currentUserId={currentUserId}
        onChanged={loadPayments}
      />
    </div>
  );
}
