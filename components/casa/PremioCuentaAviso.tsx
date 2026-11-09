"use client";

// components/casa/PremioCuentaAviso.tsx — «Ganaste: escribe tu cuenta para pagarte».
//
// (2026-11-09) Lo pinta el layout cuando quien entra tiene un premio en dinero
// sin pagar y ninguna cuenta guardada (lib/casa/prize-account-reminder.ts).
// Abre el mismo editor de cuenta de Perfil e Info. Se puede cerrar: vuelve en
// la próxima visita mientras falte la cuenta. Al guardar, el layout se
// refresca y el aviso ya no sale.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PayoutAccountDialog, type PayoutAccountDraft } from "@/components/casa/PayoutAccountButton";
import { formatCop } from "@/lib/casa/format";
import type { PremioSinCuenta } from "@/lib/casa/prize-account-reminder-shared";

export function PremioCuentaAviso({ premios }: { premios: PremioSinCuenta[] }) {
  const router = useRouter();
  const [cerrado, setCerrado] = useState(false);
  const guardada = useRef(false);
  const draft = useRef<PayoutAccountDraft>({ ownerId: null, mutation: null });
  // El diálogo usa un portal a document.body: solo existe en el cliente.
  const [montado, setMontado] = useState(false);
  useEffect(() => { setMontado(true); }, []);
  if (!montado || cerrado || premios.length === 0) return null;

  const total = premios.reduce((suma, p) => suma + p.montoCop, 0);
  const pollas = premios.map((p) => p.nombre).join(", ");

  return (
    <PayoutAccountDialog
      draft={draft}
      title={`Ganaste ${formatCop(total)}`}
      note={`En ${pollas}. Escribe tu Nequi o tu cuenta para que te paguemos.`}
      onSaved={() => { guardada.current = true; }}
      onClose={() => {
        setCerrado(true);
        if (guardada.current) router.refresh();
      }}
    />
  );
}
