// components/polla/PaymentsList.tsx — Lista unificada de pagos.
// - digital_pool / pay_winner: read-only, muestra estado de cada participante.
// - admin_collects + isAdmin: toggle para marcar/desmarcar pagado manualmente.
"use client";

import { useState } from "react";
import axios from "axios";
import { useToast } from "@/components/ui/Toast";
import EmptyState from "@/components/ui/EmptyState";

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

interface PaymentsListProps {
  pollaSlug: string;
  payments: PaymentParticipant[];
  paymentMode: string;
  isAdmin: boolean;
  currentUserId: string;
  onChanged: () => void;
}

function displayLabel(p: PaymentParticipant): string {
  const name = p.users?.display_name?.trim();
  if (name) return name;
  const phone = p.users?.whatsapp_number;
  return phone ? phone : "Participante";
}

function phoneLabel(p: PaymentParticipant): string | null {
  const name = p.users?.display_name?.trim();
  if (!name) return null;
  return p.users?.whatsapp_number ?? null;
}

export default function PaymentsList({
  pollaSlug,
  payments,
  paymentMode,
  isAdmin,
  currentUserId,
  onChanged,
}: PaymentsListProps) {
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const { showToast } = useToast();

  const canToggle = isAdmin && paymentMode === "admin_collects";

  const rows = [...payments].sort((a, b) => {
    if (a.paid !== b.paid) return a.paid ? -1 : 1;
    return displayLabel(a).localeCompare(displayLabel(b));
  });

  async function togglePaid(p: PaymentParticipant) {
    if (!canToggle || togglingId) return;
    setTogglingId(p.id);
    try {
      await axios.patch(`/api/pollas/${pollaSlug}/payments`, {
        participantId: p.id,
        action: p.paid ? "reject" : "approve",
      });
      onChanged();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      showToast(e.response?.data?.error || "Error actualizando pago", "error");
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="rounded-2xl p-4 bg-bg-card border border-border-subtle space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-text-primary">Pagos</h3>
        <span className="text-[11px] text-text-muted">
          {paymentMode === "digital_pool"
            ? "Pago digital · automático"
            : paymentMode === "admin_collects"
              ? "Admin recoge el pago"
              : "Pago al ganador"}
        </span>
      </div>

      {paymentMode === "pay_winner" && rows.length > 0 && (
        <div className="rounded-xl px-3 py-2 bg-bg-elevated border border-border-subtle text-xs text-text-secondary text-center">
          Pendiente hasta que haya ganador — al final, todos le pagan directamente.
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title="Aún no hay participantes"
          subtitle="Cuando alguien se una, vas a verlo acá."
          size={80}
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((p) => {
            const isMe = p.user_id === currentUserId;
            const sub = phoneLabel(p);
            const busy = togglingId === p.id;
            return (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 bg-bg-elevated border border-border-subtle"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text-primary truncate">
                    {displayLabel(p)}
                    {isMe && <span className="text-[10px] text-text-muted ml-1">(tú)</span>}
                    {p.role === "admin" && (
                      <span className="text-[10px] text-gold ml-1">· admin</span>
                    )}
                  </p>
                  {sub && <p className="text-[11px] text-text-muted truncate">{sub}</p>}
                </div>

                <div className="flex-shrink-0 flex items-center gap-2">
                  <span
                    className={`inline-block w-2.5 h-2.5 rounded-full ${
                      p.paid ? "bg-green-live" : "bg-text-muted/50"
                    }`}
                    style={p.paid ? { boxShadow: "0 0 5px rgba(0,230,118,0.6)" } : undefined}
                  />
                  <span
                    className={`text-xs font-medium ${
                      p.paid ? "text-green-live" : "text-text-muted"
                    }`}
                  >
                    {p.paid ? "Pagado" : "Pendiente"}
                  </span>
                  {canToggle && p.role !== "admin" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => togglePaid(p)}
                      className="text-[11px] ml-1 px-2 py-1 rounded-lg border border-border-subtle hover:border-gold/40 text-text-secondary hover:text-gold disabled:opacity-50 transition-colors"
                    >
                      {busy ? "…" : p.paid ? "Desmarcar" : "Marcar"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
