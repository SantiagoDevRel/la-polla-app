"use client";
// components/rifas/RifaComprador.tsx — la rifa vista por quien compra.
//
// Flujo: elegir números → «Reservar» (SQL atómico) → transferir el valor que
// calcula SQL a la cuenta del creador → subir el comprobante (mismo contrato
// de carga que Casa: compresión en el navegador, URL firmada, verificación de
// bytes en el servidor) → el creador aprueba y el número queda Pagado.
// Sin sesión se ve el tablero y elegir lleva al registro con returnTo.
// Menos texto: una línea por estado; lo legal va en una sola frase al final.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Flag, Trophy, Upload } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { CopiarDato } from "@/components/casa/CopiarDato";
import { PayoutAccountButton } from "@/components/casa/PayoutAccountButton";
import { Label, StreetCard } from "@/components/street";
import { RifaBoard, RifaLegend, type BoardCell } from "@/components/rifas/RifaBoard";
import { formatCop } from "@/lib/casa/format";
import { formatColombiaDateTime } from "@/lib/time/colombia";
import { ImagePreparationError, PROOF_PREPARE_OPTIONS, prepareImageUpload } from "@/lib/casa/prepare-proof";
import { uploadSignedFile } from "@/lib/casa/upload-client";
import { DIGITS_RULE_LABEL, drawLabel, PAYMENT_METHOD_LABEL, rifaNumber, type RifaPublicView } from "@/lib/rifas/shared";

const SELECTION_KEY = (slug: string) => `lp-rifa-sel:${slug}`;

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? "No se pudo completar la operación."), { code: data.code, status: res.status });
  return data;
}

export function RifaComprador({ initial }: { initial: RifaPublicView }) {
  const [rifa, setRifa] = useState(initial);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<null | "reservar" | "comprobante" | "quitar">(null);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();
  const slug = rifa.slug;

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/rifas/${slug}`, { cache: "no-store" });
    if (res.ok) setRifa(await res.json());
  }, [slug]);

  // Refresco cada 30 s y al volver a la pestaña: las reservas ajenas vencen o se pagan.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") void refresh(); };
    const id = window.setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [refresh]);

  // Con sesión: registrar la visita (pestaña RIFAS y embudo). Sin sesión: recuperar lo elegido antes del login.
  useEffect(() => {
    if (initial.viewer.signed_in) {
      void fetch(`/api/rifas/${slug}/visto`, { method: "POST" }).catch(() => {});
      try {
        const saved = JSON.parse(sessionStorage.getItem(SELECTION_KEY(slug)) ?? "[]");
        sessionStorage.removeItem(SELECTION_KEY(slug));
        if (Array.isArray(saved)) {
          const free = new Set(initial.board.filter((c) => c.s === "libre").map((c) => c.n));
          setSelected(new Set(saved.filter((n: unknown) => typeof n === "number" && free.has(n))));
        }
      } catch { /* sin almacenamiento: se vuelve a elegir */ }
    }
  }, [initial.viewer.signed_in, initial.board, slug]);

  const cells: BoardCell[] = useMemo(() => rifa.board.map((c) => ({
    n: c.n, mine: c.m,
    state: c.s === "pagado" ? "pagado" : c.s === "reservado" ? "reservado" : "libre",
  })), [rifa.board]);

  const openForPicking = !rifa.closed && !rifa.hidden && !rifa.viewer.is_creator;
  const toggle = (n: number) => {
    setError(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n); else next.add(n);
      return next;
    });
  };

  const needsAccount = rifa.viewer.signed_in && rifa.prize_kind === "dinero" && !rifa.viewer.has_payout_account;

  async function reservar() {
    setBusy("reservar"); setError(null);
    try {
      await post(`/api/rifas/${slug}/reservar`, { action: "reservar", numbers: [...selected] });
      setSelected(new Set());
      showToast("Números reservados. Transfiere y sube el comprobante.", "success");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  async function quitar(numbers: number[]) {
    setBusy("quitar"); setError(null);
    try { await post(`/api/rifas/${slug}/reservar`, { action: "quitar", numbers }); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(null); await refresh(); }
  }

  const loginHref = `/login?returnTo=${encodeURIComponent(`/rifa/${slug}`)}`;
  function rememberSelection() {
    try { sessionStorage.setItem(SELECTION_KEY(slug), JSON.stringify([...selected])); } catch { /* sin almacenamiento */ }
  }

  const reserved = rifa.viewer.tickets.filter((t) => t.state === "reservado" && t.origin === "app");
  const reviewing = rifa.viewer.tickets.filter((t) => t.state === "en_revision");
  const paid = rifa.viewer.tickets.filter((t) => t.state === "pagado");
  const lastProof = rifa.viewer.proofs[0];
  const expiresAt = reserved.map((t) => t.expires_at).filter(Boolean).sort()[0] ?? null;
  const lastDraw = rifa.draws[rifa.draws.length - 1];

  return (
    <div className="space-y-4 px-4 pt-4">
      {/* Premio, valor y sorteo: tres datos, una tarjeta. */}
      <StreetCard className="p-4">
        <div className="flex gap-4">
          {rifa.has_prize_image && (
            // eslint-disable-next-line @next/next/no-img-element -- bucket privado con URL firmada; sin next/image (free tier).
            <img src={`/api/rifas/${slug}/premio`} alt="Foto del premio" width={88} height={88}
              className="h-[88px] w-[88px] shrink-0 rounded-lg border border-border-subtle object-cover" />
          )}
          <div className="min-w-0 flex-1">
            <Label>Premio</Label>
            {rifa.prize_kind === "dinero"
              ? <div className="lp-money mt-1 text-[30px] leading-none text-gold">{formatCop(rifa.prize_cop ?? 0)}</div>
              : <p className="mt-1 text-[17px] font-semibold leading-snug text-text-primary [overflow-wrap:anywhere]">{rifa.prize_text}</p>}
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border-subtle pt-3 text-[13px]">
          <div className="min-w-0">
            <dt className="text-text-muted">Cada número</dt>
            <dd className="lp-money mt-0.5 text-[20px] leading-none text-text-primary">{formatCop(rifa.price_cop)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-text-muted">Juega</dt>
            <dd className="mt-0.5 font-semibold text-text-primary [overflow-wrap:anywhere]">{drawLabel(rifa.draw_at)}</dd>
          </div>
          <div className="col-span-2 min-w-0">
            <dt className="text-text-muted">Con</dt>
            <dd className="mt-0.5 text-text-primary [overflow-wrap:anywhere]">{rifa.lottery_name} · {DIGITS_RULE_LABEL[rifa.digits_rule]}</dd>
          </div>
        </dl>
      </StreetCard>

      {rifa.visibility === "privada" && (
        <p className="rounded-lg border border-border-default bg-bg-card/80 px-3 py-2 text-[13px] text-text-secondary">Privada: solo la ven quien la creó y los administradores.</p>
      )}
      {rifa.hidden && (
        <p role="status" className="rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-[13px] text-text-primary">La Polla está revisando esta rifa. No recibe reservas.</p>
      )}

      <ResultBanner rifa={rifa} />
      {rifa.status === "abierta" && lastDraw?.outcome === "volver_a_jugar" && (
        <p className="rounded-lg border border-border-default bg-bg-card/80 px-3 py-2 text-[13px] text-text-secondary">
          El {rifaNumber(lastDraw.number)} no se vendió. Se vuelve a jugar el {drawLabel(rifa.draw_at)} con {rifa.lottery_name}.
        </p>
      )}
      {rifa.status === "abierta" && rifa.closed && (
        <p role="status" className="rounded-lg border border-border-default bg-bg-card/80 px-3 py-2 text-[13px] text-text-secondary">Ya no se reciben reservas. Falta el resultado del sorteo.</p>
      )}

      <section aria-labelledby="tablero-title">
        <div className="mb-2 flex items-end justify-between gap-3">
          <h2 id="tablero-title" className="lp-display-sm text-[22px]">Números</h2>
          <p className="text-[13px] text-text-secondary">{rifa.counts.pagado + rifa.counts.reservado} de {rifa.number_count} tomados</p>
        </div>
        <RifaBoard label="Tablero de números" cells={cells} selected={selected} winningNumber={rifa.winning_number}
          onPick={openForPicking ? toggle : undefined} pickable={(c) => c.state === "libre"} />
        <RifaLegend showSelected={openForPicking} />
      </section>

      {error && <p role="alert" className="rounded-lg border border-red-alert/40 bg-red-alert/10 px-3 py-2 text-[15px] text-text-primary">{error}</p>}

      {needsAccount && openForPicking && (
        <StreetCard className="p-4">
          <p className="text-[15px] text-text-primary">Para reservar, agrega la cuenta donde recibirías el premio.</p>
          <PayoutAccountButton label="Agregar mi cuenta" className="lp-btn lp-btn-primary mt-3 w-full"
            note="Si ganas, quien creó la rifa te paga a esta cuenta. También queda guardada en tu perfil." onSaved={() => void refresh()} />
        </StreetCard>
      )}

      {(reserved.length > 0 || reviewing.length > 0 || paid.length > 0) && (
        <StreetCard className="space-y-3 p-4">
          <h2 className="lp-display-sm text-[22px]">Tus números</h2>
          <ul className="flex flex-wrap gap-2">
            {rifa.viewer.tickets.map((t) => (
              <li key={t.number} className="rounded-full border border-border-default bg-bg-elevated px-3 py-1 text-[13px]">
                <span className="font-display text-[16px] tracking-[0.04em]">{rifaNumber(t.number)}</span>{" "}
                <span className="text-text-secondary">{t.state === "pagado" ? "pagado" : t.state === "en_revision" ? "en revisión" : "por pagar"}</span>
              </li>
            ))}
          </ul>
          {reviewing.length > 0 && <p className="text-[15px] text-text-secondary">Tu comprobante está en revisión. Quien creó la rifa confirma el pago.</p>}
          {lastProof?.state === "rechazado" && (
            <p role="alert" className="text-[15px] text-text-primary">Comprobante rechazado{lastProof.reject_reason ? `: ${lastProof.reject_reason}` : "."}</p>
          )}
          {rifa.prize_kind === "texto" && paid.length > 0 && (
            <p className="text-[13px] text-text-secondary">Si ganas, quien creó la rifa te escribe por WhatsApp al celular de tu cuenta.</p>
          )}
        </StreetCard>
      )}

      {reserved.length > 0 && rifa.payment && (
        <PayBlock rifa={rifa} reservedNumbers={reserved.map((t) => t.number)} expiresAt={expiresAt}
          busy={busy} setBusy={setBusy} onDone={refresh} onQuitar={quitar} />
      )}

      <footer className="space-y-2 pt-2 text-[12px] leading-relaxed text-text-muted">
        <p>La Polla solo organiza el tablero. El dinero va directo a quien creó la rifa: La Polla no recibe pagos ni entrega premios.</p>
        {rifa.viewer.signed_in && !rifa.viewer.is_creator && <ReportButton slug={slug} reported={rifa.viewer.reported} />}
      </footer>

      {/* Barra de acción: solo con números elegidos. */}
      {selected.size > 0 && openForPicking && (
        <div className="fixed inset-x-0 bottom-[92px] z-40 mx-auto w-full max-w-[480px] px-4">
          <div className="flex items-center justify-between gap-3 rounded-full border border-border-default bg-bg-card/95 p-2 pl-4 shadow-lg backdrop-blur-md">
            <p className="min-w-0 text-[13px] text-text-secondary">
              <span className="font-display text-[20px] leading-none tracking-[0.04em] text-text-primary">{selected.size}</span>{" "}
              {selected.size === 1 ? "número" : "números"} · {formatCop(rifa.price_cop)} c/u
            </p>
            {!rifa.viewer.signed_in ? (
              <Link href={loginHref} onClick={rememberSelection} className="lp-btn lp-btn-primary shrink-0 !px-5">Entrar para reservar</Link>
            ) : needsAccount ? null : (
              <button type="button" onClick={reservar} disabled={busy !== null} className="lp-btn lp-btn-primary shrink-0 !px-5">
                {busy === "reservar" ? "Reservando…" : "Reservar"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ResultBanner({ rifa }: { rifa: RifaPublicView }) {
  if (rifa.status === "abierta" || rifa.winning_number == null) return null;
  const mine = rifa.draws.some((d) => d.outcome === "ganador" && d.mine);
  return (
    <StreetCard hero className="flex items-center gap-4 p-4">
      <Trophy aria-hidden="true" className="h-8 w-8 shrink-0 text-gold" />
      <div className="min-w-0">
        <Label>{rifa.status === "resuelta" ? "Número ganador" : "Rifa desierta"}</Label>
        <p className="mt-1 text-[15px] text-text-primary">
          <span className="font-display text-[28px] leading-none tracking-[0.04em]">{rifaNumber(rifa.winning_number)}</span>{" "}
          {rifa.status === "resuelta" ? (mine ? "Es tuyo. Ganaste." : `con ${rifa.lottery_name}.`) : "No se vendió y la rifa quedó desierta."}
        </p>
      </div>
    </StreetCard>
  );
}

function PayBlock({ rifa, reservedNumbers, expiresAt, busy, setBusy, onDone, onQuitar }: {
  rifa: RifaPublicView; reservedNumbers: number[]; expiresAt: string | null;
  busy: string | null; setBusy: (v: null | "comprobante") => void; onDone: () => Promise<void>; onQuitar: (n: number[]) => Promise<void>;
}) {
  const payment = rifa.payment!;
  const file = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  async function enviar(chosen: File) {
    setBusy("comprobante"); setError(null); setStatus("Preparando la imagen…");
    try {
      const prepared = await prepareImageUpload(chosen, PROOF_PREPARE_OPTIONS);
      const candidate = prepared.candidates[0];
      setStatus("Subiendo el comprobante…");
      const begun = await post(`/api/rifas/${rifa.slug}/comprobante`, {
        action: "begin", requestId: crypto.randomUUID(), sha256: candidate.sha256, contentType: candidate.contentType, bytes: candidate.bytes,
      });
      if (begun.state === "subiendo" && begun.upload) {
        const uploadError = await uploadSignedFile(begun.upload, candidate.blob);
        if (uploadError) throw new Error("No se pudo subir el comprobante. Intenta de nuevo.");
      }
      setStatus("Confirmando…");
      await post(`/api/rifas/${rifa.slug}/comprobante`, { action: "confirm", proofId: begun.proof_id });
      showToast("Comprobante enviado. Quien creó la rifa revisa el pago.", "success");
      setStatus(null);
    } catch (err) {
      setStatus(null);
      setError(err instanceof ImagePreparationError ? err.message : (err as Error).message);
    } finally {
      setBusy(null);
      if (file.current) file.current.value = "";
      await onDone();
    }
  }

  return (
    <StreetCard hero className="space-y-3 p-4">
      <div>
        <Label>Transfiere exactamente</Label>
        <div className="lp-money mt-1 text-[30px] leading-none text-text-primary">{formatCop(rifa.viewer.pending_amount_cop)}</div>
        <p className="mt-1 text-[13px] text-text-secondary">
          Números {reservedNumbers.map(rifaNumber).join(", ")}
          {expiresAt ? ` · la reserva vence ${formatColombiaDateTime(expiresAt, { hour: "numeric", minute: "2-digit" })}` : ""}
        </p>
      </div>
      <div className="border-t border-border-subtle pt-3">
        <p className="text-[13px] text-text-muted">{PAYMENT_METHOD_LABEL[payment.method]}</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div id="copiar-cuenta-rifa" className="lp-money min-w-0 select-all text-[24px] leading-none text-text-primary [overflow-wrap:anywhere]">{payment.account}</div>
          <CopiarDato valor={payment.account} etiqueta="cuenta-rifa" nombre="número de cuenta" />
        </div>
        <p className="mt-2 text-[13px] text-text-secondary">A nombre de <span className="text-text-primary">{payment.holder}</span></p>
      </div>
      <input ref={file} type="file" accept="image/*" className="sr-only" id="rifa-comprobante"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void enviar(f); }} />
      <label htmlFor="rifa-comprobante" aria-disabled={busy !== null}
        className={`lp-btn lp-btn-primary w-full ${busy !== null ? "pointer-events-none opacity-60" : ""}`}>
        <Upload aria-hidden="true" className="h-5 w-5" /> Subir comprobante
      </label>
      {status && <p role="status" className="text-[13px] text-text-secondary">{status}</p>}
      {error && <p role="alert" className="text-[15px] text-text-primary">{error}</p>}
      <p className="text-[12px] text-text-muted">Una sola transferencia por todos tus números. Si ya transferiste, no repitas el pago.</p>
      <button type="button" disabled={busy !== null} onClick={() => void onQuitar(reservedNumbers)}
        className="lp-btn lp-btn-ghost w-full">Quitar mi reserva</button>
    </StreetCard>
  );
}

function ReportButton({ slug, reported }: { slug: string; reported: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [sent, setSent] = useState(reported);
  const [error, setError] = useState<string | null>(null);
  async function send() {
    setError(null);
    try { await post(`/api/rifas/${slug}/reportar`, { reason }); setSent(true); dialog.current?.close(); }
    catch (err) { setError((err as Error).message); }
  }
  if (sent) return <p className="text-[12px] text-text-muted">Recibimos tu reporte.</p>;
  return <>
    <button type="button" onClick={() => dialog.current?.showModal()}
      className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-[13px] font-semibold text-text-secondary underline-offset-4 hover:text-text-primary hover:underline">
      <Flag aria-hidden="true" className="h-4 w-4" /> Reportar rifa
    </button>
    <dialog ref={dialog} aria-labelledby="reportar-title"
      className="m-auto w-[calc(100%_-_2rem)] max-w-md rounded-xl border border-border-default bg-bg-card p-4 text-text-primary backdrop:bg-bg-base/80">
      <h2 id="reportar-title" className="lp-display-sm text-[22px]">Reportar rifa</h2>
      <label htmlFor="reportar-motivo" className="mt-3 block text-[13px] text-text-secondary">¿Qué pasa con esta rifa?</label>
      <textarea id="reportar-motivo" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} className="lp-input mt-1 w-full" />
      {error && <p role="alert" className="mt-2 text-[13px] text-red-alert">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => dialog.current?.close()} className="lp-btn lp-btn-ghost flex-1">Cancelar</button>
        <button type="button" onClick={send} disabled={reason.trim().length < 3} className="lp-btn lp-btn-primary flex-1">Enviar</button>
      </div>
    </dialog>
  </>;
}
