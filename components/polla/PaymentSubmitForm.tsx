// components/polla/PaymentSubmitForm.tsx — Formulario para que un participante envíe su comprobante de pago
// Se muestra en pollas con payment_mode === 'admin_collects'
// El participante ve las instrucciones del admin y sube su referencia/comprobante
"use client";

import { useState } from "react";
import axios from "axios";
import { Info } from "lucide-react";

interface PaymentSubmitFormProps {
  pollaSlug: string;
  adminPaymentInstructions: string;
  buyInAmount: number;
  currency: string;
  currentStatus: "pending" | "approved" | "rejected" | null;
  existingNote: string | null;
}

export default function PaymentSubmitForm({
  pollaSlug,
  adminPaymentInstructions,
  buyInAmount,
  currency,
  currentStatus,
  existingNote,
}: PaymentSubmitFormProps) {
  const [paymentNote, setPaymentNote] = useState(existingNote || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const formattedAmount = new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: currency || "COP",
    maximumFractionDigits: 0,
  }).format(buyInAmount);

  // Si ya está aprobado, mostrar confirmación
  if (currentStatus === "approved") {
    return (
      <div className="rounded-xl p-4 bg-green-dim border border-green-live/20">
        <div className="flex items-center gap-2">
          <span className="text-xl">✅</span>
          <div>
            <p className="font-bold text-green-live">Pago aprobado</p>
            <p className="text-sm text-text-secondary">
              Tu pago de {formattedAmount} fue aprobado por el admin.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Si ya envió comprobante y está pendiente
  if (currentStatus === "pending" && existingNote && !success) {
    return (
      <div className="rounded-xl p-4 space-y-3 bg-gold-dim border border-gold/20">
        <div className="flex items-center gap-2">
          <span className="text-xl">⏳</span>
          <div>
            <p className="font-bold text-gold">Comprobante enviado</p>
            <p className="text-sm text-text-secondary">
              Tu comprobante está pendiente de aprobación por el admin.
            </p>
          </div>
        </div>
        <div className="rounded-lg p-3 text-sm bg-bg-elevated border border-border-subtle">
          <p className="font-medium text-text-secondary mb-1">Tu referencia:</p>
          <p className="text-text-primary">{existingNote}</p>
        </div>
      </div>
    );
  }

  // Si fue rechazado, permitir reenvío
  if (currentStatus === "rejected") {
    return (
      <div className="space-y-3">
        <div className="rounded-xl p-4 bg-red-dim border border-red-alert/20">
          <div className="flex items-center gap-2">
            <span className="text-xl">❌</span>
            <div>
              <p className="font-bold text-red-alert">Pago rechazado</p>
              <p className="text-sm text-text-secondary">
                El admin rechazó tu comprobante. Puedes enviar uno nuevo.
              </p>
            </div>
          </div>
        </div>
        {renderForm()}
      </div>
    );
  }

  // Estado inicial o después de éxito
  if (success) {
    return (
      <div className="rounded-xl p-4 bg-green-dim border border-green-live/20">
        <div className="flex items-center gap-2">
          <span className="text-xl">📨</span>
          <p className="font-bold text-green-live">Comprobante enviado exitosamente</p>
        </div>
        <p className="text-sm text-text-secondary mt-1">
          El admin revisará tu pago pronto.
        </p>
      </div>
    );
  }

  return renderForm();

  // Formulario de envío de comprobante de pago
  function renderForm() {
    return (
      <div className="rounded-2xl p-5 space-y-4 bg-bg-card border border-border-subtle">
        <h3 className="font-bold text-text-primary">Enviar comprobante de pago</h3>

        {/* Instrucciones del admin */}
        <div className="rounded-xl p-4 space-y-2 bg-bg-elevated border border-border-subtle">
          <div className="flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-blue-info" />
            <p className="text-sm font-medium text-blue-info">
              Instrucciones del admin:
            </p>
          </div>
          <p className="text-sm text-text-secondary whitespace-pre-wrap">
            {adminPaymentInstructions}
          </p>
          <p className="text-xs text-gold font-medium mt-2">
            Monto a pagar: {formattedAmount}
          </p>
        </div>

        {/* Campo de referencia/nota */}
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1.5">
            Referencia o nota del pago
          </label>
          <textarea
            value={paymentNote}
            onChange={(e) => setPaymentNote(e.target.value)}
            placeholder="Ej: Transferencia Nequi ref #12345 el 10 de junio"
            rows={3}
            className="w-full px-4 py-3 rounded-xl outline-none resize-none transition-colors bg-bg-base border border-border-subtle text-text-primary placeholder:text-text-muted focus:border-gold/50"
            required
          />
        </div>

        {error && (
          <p className="text-red-alert text-sm text-center">{error}</p>
        )}

        <button
          onClick={handleSubmit}
          disabled={loading || paymentNote.trim() === ""}
          className="w-full bg-gold text-bg-base font-bold py-3 rounded-xl hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? "Enviando..." : "Marcar como pagado"}
        </button>
        <p className="text-xs text-text-muted text-center leading-snug">
          El organizador va a confirmar tu pago para activarte en la polla.
        </p>
      </div>
    );
  }

  async function handleSubmit() {
    if (paymentNote.trim() === "") return;

    setLoading(true);
    setError("");

    try {
      await axios.post(`/api/pollas/${pollaSlug}/payments`, {
        paymentNote: paymentNote.trim(),
        paidAmount: buyInAmount,
      });
      setSuccess(true);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || "Error enviando comprobante");
    } finally {
      setLoading(false);
    }
  }
}
