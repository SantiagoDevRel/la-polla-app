"use client";

// components/casa/InvitacionesPerfil.tsx — invitaciones en Perfil (migración 135).
//
// El código propio, el avance hacia el próximo cupo gratis y, para quien todavía
// puede elegir, quién lo invitó.
//
// (2026-09-19, pedido del dueño) El conteo es de la persona (migración 144): 5
// invitados en total = 1 cupo gratis para la polla que quiera, así que el código
// SÍ pertenece al Perfil. «0 invitados con pago · 0 cupos de regalo» no se
// entendía: ahora es una barrita de 5 puntos con «2/5». Las cortesías son otra
// cosa y tienen su propio bloque (MisCortesias), solo para quien las recibió.

import { useEffect, useState } from "react";
import { Gift, Share2 } from "lucide-react";
import Link from "next/link";
import { REFERRAL_FINE_PRINT, referralLink, referralMissing, referralProgress } from "@/lib/casa/referrals-shared";
import type { ReferralInviteeState, ReferralProfile } from "@/lib/casa/types";
import { CopiarDato } from "./CopiarDato";
import { QuienTeInvito } from "./QuienTeInvito";

type Data = { profile: ReferralProfile; invitee: ReferralInviteeState };

export function InvitacionesPerfil() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/casa/referidos", { cache: "no-store", signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error("No disponible"); return response.json(); })
      .then((body: Data) => setData(body))
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, []);

  if (error || !data?.profile.code) return null;
  const { profile, invitee } = data;
  const code = profile.code!;
  const every = profile.every;
  const avance = referralProgress(profile.counted, every, profile.available);
  const faltan = referralMissing(profile.counted, every);

  async function compartir() {
    const url = referralLink("https://lapollacolombiana.com", null, code);
    const texto = `Te invito a La Polla Colombiana. Usa mi código ${code} al inscribirte.`;
    if (navigator.share) {
      try { await navigator.share({ title: "La Polla Colombiana", text: texto, url }); return; }
      catch (cause) { if (cause instanceof DOMException && cause.name === "AbortError") return; }
    }
    try {
      await navigator.clipboard.writeText(`${texto}\n${url}`);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2200);
    } catch { /* El código queda visible para copiarlo a mano. */ }
  }

  return (
    <div className="space-y-3">
      <section aria-labelledby="perfil-invitaciones" className="lp-card space-y-3 p-4">
        <div className="flex items-start gap-3">
          <Gift aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-turf" />
          <div className="min-w-0">
            <h2 id="perfil-invitaciones" className="text-[15px] font-semibold text-text-primary">Invita y gana cupos</h2>
            <p className="mt-1 text-[13px] text-text-secondary">{every === 1 ? "1 invitado" : `${every} invitados`} = 1 cupo gratis en la polla que quieras.*</p>
          </div>
        </div>
        {/* La barrita: un punto por invitado que ya pagó, camino al próximo cupo. */}
        <div>
          <div className="flex items-center gap-2">
            <div className="flex min-w-0 flex-1 gap-1.5" aria-hidden="true">
              {Array.from({ length: every }, (_, i) => (
                <span key={i} className={`h-2.5 min-w-0 flex-1 rounded-full ${i < avance ? "bg-turf" : "bg-border-default"}`} />
              ))}
            </div>
            <span className="lp-money shrink-0 text-[18px] leading-none tabular-nums text-text-primary">{avance}/{every}</span>
          </div>
          <p className="mt-2 text-[13px] text-text-secondary">
            <span className="sr-only">{`Llevas ${avance} de ${every} invitados. `}</span>
            {profile.available > 0
              ? "Ya ganaste tu cupo gratis."
              : `Te ${faltan === 1 ? "falta 1 invitado" : `faltan ${faltan} invitados`} para tu cupo gratis.`}
            {profile.in_review > 0 && ` (+${profile.in_review} en revisión)`}
          </p>
        </div>
        {profile.available > 0 && (
          <Link href="/inicio" className="lp-btn lp-btn-primary min-h-11 w-full gap-2 text-[15px]">
            <Gift aria-hidden="true" className="h-4 w-4 shrink-0" />
            {profile.available === 1 ? "Usar mi cupo gratis" : `Usar mis ${profile.available} cupos gratis`}
          </Link>
        )}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md border border-border-default px-3 py-2">
          <div className="min-w-0">
            <span className="lp-label">Tu código</span>
            <span id="copiar-codigo" className="lp-money mt-0.5 block select-all text-[22px] leading-none text-text-primary [overflow-wrap:anywhere]">{code}</span>
          </div>
          <CopiarDato valor={code} etiqueta="codigo" nombre="tu código" />
        </div>
        <button type="button" onClick={compartir} className="lp-btn lp-btn-ghost min-h-11 w-full gap-2 text-[15px]">
          <Share2 aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span aria-live="polite">{copiado ? "Mensaje copiado" : "Compartir mi invitación"}</span>
        </button>
        <p className="text-[13px] italic text-text-muted">{REFERRAL_FINE_PRINT}</p>
      </section>
      <QuienTeInvito initial={invitee} variant="perfil" />
    </div>
  );
}
