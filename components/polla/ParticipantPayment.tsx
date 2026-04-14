// components/polla/ParticipantPayment.tsx — Pestaña de Pagos.
// Routing:
//   admin_collects + admin  → AdminPaymentReview (revisión de comprobantes)
//   admin_collects + player + no pagado → PaymentSubmitForm + PaymentsList
//   admin_collects + player + pagado     → PaymentsList
//   digital_pool / pay_winner            → PaymentsList (read-only)
"use client";

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import PaymentSubmitForm from "./PaymentSubmitForm";
import AdminPaymentReview from "./AdminPaymentReview";
import PaymentsList from "./PaymentsList";
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
      <div className="rounded-xl p-4 text-center bg-bg-card border border-border-subtle flex flex-col items-center gap-2">
        <FootballLoader variant="plata" />
        <p className="text-text-muted text-sm">Cargando pagos...</p>
      </div>
    );
  }

  if (error || !pollaPaymentInfo) {
    return (
      <div className="rounded-xl p-4 text-center bg-bg-card border border-border-subtle space-y-2">
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

  // admin_collects + player pendiente → formulario de comprobante + lista
  const myPayment = payments.find((p) => p.user_id === currentUserId);
  const needsSubmit =
    mode === "admin_collects" && !amIAdmin && !myPayment?.paid;

  return (
    <div className="space-y-4">
      {needsSubmit && (
        <PaymentSubmitForm
          pollaSlug={pollaSlug}
          adminPaymentInstructions={pollaPaymentInfo.adminPaymentInstructions ?? ""}
          buyInAmount={pollaPaymentInfo.buyInAmount}
          currency={pollaPaymentInfo.currency}
          currentStatus={myPayment?.status ?? null}
          existingNote={myPayment?.payment_note ?? null}
        />
      )}
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
