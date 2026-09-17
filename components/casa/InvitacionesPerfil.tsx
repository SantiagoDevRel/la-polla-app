"use client";

// components/casa/InvitacionesPerfil.tsx — invitaciones en Perfil (migración 135).
//
// El código propio para compartir cuando no hay una polla a mano, cuántas
// personas invitó y, para quien todavía puede elegir, quién lo invitó. La
// regla por polla (cada 5 invitados, un cupo) se explica dentro de cada polla,
// que es donde se cuenta.

import { useEffect, useState } from "react";
import { Gift, Share2 } from "lucide-react";
import { referralLink } from "@/lib/casa/referrals-shared";
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
            <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">
              Cuando personas nuevas que invitaste pagan una polla, sumas para un cupo de regalo en esa polla (normalmente uno por cada 5). La regla de cada polla está en su pestaña Info.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md border border-border-default px-3 py-2">
          <div className="min-w-0">
            <span className="lp-label">Tu código</span>
            <span id="copiar-codigo" className="lp-money mt-0.5 block select-all text-[22px] leading-none text-text-primary [overflow-wrap:anywhere]">{code}</span>
          </div>
          <CopiarDato valor={code} etiqueta="codigo" />
        </div>
        <button type="button" onClick={compartir} className="lp-btn lp-btn-ghost min-h-11 w-full gap-2 text-[15px]">
          <Share2 aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span aria-live="polite">{copiado ? "Mensaje copiado" : "Compartir mi invitación"}</span>
        </button>
        <p className="text-[13px] leading-relaxed text-text-secondary">
          {profile.invited === 0
            ? "Todavía nadie se ha registrado con tu código."
            : `${profile.invited} ${profile.invited === 1 ? "persona se registró" : "personas se registraron"} con tu código · ${profile.counted} ya ${profile.counted === 1 ? "jugó" : "jugaron"} su primera polla.`}
          {profile.gifts > 0 && ` Tienes ${profile.gifts} ${profile.gifts === 1 ? "cupo de regalo activo" : "cupos de regalo activos"}.`}
        </p>
      </section>
      <QuienTeInvito initial={invitee} variant="perfil" />
    </div>
  );
}
