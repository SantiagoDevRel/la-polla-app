// components/polla/ParticipantPayment.tsx — Componente wrapper de pagos para pollas admin_collects
// Muestra la vista correcta según el rol del usuario:
// - Participante: formulario para enviar comprobante (PaymentSubmitForm)
// - Admin: panel de revisión de pagos (AdminPaymentReview)
// Se integra en la página de detalle de la polla (/pollas/[slug])
"use client";

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import PaymentSubmitForm from "./PaymentSubmitForm";
import AdminPaymentReview from "./AdminPaymentReview";
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
    display_name: string;
    whatsapp_number: string;
  };
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
  const [payments, setPayments] = useState<PaymentParticipant[]>([]);
  const [pollaPaymentInfo, setPollaPaymentInfo] = useState<{
    adminPaymentInstructions: string;
    buyInAmount: number;
    currency: string;
  } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const loadPayments = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await axios.get(`/api/pollas/${pollaSlug}/payments`);
      setPayments(data.payments);
      setPollaPaymentInfo(data.pollaPaymentInfo);
      setIsAdmin(data.isAdmin);
    } catch {
      // Si falla, no mostramos nada — el componente es opcional
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

  if (!pollaPaymentInfo) return null;

  // Vista de admin: panel de revisión de todos los pagos
  if (isAdmin || currentUserRole === "admin") {
    return (
      <AdminPaymentReview
        pollaSlug={pollaSlug}
        payments={payments}
        buyInAmount={pollaPaymentInfo.buyInAmount}
        currency={pollaPaymentInfo.currency}
        onPaymentUpdated={loadPayments}
      />
    );
  }

  // Vista de participante: formulario para enviar comprobante
  const myPayment = payments.find((p) => p.user_id === currentUserId);

  return (
    <PaymentSubmitForm
      pollaSlug={pollaSlug}
      adminPaymentInstructions={pollaPaymentInfo.adminPaymentInstructions}
      buyInAmount={pollaPaymentInfo.buyInAmount}
      currency={pollaPaymentInfo.currency}
      currentStatus={myPayment?.status ?? null}
      existingNote={myPayment?.payment_note ?? null}
    />
  );
}
