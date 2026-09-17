"use client";

// components/casa/PagosGanadores.tsx — del último partido al comprobante.
//
// (2026-09-16/17) Pedidos del dueño: cuando termina el último partido de la
// polla (verificado con API-Football), calcular bien a los ganadores, mostrar
// la cuenta de cada uno para pagarles, y subir el comprobante de cada pago,
// que queda en la polla como prueba (PruebasDePago).
//
// Etapas (las decide /api/casa/admin/payouts con SQL):
//   en_curso    → cuántos partidos faltan y qué bloquea el reparto
//   lista       → ganadores calculados con sus cuentas + «Confirmar reparto»
//   repartida   → pagar uno a uno: cuenta, pantallazo y referencia
//   sin_ganador → nadie sumó puntos: la polla cerró sin premio
// El reparto se confirma a mano porque no se puede deshacer.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock3, FileImage, RefreshCw, Trophy } from "lucide-react";
import UserAvatar from "@/components/ui/UserAvatar";
import { Skeleton } from "@/components/ui/Skeleton";
import { CopiarDato } from "@/components/casa/CopiarDato";
import { CASA_HEADERS, settlementMessage, type CasaSettlement } from "@/lib/casa/contract";
import { formatCop, formatShortDate } from "@/lib/casa/format";
import { ImagePreparationError, PRIZE_IMAGE_PREPARE_OPTIONS, prepareImageUpload } from "@/lib/casa/prepare-proof";
import type { AdminPayoutRow, AdminPayoutStage, CasaSettlementReadiness } from "@/lib/casa/types";

const METODO: Record<string, string> = { nequi: "Nequi", bancolombia: "Bancolombia", otro: "Otro medio" };
const TIPO: Record<string, string> = { ahorros: "ahorros", corriente: "corriente" };

/** «16 sep · 3:40 p. m.», en hora de Colombia. */
function fecha(iso: string) {
  return formatShortDate(iso, { time: true });
}

interface PayoutsResponse {
  stage: AdminPayoutStage;
  payable: boolean;
  preview: boolean;
  prizeCop: number;
  rows: AdminPayoutRow[];
  paidCount: number;
  totalCount: number;
  readiness: CasaSettlementReadiness | null;
  /** La polla sigue marcada abierta aunque su cierre ya pasó: se cierra antes de repartir. */
  needsClose?: boolean;
}

export function PagosGanadores({ pollaId, pollaName, kind = "partidos" }: { pollaId: string; pollaName: string; kind?: "partidos" | "manual" }) {
  const router = useRouter();
  const [data, setData] = useState<PayoutsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [confirmando, setConfirmando] = useState(false);
  const [repartiendo, setRepartiendo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/casa/admin/payouts?pollaId=${pollaId}`, { cache: "no-store", signal });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error ?? "No se pudieron cargar los premios.");
      if (signal?.aborted) return;
      setData(json as PayoutsResponse);
      setError(null);
    } catch (cause) {
      if (signal?.aborted) return;
      setError(cause instanceof Error ? cause.message : "No se pudieron cargar los premios.");
    }
  }, [pollaId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, revision]);

  async function repartir() {
    if (repartiendo) return; // doble toque: el primero ya está en camino
    setRepartiendo(true);
    setError(null);
    setAviso(null);
    try {
      if (data?.needsClose) {
        // Su hora de cierre ya pasó: primero se cierran las inscripciones. Si otro
        // administrador ya la cerró, SQL responde INVALID_TRANSITION y se sigue.
        const closing = await fetch(`/api/casa/admin/pollas/${pollaId}`, {
          method: "PATCH",
          headers: CASA_HEADERS,
          body: JSON.stringify({ action: "cerrar" }),
        });
        const closed = await closing.json().catch(() => ({}));
        if (!closing.ok && closed.code !== "INVALID_TRANSITION") throw new Error(closed.error ?? "No se pudieron cerrar las inscripciones.");
      }
      const response = await fetch(`/api/casa/admin/pollas/${pollaId}`, {
        method: "PATCH",
        headers: CASA_HEADERS,
        body: JSON.stringify({ action: "repartir" }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error ?? "No se pudo registrar el reparto.");
      if (json.reparto) setAviso(settlementMessage(json.reparto as CasaSettlement));
      setConfirmando(false);
      setRevision((v) => v + 1);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Se cayó la conexión. Intenta de nuevo.");
    } finally {
      setRepartiendo(false);
    }
  }

  if (data?.stage === "no_aplica") return null;

  const stage = data?.stage;
  const rows = data?.rows ?? [];
  const total = rows.length;
  const pagados = rows.filter((r) => r.paidAt).length;
  // Con sobrante de redondeo los montos difieren por $1: entonces no se dice «cada uno».
  const parejo = rows.every((r) => r.amountCop === rows[0]?.amountCop);
  const titulo = stage === "lista" ? "Ganadores calculados" : stage === "repartida" ? "Pago a ganadores" : stage === "sin_ganador" ? "Polla sin ganador" : "Reparto";
  const unidad = kind === "manual" ? { total: "preguntas resueltas", falta: "Cuando se resuelva la última pregunta" } : { total: "partidos con resultado verificado", falta: "Cuando se verifique el resultado del último partido" };
  const r = data?.readiness;

  return (
    <section aria-labelledby={`pagos-${pollaId}`} className="mb-4 border-b border-border-default pb-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 id={`pagos-${pollaId}`} className="flex items-center gap-2 font-display text-[20px] font-normal uppercase leading-tight tracking-[0.04em] text-text-primary">
          {stage === "lista" && <Trophy className="h-5 w-5 shrink-0 text-gold" aria-hidden="true" />}
          {titulo}
        </h3>
        <button type="button" onClick={() => setRevision((v) => v + 1)} className="lp-btn lp-btn-ghost !px-3 !text-[15px]">
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Actualizar
        </button>
      </div>

      {error && <p role="alert" className="mb-3 rounded-md border border-red-alert/30 p-3 text-[13px] text-red-alert">{error}</p>}
      {aviso && <p role="status" className="mb-3 rounded-md border border-turf/40 bg-turf/10 p-3 text-[13px] text-turf">{aviso}</p>}
      {!data && !error && <div role="status" className="space-y-3"><span className="sr-only">Cargando premios…</span><Skeleton className="h-24 w-full" /></div>}

      {stage === "en_curso" && r && (
        <div className="space-y-2 text-[13px] leading-relaxed text-text-secondary">
          <p className="flex items-center gap-2 text-[15px] text-text-primary">
            <Clock3 className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" />
            {r.doneItems} de {r.totalItems} {unidad.total}
          </p>
          {r.openIssues > 0 && (
            <p className="rounded-md border border-amber/40 bg-amber/10 p-2 text-text-primary">
              Hay {r.openIssues === 1 ? "1 partido con novedades" : `${r.openIssues} partidos con novedades`} por decidir. <Link href="/admin/issues" className="font-semibold underline">Revisar en Issues</Link>
            </p>
          )}
          {r.pendingProofs > 0 && (
            <p className="rounded-md border border-amber/40 bg-amber/10 p-2 text-text-primary">
              Hay {r.pendingProofs === 1 ? "1 comprobante" : `${r.pendingProofs} comprobantes`} de inscripción por revisar. <Link href={`/admin/pollas/recibos?pollaId=${pollaId}`} className="font-semibold underline">Revisar recibos</Link>
            </p>
          )}
          {r.paidEntries === 0 && <p>Esta polla no tiene inscripciones pagadas.</p>}
          <p>
            {r.totalItems > 0 && r.doneItems === r.totalItems
              ? "Resuelve lo pendiente y acá aparecen los ganadores con sus cuentas para pagarles."
              : `${unidad.falta}, acá aparecen los ganadores con sus cuentas para pagarles.`}
          </p>
        </div>
      )}

      {stage === "lista" && data && (
        <>
          <p className="mb-3 text-[13px] leading-relaxed text-text-secondary">
            {kind === "manual" ? "Todas las preguntas están resueltas." : "Todos los partidos tienen su resultado verificado."} Este es el reparto que se registrará:
            {" "}<span className="font-semibold text-text-primary">Pozo {formatCop(data.prizeCop)}</span>
            {total > 0 && <> · {total === 1 ? "1 ganador" : `${total} ganadores`}{total > 1 && parejo ? ` · ${formatCop(rows[0].amountCop)} cada uno` : ""}</>}
          </p>
          {total === 0 && (
            <p className="mb-3 rounded-md border border-border-default p-3 text-[15px] text-text-primary">
              Nadie sumó puntos. Según la regla de la casa, la polla se cierra sin premio.
            </p>
          )}
          <ul className="space-y-3">
            {rows.map((row) => <PagoGanador key={row.id} row={row} mode="preview" onPaid={() => undefined} />)}
          </ul>
          <div className="mt-4">
            {confirmando ? (
              <div className="rounded-md border border-red-alert/40 bg-red-alert/10 p-3">
                <p className="text-[15px] leading-relaxed text-text-primary">
                  Vas a registrar el resultado de <span className="font-semibold">{pollaName}</span>. <span className="font-semibold">No se puede deshacer.</span>
                  {total > 0 ? " Después podrás subir el comprobante de cada pago." : ""}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => setConfirmando(false)} disabled={repartiendo} className="lp-btn lp-btn-ghost grow !text-[15px]">Cancelar</button>
                  <button type="button" onClick={repartir} disabled={repartiendo} className="lp-btn lp-btn-primary grow !text-[15px]">
                    {repartiendo ? "Registrando…" : total > 0 ? "Sí, repartir" : "Sí, cerrar sin ganador"}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmando(true)} className="lp-btn lp-btn-primary w-full !text-[15px]">
                {total > 0 ? "Confirmar ganadores y repartir" : "Cerrar la polla sin ganador"}
              </button>
            )}
          </div>
        </>
      )}

      {stage === "repartida" && data && (
        <>
          <p className="mb-3 text-[13px] leading-relaxed text-text-secondary">
            Pozo {formatCop(data.prizeCop)} · {total === 1 ? "1 ganador" : `${total} ganadores`}
            {total > 1 && parejo && ` · ${formatCop(rows[0].amountCop)} cada uno`} · <span className={pagados === total ? "font-semibold text-turf" : "font-semibold text-amber"}>{pagados} de {total} pagados</span>
          </p>
          <ul className="space-y-3">
            {rows.map((row) => (
              <PagoGanador key={row.id} row={row} mode="pay" onPaid={() => { setRevision((v) => v + 1); router.refresh(); }} />
            ))}
          </ul>
        </>
      )}

      {stage === "sin_ganador" && (
        <p className="text-[15px] leading-relaxed text-text-secondary">Todos los participantes terminaron con cero puntos. La polla quedó resuelta sin premio.</p>
      )}
    </section>
  );
}

function PagoGanador({ row, mode, onPaid }: { row: AdminPayoutRow; mode: "preview" | "pay"; onPaid: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ blob: Blob; type: string; name: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [reference, setReference] = useState(row.paidReference ?? "");
  const [preparando, setPreparando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cambiar, setCambiar] = useState(false);
  const [verProof, setVerProof] = useState(false);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function elegir(f: File | null) {
    if (!f) return;
    setError(null);
    setPreparando(true);
    try {
      const prepared = await prepareImageUpload(f, PRIZE_IMAGE_PREPARE_OPTIONS);
      const candidate = prepared.candidates[0];
      setFile({ blob: candidate.blob, type: candidate.contentType, name: f.name });
      setPreview(URL.createObjectURL(candidate.blob));
    } catch (cause) {
      setFile(null);
      setError(cause instanceof ImagePreparationError ? cause.message : "No pudimos preparar la imagen. Toma un pantallazo y sube esa imagen.");
    } finally {
      setPreparando(false);
    }
  }

  async function registrar() {
    if (!file) { setError("Sube el pantallazo de la transferencia."); return; }
    setEnviando(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("image", file.blob, file.name);
      if (reference.trim()) form.append("reference", reference.trim());
      const response = await fetch(`/api/casa/admin/payouts/${row.id}/proof`, {
        method: "POST",
        headers: { "X-Casa-Contract": CASA_HEADERS["X-Casa-Contract"] },
        body: form,
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error ?? "No se pudo registrar el pago.");
      setFile(null);
      setPreview(null);
      setCambiar(false);
      onPaid();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Se cayó la conexión. Intenta de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  const pagado = Boolean(row.paidAt);
  const formulario = mode === "pay" && (!pagado || cambiar);

  return (
    <li className="rounded-md border border-border-default bg-bg-elevated/60 p-3">
      <div className="flex items-center gap-2">
        <UserAvatar avatarUrl={row.avatarUrl} displayName={row.displayName} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-text-primary [overflow-wrap:anywhere]">{row.displayName}</p>
          {row.note && <p className="text-[12px] text-text-secondary">{row.note}</p>}
        </div>
        <span className="lp-money shrink-0 text-[20px] text-gold">{formatCop(row.amountCop)}</span>
      </div>

      {row.account?.number ? (
        <div className="mt-3 rounded-md border border-border-subtle bg-bg-base/60 p-3">
          <p className="lp-label !text-[11px]">{mode === "preview" ? "Cuenta registrada" : "Transferir a"}</p>
          <p className="mt-1 text-[15px] font-semibold text-text-primary">
            {METODO[row.account.method ?? ""] ?? row.account.method ?? "Cuenta"}
            {row.account.type && row.account.method === "bancolombia" ? ` · ${TIPO[row.account.type] ?? row.account.type}` : ""}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span id={`copiar-pago-${row.id}`} className="lp-money text-[22px] tracking-[0.06em] text-text-primary [overflow-wrap:anywhere]">{row.account.number}</span>
            <CopiarDato valor={row.account.number} etiqueta={`pago-${row.id}`} />
          </div>
          {row.account.holder && <p className="mt-1 text-[13px] text-text-secondary [overflow-wrap:anywhere]">A nombre de {row.account.holder}</p>}
        </div>
      ) : (
        <p className="mt-3 rounded-md border border-amber/40 bg-amber/10 p-3 text-[13px] text-text-primary">
          {row.displayName} todavía no registró su cuenta de pago en el perfil. {mode === "preview" ? "Pídele que la registre, o coordina el pago directamente." : "Coordina el pago directamente y sube el comprobante acá."}
        </p>
      )}

      {pagado && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
          <span className="flex items-center gap-1.5 font-semibold text-turf"><CheckCircle2 aria-hidden="true" className="h-4 w-4" />Pagado · {fecha(row.paidAt!)}</span>
          {row.paidReference && <span className="text-text-secondary">Ref. {row.paidReference}</span>}
          {row.proofUrl && (
            <button type="button" onClick={() => setVerProof((v) => !v)} aria-expanded={verProof} className="lp-btn lp-btn-ghost !min-h-9 !px-3 !text-[13px]">
              <FileImage className="h-4 w-4 shrink-0" aria-hidden="true" />{verProof ? "Ocultar comprobante" : "Ver comprobante"}
            </button>
          )}
          {mode === "pay" && !cambiar && (
            <button type="button" onClick={() => setCambiar(true)} className="min-h-9 text-[13px] font-semibold text-text-secondary underline-offset-2 hover:underline">Cambiar comprobante</button>
          )}
        </div>
      )}
      {pagado && verProof && row.proofUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={row.proofUrl} alt={`Comprobante del pago a ${row.displayName}`} className="mt-3 max-h-[420px] w-full rounded-sm object-contain" />
      )}

      {formulario && (
        <div className="mt-3 border-t border-border-subtle pt-3">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={enviando}
            onChange={(e) => { void elegir(e.target.files?.[0] ?? null); e.target.value = ""; }}
            className="sr-only"
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={enviando}
            className="flex min-h-14 w-full cursor-pointer items-center justify-center rounded-lg border border-dashed border-border-strong bg-bg-elevated p-3 text-center transition-colors hover:border-gold/40 focus-visible:outline focus-visible:outline-gold"
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Vista previa del comprobante" className="max-h-[200px] w-auto" />
            ) : preparando ? (
              <span role="status" className="text-[15px] text-text-secondary">Preparando la imagen…</span>
            ) : (
              <span className="flex items-center gap-2 text-[15px] text-text-primary"><FileImage className="h-5 w-5 shrink-0 text-text-secondary" aria-hidden="true" />{cambiar ? "Elegir otro pantallazo" : "Subir el pantallazo de la transferencia"}</span>
            )}
          </button>
          {file && <p className="mt-1 text-center text-[12px] text-text-muted [overflow-wrap:anywhere]">{file.name} · toca la imagen para cambiarla</p>}
          <label htmlFor={`ref-${row.id}`} className="mt-3 block text-[13px] text-text-secondary">Referencia o nota (opcional)</label>
          <input id={`ref-${row.id}`} value={reference} maxLength={200} onChange={(e) => setReference(e.target.value)} disabled={enviando} className="lp-input mt-1 w-full min-w-0 !text-[15px]" placeholder="Por ejemplo: Nequi 16 sep, 3:40 p.m." />
          {error && <p role="alert" className="mt-2 border border-red-alert/40 bg-red-alert/10 p-2 text-[13px] text-red-alert">{error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {cambiar && <button type="button" onClick={() => { setCambiar(false); setFile(null); setPreview(null); setError(null); }} disabled={enviando} className="lp-btn lp-btn-ghost grow !text-[15px]">Cancelar</button>}
            <button type="button" onClick={registrar} disabled={enviando || preparando || !file} className="lp-btn lp-btn-primary grow !text-[15px]">
              {enviando ? "Guardando…" : pagado ? "Reemplazar comprobante" : "Registrar pago con comprobante"}
            </button>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-text-muted">El comprobante lo verán el ganador y los participantes de la polla como prueba de pago. Si el pantallazo muestra el número de cuenta del ganador, recórtalo antes de subirlo.</p>
        </div>
      )}
    </li>
  );
}
