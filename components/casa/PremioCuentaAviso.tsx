"use client";

// components/casa/PremioCuentaAviso.tsx — «Dinos dónde te pagamos», obligatorio.
//
// (2026-11-09) Sale a quien ya pagó una polla en juego, o ganó, y no tiene
// cuenta de pago (lib/casa/prize-account-reminder.ts). No tiene X, Escape no
// lo cierra y tocar afuera tampoco: solo sale al guardar la cuenta, con el
// mismo editor de Perfil. Nunca atrapa: si la lectura falla, el aviso no sale.
//
// El layout trae el estado inicial. Como el layout no se vuelve a pintar al
// navegar (y después de pagar se llega a la polla por router.push), se vuelve
// a consultar en cada cambio de pantalla.

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { PayoutAccountDialog, type PayoutAccountDraft } from "@/components/casa/PayoutAccountButton";
import { useToast } from "@/components/ui/Toast";
import { formatCop } from "@/lib/casa/format";
import type { CuentaPendiente } from "@/lib/casa/prize-account-reminder-shared";

export function PremioCuentaAviso({ inicial, enPausa }: { inicial: CuentaPendiente | null; enPausa: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const { showToast } = useToast();
  const [pendiente, setPendiente] = useState<CuentaPendiente | null>(inicial);
  const [guardada, setGuardada] = useState(false);
  const draft = useRef<PayoutAccountDraft>({ ownerId: null, mutation: null });
  // El diálogo usa un portal a document.body: solo existe en el cliente.
  const [montado, setMontado] = useState(false);
  const primeraRuta = useRef(true);

  useEffect(() => { setMontado(true); }, []);
  useEffect(() => { setPendiente(inicial); }, [inicial]);

  useEffect(() => {
    if (primeraRuta.current) { primeraRuta.current = false; return; }
    if (guardada) return;
    const control = new AbortController();
    fetch("/api/casa/cuenta-pendiente", { cache: "no-store", signal: control.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { pendiente?: CuentaPendiente | null } | null) => {
        if (data && "pendiente" in data) setPendiente(data.pendiente ?? null);
      })
      .catch(() => { /* Sin conexión: se queda lo que había. */ });
    return () => control.abort();
  }, [pathname, guardada]);

  if (!montado || enPausa || guardada || !pendiente) return null;

  const total = pendiente.premios.reduce((suma, p) => suma + p.montoCop, 0);
  const gano = pendiente.premios.length > 0;

  return (
    <PayoutAccountDialog
      required
      draft={draft}
      title={gano ? `Ganaste ${formatCop(total)}` : "¿Dónde te pagamos?"}
      note={gano
        ? `En ${pendiente.premios.map((p) => p.nombre).join(", ")}. Escribe tu Nequi o tu cuenta para que te paguemos.`
        : "Si ganas, te pagamos a esta cuenta. Escríbela una vez y queda guardada en tu perfil."}
      onSaved={() => {
        setGuardada(true);
        showToast("Listo, ya sabemos dónde pagarte.", "success");
        router.refresh();
      }}
      onClose={() => { /* Obligatorio: solo se va al guardar. */ }}
    />
  );
}
