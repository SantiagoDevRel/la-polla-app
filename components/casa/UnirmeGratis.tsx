"use client";

// components/casa/UnirmeGratis.tsx — la puerta de una polla sin entrada.
//
// (2026-09-18, migración 143) POLLA REGALO no cuesta nada y el flujo pedía
// transferir y subir el pantallazo: dos personas subieron el comprobante de una
// transferencia de $0 y un administrador los aprobó a mano. Pedido del dueño:
// tocar «Unirme» y quedar registrado, sin comprobante y sin revisión.
//
// Un clic, nunca solo: nadie entra a una polla sin pedirlo. El servidor es
// idempotente, así que un doble toque no crea dos cupos.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Ticket } from "lucide-react";
import { StreetCard } from "@/components/street";
import { useToast } from "@/components/ui/Toast";
import { joinFreePolla } from "@/lib/casa/join-free";

export function UnirmeGratis({ slug, nombre, premio, ownerId }: {
  slug: string;
  nombre: string;
  /** El objeto que se juega, cuando el premio no es dinero. */
  premio?: string | null;
  ownerId: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [entrando, setEntrando] = useState(false);
  const [listo, setListo] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [accountChanged, setAccountChanged] = useState(false);
  const submitting = useRef(false);

  async function unirme() {
    if (accountChanged) { router.push("/perfil"); return; }
    if (sessionExpired) { router.push(`/login?returnTo=${encodeURIComponent(`/polla/${slug}`)}`); return; }
    if (submitting.current) return;
    submitting.current = true;
    setEntrando(true);
    const result = await joinFreePolla(slug, ownerId);
    submitting.current = false;
    setEntrando(false);
    if (!result.ok) {
      showToast(result.error, "error");
      setSessionExpired(result.kind === "auth"); setAccountChanged(result.kind === "account");
      // El servidor ya sabe por qué no se pudo (cerró, no es gratis): al
      // recargar, la pantalla muestra el estado real en vez de este botón.
      if (result.kind === "rejected") router.refresh();
      return;
    }
    setListo(true);
    showToast("Listo, ya estás dentro. Ahora haz tus pronósticos.", "success");
    router.refresh();
  }

  return (
    <StreetCard hero className="mt-4 p-4 first:mt-0">
      <h2 className="lp-display-sm text-text-primary">Para participar</h2>
      {/* (2026-09-19) El párrafo era eco del botón, que ya dice «es gratis»: el
          botón es el blindaje contra el comprobante de $0, no la frase. */}
      <p className="mt-1 flex items-start gap-2 text-[15px] leading-relaxed text-text-secondary">
        <Ticket className="mt-0.5 h-5 w-5 shrink-0 text-gold" aria-hidden="true" />
        <span className="min-w-0 [overflow-wrap:anywhere]">Entrar a {nombre} es <strong className="font-semibold text-text-primary">gratis</strong>.</span>
      </p>
      {premio && <p className="mt-2 text-[15px] leading-relaxed text-text-secondary">Se juega <strong className="font-semibold text-text-primary">{premio}</strong>.</p>}
      <button type="button" onClick={unirme} disabled={entrando || listo} className="lp-btn lp-btn-primary mt-4 w-full">
        {listo ? "Ya estás dentro" : entrando ? "Entrando..." : accountChanged ? "Revisar cuenta" : sessionExpired ? "Iniciar sesión" : "Entrar gratis"}
      </button>
    </StreetCard>
  );
}

export default UnirmeGratis;
