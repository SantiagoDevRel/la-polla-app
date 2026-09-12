"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/Skeleton";
import { casaPost, fileDigest, uploadSignedFile } from "@/lib/casa/upload-client";
import type { CasaPayout } from "@/lib/casa/types";

type AwardData = {
  draw: { id: string; state: string; prize_object: string; top_points: number; winner_id: string | null } | null;
  candidates: Array<{ user_id: string; ticket: number; points: number; name: string }>;
  payouts: CasaPayout[]; enabled: boolean; admin: boolean; evidenceUrl: string | null;
};

export function PremioObjeto({ slug }: { slug: string }) {
  const router = useRouter();
  const [data, setData] = useState<AwardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [winner, setWinner] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reference, setReference] = useState("");
  const [page, setPage] = useState(0);
  const lastState = useRef<string | null>(null);
  const url = `/api/casa/pollas/${slug}/award`;
  const load = useCallback(async () => {
    try {
      const result = await fetch(url, { cache: "no-store" });
      const json = await result.json();
      if (!result.ok) throw new Error(json.error);
      const state = JSON.stringify([json.draw?.state, json.payouts.map((p: CasaPayout) => [p.id,p.delivered_at])]);
      if (lastState.current !== null && lastState.current !== state) router.refresh();
      lastState.current = state;
      setData(json); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo cargar el premio."); }
  }, [url, router]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (document.visibilityState === "visible" && !busy) void load(); }, 60_000);
    const visible = () => { if (document.visibilityState === "visible" && !busy) void load(); };
    document.addEventListener("visibilitychange", visible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [load, busy]);

  async function adjudicar() {
    if (!data?.draw || !file || !winner || !confirmed) return;
    setBusy(true); setError(null);
    try {
      const sha256 = await fileDigest(file);
      const key = `casa-draw:${data.draw.id}:${winner}:${sha256}`;
      let requestId = sessionStorage.getItem(key);
      if (!requestId) { requestId = crypto.randomUUID(); sessionStorage.setItem(key, requestId); }
      const attempt = await casaPost(url, { action: "begin", drawId: data.draw.id, winnerId: winner, requestId,
        sha256, contentType: file.type, bytes: file.size });
      if (attempt.state !== "confirmed") {
        await uploadSignedFile(attempt.upload, file);
        try { await casaPost(url, { action: "confirm", attemptId: attempt.attempt_id }); }
        catch (cause) {
          if ((cause as { code?: string }).code !== "UPLOAD_MISMATCH") throw cause;
          const retry = await casaPost(url, { action: "retry", attemptId: attempt.attempt_id });
          await uploadSignedFile(retry.upload, file);
          await casaPost(url, { action: "confirm", attemptId: retry.attempt_id });
        }
      }
      await load(); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo confirmar. Reintenta con el mismo archivo y ganador."); }
    finally { setBusy(false); }
  }

  async function entregar(payoutId: string) {
    setBusy(true); setError(null);
    try { await casaPost(url, { action: "delivery", payoutId, reference }); await load(); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo registrar la entrega."); }
    finally { setBusy(false); }
  }

  if (!data) return error ? <div className="my-4 text-[13px] text-red-alert" role="alert">{error}<button className="lp-btn lp-btn-ghost mt-2 w-full" onClick={load}>Reintentar</button></div> : <Skeleton className="my-4 h-20 w-full" />;
  if (!data.draw && data.payouts.length === 0) return null;
  return <section className="lp-card my-4 space-y-4 p-4 text-[15px]">
    <h2 className="font-display text-[24px] tracking-wide">{data.draw?.state === "pending" ? "Desempate pendiente" : "Premio en objeto"}</h2>
    {data.draw && <>
      <p className="text-text-secondary">{data.draw.prize_object} · {data.draw.top_points} puntos en el primer puesto.</p>
      <details>
        <summary className="min-h-11 cursor-pointer font-semibold">Participantes del desempate ({data.candidates.length})</summary>
        <ol className="space-y-2 py-2 text-[13px]">{data.candidates.slice(page * 20, (page + 1) * 20).map((candidate) => <li key={candidate.ticket} className="[overflow-wrap:anywhere]">{candidate.ticket}. {candidate.name} · {candidate.points} puntos</li>)}</ol>
        {data.candidates.length > 20 && <div className="flex flex-wrap gap-2">
          <button type="button" className="lp-btn lp-btn-ghost flex-1" disabled={page === 0} onClick={() => setPage((n) => n - 1)}>Anteriores</button>
          <button type="button" className="lp-btn lp-btn-ghost flex-1" disabled={(page + 1) * 20 >= data.candidates.length} onClick={() => setPage((n) => n + 1)}>Siguientes</button>
        </div>}
      </details>
      {data.evidenceUrl && <a className="lp-btn lp-btn-ghost w-full" href={data.evidenceUrl} target="_blank" rel="noopener noreferrer">Ver grabación del desempate</a>}
      {data.draw.state === "pending" && !data.admin && <p className="text-text-secondary">Publicaremos el ganador y la grabación cuando termine el sorteo.</p>}
      {data.draw.state === "pending" && data.admin && (!data.enabled ? <p className="text-[13px] text-amber">El procedimiento de sorteo está pendiente de habilitación. Los participantes y sus puntajes ya están fijados.</p> : <fieldset disabled={busy} className="space-y-3">
        <legend className="font-semibold">Registrar el sorteo realizado</legend>
        <p className="text-[13px] leading-relaxed text-text-secondary">Graba la lista completa, el procedimiento con posibilidades iguales y el resultado. Incluye solo los nombres e identificadores del sorteo; no muestres datos de pago.</p>
        <label className="block">Ganador que aparece en la grabación
          <select className="lp-input mt-2 w-full text-[15px]" value={winner} onChange={(e) => { setWinner(e.target.value); setConfirmed(false); }}>
            <option value="">Selecciona al ganador</option>
            {data.candidates.map((candidate) => <option key={candidate.user_id} value={candidate.user_id}>{candidate.ticket}. {candidate.name}</option>)}
          </select>
        </label>
        <label className="block">Grabación del sorteo
          <input type="file" accept="video/mp4,video/webm,video/quicktime" className="mt-2 block w-full min-w-0 text-[13px]" onChange={(e) => {
            const selected = e.target.files?.[0] ?? null;
            if (selected && (selected.size > 50 * 1024 * 1024 || !["video/mp4", "video/webm", "video/quicktime"].includes(selected.type))) { setError("Usa un video MP4, MOV o WEBM de hasta 50 MB."); setFile(null); return; }
            setFile(selected); setConfirmed(false); setError(null);
          }} />
        </label>
        <p className="text-[13px] text-text-secondary">MP4, MOV o WEBM, hasta 50 MB. La grabación queda disponible para los participantes.</p>
        <label className="flex min-h-11 items-start gap-3 text-[13px] leading-relaxed"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /><span>Confirmo que el ganador seleccionado coincide con la grabación. Al adjudicar, el resultado queda definitivo.</span></label>
        <button type="button" className="lp-btn lp-btn-primary w-full" disabled={!winner || !file || !confirmed || busy} onClick={adjudicar}>{busy ? "Verificando y guardando..." : "Adjudicar el objeto"}</button>
      </fieldset>)}
    </>}
    {data.payouts.map((award) => <div key={award.id} className="space-y-2 border-t border-border-default pt-3">
      <p className="font-semibold [overflow-wrap:anywhere]">{award.prize_object} — {award.display_name ?? "Ganador"}</p>
      <p className="text-[13px] text-text-secondary">{award.delivered_at ? `Entrega registrada el ${new Date(award.delivered_at).toLocaleDateString("es-CO")}.` : "Entrega pendiente de coordinación con la casa."}</p>
      {data.admin && !award.delivered_at && award.id && <fieldset className="space-y-3" disabled={busy}>
        <label className="block text-[13px]">Constancia de la entrega realizada<textarea className="lp-input mt-2 w-full text-[15px]" maxLength={500} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Fecha, forma de entrega y referencia de recibido" /></label>
        <button type="button" disabled={busy || reference.trim().length < 3} className="lp-btn lp-btn-ghost w-full" onClick={() => entregar(award.id!)}>{busy ? "Guardando..." : "Confirmar que entregué el objeto"}</button>
      </fieldset>}
    </div>)}
    {error && <p role="alert" className="text-[13px] text-red-alert">{error}</p>}
  </section>;
}
