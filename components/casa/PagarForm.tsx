"use client";

// components/casa/PagarForm.tsx — el pantallazo.
//
// Un solo campo y un solo botón. La gente está en la calle, con una mano, con
// mala señal: cualquier paso extra acá se traduce en alguien que no entra.
//
// La imagen se prepara UNA vez al elegirla (lib/casa/prepare-proof.ts): una
// captura de varios MB baja a unos cientos de KB antes del hash. Ese mismo
// Blob se reutiliza en begin, reintento y reemplazo, y el original válido
// queda como segundo candidato para retomar cargas iniciadas con otros bytes.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SelectorBoleta } from "./Boletas";
import { casaConnectionError, casaPost, uploadSignedFile } from "@/lib/casa/upload-client";
import { ImagePreparationError, prepareImageUpload, type PreparedImage } from "@/lib/casa/prepare-proof";
import { submitProof } from "@/lib/casa/proof-submit";
import { Label, StreetCard } from "@/components/street";
import { useHydrated } from "@/lib/use-hydrated";

interface Props {
  slug: string;
  esRifa: boolean;
  ticketCount: number | null;
  initialTicket?: string;
  resumeOnly?: boolean;
  /**
   * Participación (migración 131): número = completar esa, `null` = abrir una
   * nueva. Sin valor en rifas (ahí manda la boleta).
   */
  entryNumber?: number | null;
  /**
   * Varios cupos a la vez (CuposForm): cada tarjeta es un comprobante de UN cupo.
   * Con `slot`, al registrar no navega: avisa con `onRegistered`.
   */
  slot?: { index: number; total: number };
  onRegistered?: (entryNumber: number | null) => void;
  onSendingChange?: (sending: boolean) => void;
}

export function PagarForm({ slug, esRifa, initialTicket = "", resumeOnly = false, entryNumber, slot, onRegistered, onSendingChange }: Props) {
  const router = useRouter();
  const hydrated = useHydrated();
  const inputRef = useRef<HTMLInputElement>(null);
  // Cada selección recibe un turno: si la persona elige otra imagen mientras
  // se prepara la anterior, el resultado viejo se descarta.
  const selectionRef = useRef(0);
  const sendingRef = useRef(false);
  const mountedRef = useRef(true);
  const navigationIntentRef = useRef(0);
  const navigationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep the request identity across manual retries even when private browsing
  // or a full storage quota prevents sessionStorage from accepting the record.
  const proofRecordsRef = useRef(new Map<string, string>());
  const [fileName, setFileName] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedImage | null>(null);
  const [preparando, setPreparando] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [ticket, setTicket] = useState(initialTicket);
  const [revision, setRevision] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [recuperando, setRecuperando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [listo, setListo] = useState(false);
  const [registrado, setRegistrado] = useState<number | null>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => {
    mountedRef.current = true;
    const cancelNavigation = () => {
      navigationIntentRef.current += 1;
      if (navigationTimerRef.current) clearTimeout(navigationTimerRef.current);
      navigationTimerRef.current = null;
    };
    const onNavigationClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank") return;
      const destination = new URL(link.href, window.location.href);
      if (destination.origin === window.location.origin && destination.href !== window.location.href) cancelNavigation();
    };
    document.addEventListener("click", onNavigationClick, true);
    window.addEventListener("popstate", cancelNavigation);
    return () => {
      mountedRef.current = false;
      selectionRef.current += 1;
      cancelNavigation();
      document.removeEventListener("click", onNavigationClick, true);
      window.removeEventListener("popstate", cancelNavigation);
    };
  }, []);

  async function elegir(f: File | null) {
    if (!f) return;
    const turn = ++selectionRef.current;
    setError(null);
    setPrepared(null);
    setPreview(null);
    setFileName(f.name);
    setPreparando(true);
    try {
      const result = await prepareImageUpload(f);
      if (turn !== selectionRef.current) return;
      setPrepared(result);
      setPreview(URL.createObjectURL(result.candidates[0].blob));
    } catch (cause) {
      if (turn !== selectionRef.current) return;
      setFileName(null);
      setError(cause instanceof ImagePreparationError ? cause.message : "No pudimos preparar la imagen. Toma una captura de pantalla y sube esa imagen.");
    } finally {
      if (turn === selectionRef.current) setPreparando(false);
    }
  }

  async function enviar() {
    if (sendingRef.current || listo) return;
    if (!prepared) {
      setError("Sube el comprobante de la transferencia.");
      return;
    }
    if (esRifa && !ticket) {
      setError("Elige el número de boleta.");
      return;
    }

    const paymentPath = window.location.pathname;
    const navigationIntent = navigationIntentRef.current;

    sendingRef.current = true;
    onSendingChange?.(true);
    setEnviando(true);
    setRecuperando(false);
    setError(null);
    setSessionExpired(false);
    try {
      const url = `/api/casa/pollas/${slug}/join`;
      // Cada participación guarda su propio intento: retomar la 2 nunca reusa el de la 3.
      const target = esRifa ? ticket : entryNumber == null ? `nueva${slot ? `-${slot.index}` : ""}` : `p${entryNumber}`;
      const key = `casa-proof:${slug}:${target || "entry"}`;
      const result = await submitProof({
        sourceSha256: prepared.sourceSha256,
        candidates: prepared.candidates,
        ticketNumber: esRifa ? Number(ticket) : null,
        preserveStoredAttempt: resumeOnly,
        entryNumber: esRifa ? undefined : entryNumber ?? null,
      }, {
        post: (body) => casaPost(url, body, { retrySafe: true, onRetry: () => setRecuperando(true) }),
        upload: (upload, blob) => uploadSignedFile(upload, blob),
        readRecord: () => {
          const memory = proofRecordsRef.current.get(key);
          if (memory) return memory;
          try { return sessionStorage.getItem(key); } catch { return null; }
        },
        writeRecord: (value) => {
          proofRecordsRef.current.set(key, value);
          try { sessionStorage.setItem(key, value); } catch { /* Memory preserves manual retries. */ }
        },
        newRequestId: () => crypto.randomUUID(),
        onRetry: () => setRecuperando(true),
      });
      // Registrado: la próxima participación nueva empieza su propio intento.
      // Si alguien vuelve a elegir el mismo comprobante, SQL lo rechaza en vez
      // de devolver en silencio la participación anterior.
      try { sessionStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
      proofRecordsRef.current.delete(key);
      // The write can finish after the user has left. Keep its confirmation,
      // but never let an old form redirect or update its departed parent.
      if (!mountedRef.current || window.location.pathname !== paymentPath) return;
      setListo(true);
      setRegistrado(result.entryNumber);
      if (onRegistered) { onRegistered(result.entryNumber); return; }
      // Un respiro para que se lea la confirmación antes de volver.
      if (navigationIntentRef.current !== navigationIntent) return;
      navigationTimerRef.current = setTimeout(() => {
        if (mountedRef.current && navigationIntentRef.current === navigationIntent && window.location.pathname === paymentPath) {
          router.push(`/polla/${slug}${result.entryNumber ? `?p=${result.entryNumber}` : ""}`);
        }
      }, 1600);
    } catch (cause) {
      if (!mountedRef.current) return;
      setRevision((n) => n + 1);
      setSessionExpired((cause as { status?: number } | null)?.status === 401);
      setError(cause instanceof TypeError ? casaConnectionError().message : cause instanceof Error ? cause.message : casaConnectionError().message);
    } finally {
      sendingRef.current = false;
      if (mountedRef.current) {
        onSendingChange?.(false);
        setEnviando(false);
        setRecuperando(false);
      }
    }
  }

  if (listo && slot) {
    return (
      <StreetCard className="border-turf/40 p-4">
        <p className="lp-label text-turf">Comprobante {slot.index} de {slot.total} enviado</p>
        <p className="mt-1 text-[13px] text-text-secondary">
          {registrado ? `Quedó como tu cupo #${registrado}. ` : ""}Suma puntos cuando confirmemos este pago.
        </p>
      </StreetCard>
    );
  }

  if (listo) {
    return (
      <StreetCard hero className="p-6 text-center">
        <p className="lp-display-sm text-gold">Pago registrado</p>
        <p className="mt-2 text-[13px] text-text-secondary">
          {esRifa
            ? "Comprobante recibido. Te avisamos al confirmar."
            : "Comprobante recibido. Ya puedes pronosticar; suma al confirmar."}
        </p>
        <Link href={`/polla/${slug}${registrado ? `?p=${registrado}` : ""}`} className="lp-btn lp-btn-primary mt-4 w-full">
          {esRifa ? "Volver a la rifa" : "Ver mi cupo y pronosticar"}
        </Link>
      </StreetCard>
    );
  }

  return (
    <StreetCard className="p-4">
      {resumeOnly && <p className="mb-4 text-[15px] text-text-secondary">La inscripción cerró. Sube el mismo comprobante; no vuelvas a transferir.</p>}
      {esRifa && <div className="mb-4"><SelectorBoleta slug={slug} value={ticket} onChange={setTicket} disabled={enviando || resumeOnly} revision={revision} /></div>}

      <Label>{slot && slot.total > 1 ? `Comprobante del cupo ${slot.index} de ${slot.total}` : "Comprobante de la transferencia"}</Label>

      <input
        ref={inputRef}
        type="file"
        // Sin `capture`: el comprobante es un PANTALLAZO que ya está en la
        // galería, no una foto que se toma ahora. Con capture="environment"
        // varios Android abren la cámara directo y no ofrecen galería, o sea
        // que el pago quedaba imposible de completar.
        accept="image/jpeg,image/png,image/webp"
        disabled={!hydrated || enviando}
        onChange={(e) => {
          void elegir(e.target.files?.[0] ?? null);
          // Permite volver a elegir el mismo archivo después de un error.
          e.target.value = "";
        }}
        className="sr-only"
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={!hydrated || enviando}
        className="mt-2 flex w-full cursor-pointer items-center justify-center rounded-lg border border-dashed border-border-strong bg-bg-elevated p-6 text-center transition-colors hover:border-gold/40 focus-visible:outline focus-visible:outline-gold"
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt="Vista previa del comprobante"
            className="max-h-[240px] w-auto"
          />
        ) : !hydrated ? (
          <span role="status" className="text-[13px] text-text-secondary">Cargando el formulario...</span>
        ) : preparando ? (
          <span role="status" className="text-[15px] text-text-secondary">
            Preparando la imagen…
          </span>
        ) : (
          <span className="text-[13px] text-text-muted">
            Sube aquí el comprobante
          </span>
        )}
      </button>

      {prepared && fileName && (
        <p className="mt-2 text-center text-[13px] text-text-muted [overflow-wrap:anywhere]">
          {fileName} · toca la imagen para cambiarla
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 border border-red-alert/40 bg-red-alert/10 p-2 text-center text-[13px] text-red-alert">
          {error}
          <span className="mt-2 block">Si ya transferiste, no repitas el pago. <a href="/soporte" className="underline">Pide ayuda en Soporte</a>.</span>
        </p>
      )}
      {sessionExpired && <div className="mt-3">
        <a href={`/login?returnTo=${encodeURIComponent(`/polla/${slug}${entryNumber ? `?p=${entryNumber}` : ""}`)}`}
          target="_blank" rel="noopener noreferrer" className="lp-btn w-full border border-border-default">Ingresar de nuevo</a>
        <p className="mt-2 text-center text-[13px] text-text-secondary">Ingresa en la otra pestaña y vuelve aquí para reintentar. Tu comprobante permanece en esta pantalla.</p>
      </div>}

      <button
        type="button"
        onClick={enviar}
        disabled={enviando || preparando || !prepared}
        className="lp-btn lp-btn-primary mt-4 w-full"
      >
        {enviando ? recuperando ? "Verificando el envío..." : "Enviando..." : error ? "Reintentar envío" : "Enviar el comprobante"}
      </button>
      {recuperando && <p role="status" className="mt-2 text-center text-[13px] text-text-secondary">Estamos recuperando el envío. Conserva esta pantalla abierta.</p>}
    </StreetCard>
  );
}
