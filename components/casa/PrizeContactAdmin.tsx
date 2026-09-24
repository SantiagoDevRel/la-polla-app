"use client";

import { useCallback, useEffect, useState } from "react";

type DeliveryWinner = { name: string; email: string | null; delivered: boolean; provisional: boolean };

/** Only mounted by the server for admins; the endpoint independently enforces it. */
export function PrizeContactAdmin({ pollaId }: { pollaId: string }) {
  const [winners, setWinners] = useState<DeliveryWinner[]>([]);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/casa/admin/pollas/${pollaId}/prize-contacts`, { cache: "no-store", signal });
      const data = await response.json();
      if (!response.ok) throw new Error("read_failed");
      if (!signal?.aborted) { setWinners(data.winners); setError(false); }
    } catch { if (!signal?.aborted) setError(true); }
  }, [pollaId]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const refresh = () => { if (document.visibilityState === "visible") void load(controller.signal); };
    const interval = setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { controller.abort(); clearInterval(interval); document.removeEventListener("visibilitychange", refresh); };
  }, [load]);

  if (error) return <div className="mb-4 text-[13px] text-text-secondary" role="alert">No se pudo consultar el correo para las boletas.
    <button type="button" className="lp-btn lp-btn-ghost mt-2" onClick={() => void load()}>Reintentar</button></div>;
  if (!winners.length) return null;
  return <section className="lp-card mb-4 space-y-3 p-4 text-[15px] leading-relaxed" aria-label="Entrega de boletas: administrador">
    <h2 className="font-display text-[24px] leading-tight tracking-[0.04em]">Correo para entregar las boletas</h2>
    {winners.map((winner, index) => <div key={index} className="space-y-2">
      <p className="font-semibold [overflow-wrap:anywhere]">{winner.name}</p>
      {winner.provisional && <p className="text-[13px] text-text-secondary">Resultado calculado. Confirma la adjudicación antes de enviar las boletas.</p>}
      <p className="text-text-secondary [overflow-wrap:anywhere]">{winner.email ?? "El ganador todavía no ha registrado su correo de Quentro."}</p>
      {winner.email && <button type="button" className="lp-btn lp-btn-ghost" onClick={async () => {
        try { await navigator.clipboard.writeText(winner.email!); setCopied(true); }
        catch { setCopied(false); }
      }}>Copiar correo</button>}
      {winner.delivered && <p className="text-[13px] text-text-secondary">Entrega registrada.</p>}
    </div>)}
    {copied && <p role="status" className="text-[13px] text-turf">Correo copiado.</p>}
  </section>;
}
