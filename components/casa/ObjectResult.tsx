"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Trophy } from "lucide-react";
import UserAvatar from "@/components/ui/UserAvatar";
import type { CasaObjectResult } from "@/lib/casa/object-result";

/** Resultado completo sin adjudicación automática. Oculto mientras faltan partidos. */
export function ObjectResult({ slug }: { slug: string }) {
  const [result, setResult] = useState<CasaObjectResult | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const settled = useRef(false);
  const router = useRouter();
  const retry = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    let active = true;
    let fetching = false;
    let controller: AbortController | undefined;
    async function refresh() {
      if (document.hidden || fetching || settled.current) return;
      fetching = true;
      controller = new AbortController();
      try {
        const response = await fetch(`/api/casa/pollas/${encodeURIComponent(slug)}/object-result`, {
          cache: "no-store", signal: controller.signal,
        });
        const json = await response.json();
        if (!response.ok || !json.result) throw new Error("result unavailable");
        if (!active) return;
        setResult(json.result);
        setError(false);
        if (json.result.state === "settled") {
          settled.current = true;
          router.refresh();
        }
      } catch {
        if (active && !controller?.signal.aborted) setError(true);
      } finally { fetching = false; }
    }
    void refresh();
    const timer = window.setInterval(refresh, 30_000);
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [slug, revision, router]);

  // A failed refresh cannot keep announcing an old provisional winner.
  if (error) return <div role="alert" className="lp-card mb-4 p-4 text-[13px] leading-[1.5] text-text-secondary">
    <p>No se pudo actualizar el resultado.</p>
    <button type="button" className="lp-btn lp-btn-ghost mt-2 min-h-11" onClick={retry}>Reintentar</button>
  </div>;
  if (!result || result.state === "waiting" || result.state === "settled") return null;
  if (result.state === "no_winner") return <section aria-live="polite" className="lp-card mb-4 p-4">
    <h2 className="font-display text-[20px] leading-none tracking-[0.04em]">Sin puntajes ganadores</h2>
    <p className="mt-2 text-[13px] leading-[1.5] text-text-secondary">Todos terminaron con cero puntos. La casa confirmará el cierre.</p>
  </section>;
  if (result.state !== "ready") return null;
  return <section aria-live="polite" className="lp-card mb-4 p-4">
    <h2 className="flex items-center gap-2 font-display text-[20px] leading-none tracking-[0.04em]">
      <Trophy aria-hidden="true" className="h-5 w-5 shrink-0 text-gold" /> Resultado calculado
    </h2>
    <div className="mt-3 flex items-center gap-3">
      <UserAvatar avatarUrl={result.winner.avatar_url} displayName={result.winner.display_name ?? "Participante"} size="sm" />
      <p className="min-w-0 text-[15px] font-semibold leading-[1.45] [overflow-wrap:anywhere]">
        {result.winner.display_name ?? "Participante"}
        <span className="block text-[13px] font-normal leading-[1.5] text-text-secondary">{result.winner.points} puntos{result.tied ? " · Desempate por registro" : ""}</span>
      </p>
    </div>
    <p className="mt-2 text-[13px] leading-[1.5] text-text-secondary">Pendiente de confirmación de la casa.</p>
  </section>;
}
