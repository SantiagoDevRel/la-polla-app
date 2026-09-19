"use client";

// components/casa/UsarCupoGratis.tsx — usar el cupo gratis ganado por invitar.
//
// (2026-09-19, migración 144) Por cada 5 invitados que pagan una polla, la
// persona gana un cupo gratis y ELIGE dónde usarlo. Esta es la puerta: aparece
// solo cuando SQL dijo que en esta polla se puede (`can_redeem`). Un clic, nunca
// solo: nadie entra a una polla sin pedirlo. El servidor devuelve el mismo cupo
// ante un doble toque.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Gift } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { redeemFreeEntry } from "@/lib/casa/redeem-free";

export function UsarCupoGratis({ slug, disponibles, className = "" }: {
  slug: string;
  /** Cupos gratis por usar (saldo de la persona). */
  disponibles: number;
  className?: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [usando, setUsando] = useState(false);
  const [listo, setListo] = useState(false);

  async function usar() {
    setUsando(true);
    const result = await redeemFreeEntry(slug);
    setUsando(false);
    if (!result.ok) {
      showToast(result.error, "error");
      // El servidor ya sabe por qué no se pudo: al recargar se ve el estado real.
      router.refresh();
      return;
    }
    setListo(true);
    showToast("Listo, tu cupo gratis ya está activo. Haz tus pronósticos.", "success");
    router.push(`/polla/${slug}${result.entryNumber ? `?p=${result.entryNumber}` : ""}`);
    router.refresh();
  }

  return (
    <div className={`rounded-lg border border-turf/40 bg-turf/10 p-4 ${className}`}>
      <p className="flex items-center gap-2 text-[15px] font-semibold leading-snug text-text-primary">
        <Gift aria-hidden="true" className="h-5 w-5 max-w-none shrink-0 text-turf" />
        <span className="min-w-0 [overflow-wrap:anywhere]">
          {disponibles === 1 ? "Tienes 1 cupo gratis" : `Tienes ${disponibles} cupos gratis`}
        </span>
      </p>
      <button type="button" onClick={usar} disabled={usando || listo} className="lp-btn lp-btn-primary mt-3 w-full">
        {listo ? "Ya estás dentro" : usando ? "Entrando..." : "Usar mi cupo gratis"}
      </button>
    </div>
  );
}

export default UsarCupoGratis;
