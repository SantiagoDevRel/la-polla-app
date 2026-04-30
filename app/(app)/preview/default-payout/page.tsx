// app/(app)/preview/default-payout/page.tsx
// PREVIEW only — sin DB. Permite verlo en localhost:3000 antes de
// cablear las migraciones + endpoints. Tap en el botón al fondo
// reabre el modal para iterar el diseño.
"use client";

import { useState } from "react";
import DefaultPayoutPromptModal, {
  type PayoutMethod,
} from "@/components/onboarding/DefaultPayoutPromptModal";

export default function DefaultPayoutPreviewPage() {
  const [open, setOpen] = useState(true);
  const [savedMethod, setSavedMethod] = useState<PayoutMethod | null>(null);
  const [savedAccount, setSavedAccount] = useState<string | null>(null);
  const [skipCount, setSkipCount] = useState(0);

  return (
    <div className="min-h-screen p-6 max-w-lg mx-auto">
      <h1 className="lp-section-title text-[20px] mb-4">Preview · Default payout modal</h1>
      <p className="text-xs text-text-muted mb-4">
        Esto es lo que vería todo user nuevo al primer login (o cualquier
        user existente que aún no haya seteado un default).
      </p>

      <div className="space-y-2 mb-6">
        <button
          onClick={() => setOpen(true)}
          className="w-full px-4 py-3 rounded-xl bg-gold text-bg-base font-semibold text-sm"
        >
          Abrir modal de nuevo
        </button>
      </div>

      <div className="rounded-xl bg-bg-elevated border border-border-subtle p-4 text-xs text-text-secondary space-y-1">
        <p className="text-text-primary font-semibold mb-1">Estado simulado</p>
        <p>Método guardado: {savedMethod ?? "—"}</p>
        <p>Cuenta guardada: {savedAccount ?? "—"}</p>
        <p>Veces saltado: {skipCount}</p>
      </div>

      <DefaultPayoutPromptModal
        open={open}
        initialMethod={savedMethod ?? undefined}
        initialAccount={savedAccount ?? undefined}
        onSubmit={(m, a) => {
          setSavedMethod(m);
          setSavedAccount(a);
          setOpen(false);
        }}
        onSkip={() => {
          setSkipCount((n) => n + 1);
          setOpen(false);
        }}
      />
    </div>
  );
}
