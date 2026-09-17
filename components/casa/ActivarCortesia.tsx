"use client";

// components/casa/ActivarCortesia.tsx — el botón de quien llegó por un enlace
// de cortesía (migración 136).
//
// El código viaja en una cookie que puso proxy.ts, así que sobrevive al login y
// al onboarding: cuando la persona vuelve a la polla ya con cuenta, esto es lo
// primero que ve. Se activa con un clic, nunca solo: nadie entra a una polla
// sin pedirlo.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ticket } from "lucide-react";
import { StreetCard } from "@/components/street";
import { useToast } from "@/components/ui/Toast";
import { CASA_HEADERS } from "@/lib/casa/contract";
import { COURTESY_FINE_PRINT } from "@/lib/casa/courtesies-shared";

export function ActivarCortesia({ polla, holder }: { polla: string; holder: string | null }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [activando, setActivando] = useState(false);
  const [listo, setListo] = useState(false);

  async function activar() {
    setActivando(true);
    try {
      const response = await fetch("/api/casa/cortesias", { method: "POST", headers: CASA_HEADERS, body: "{}" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(data.error ?? "No pudimos activar la cortesía.", "error");
        // El servidor ya descartó el enlace que no sirve: al recargar, esta
        // tarjeta desaparece y queda el camino normal de pagar.
        router.refresh();
        return;
      }
      setListo(true);
      showToast("Listo, ya estás dentro de la polla.", "success");
      router.refresh();
    } catch {
      showToast("Se cayó la conexión. Intenta otra vez.", "error");
    } finally {
      setActivando(false);
    }
  }

  return (
    <StreetCard hero className="mt-4 p-4 first:mt-0">
      <p className="flex items-start gap-2 text-[17px] font-semibold leading-snug text-text-primary">
        <Ticket className="mt-1 h-5 w-5 shrink-0 text-gold" aria-hidden="true" />
        <span>{holder ? `${holder} te regaló un cupo gratis` : "Tienes un cupo gratis"} en {polla}</span>
      </p>
      <button type="button" onClick={activar} disabled={activando || listo} className="lp-btn lp-btn-primary mt-4 w-full">
        {listo ? "Ya estás dentro" : activando ? "Activando..." : "Activar mi cupo gratis"}
      </button>
      <p className="mt-3 text-[12px] leading-snug text-text-muted">{COURTESY_FINE_PRINT}</p>
    </StreetCard>
  );
}

export default ActivarCortesia;
