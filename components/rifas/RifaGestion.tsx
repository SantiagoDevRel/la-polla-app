"use client";
// components/rifas/RifaGestion.tsx — panel del creador de una rifa.
//
// Todo lo que decide dinero o permisos lo hace SQL (migración 157) a través de
// /api/rifas/<slug>/gestion: aprobar, rechazar, revertir, venta por fuera,
// marcar pagado, liberar, resultado y visibilidad. Aquí solo se muestran los
// datos y se piden confirmaciones. Nombres y celulares de compradores solo se
// ven en este panel (el tablero público y la imagen de historia no los tienen).
import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Download, Eye, Image as ImageIcon, MessageCircle, Share2, Trophy } from "lucide-react";
import PhoneInput from "@/components/ui/PhoneInput";
import { useToast } from "@/components/ui/Toast";
import { ColombiaDateTimeField } from "@/components/casa/ColombiaDateTimeField";
import { CopiarDato } from "@/components/casa/CopiarDato";
import { Label, StreetCard } from "@/components/street";
import { RifaBoard, RifaLegend, type BoardCell } from "@/components/rifas/RifaBoard";
import { formatCop } from "@/lib/casa/format";
import { formatColombiaDateTime, toColombiaDateTimeInput } from "@/lib/time/colombia";
import { ImagePreparationError, PRIZE_IMAGE_PREPARE_OPTIONS, prepareImageUpload } from "@/lib/casa/prepare-proof";
import {
  displayPhone, drawLabel, PAYMENT_METHOD_LABEL, rifaNumber, rifaShareText, STORY_CLUBS, whatsappChatUrl, whatsappShareUrl,
  type RifaCreatorTicket, type RifaCreatorView,
} from "@/lib/rifas/shared";

type Action = Record<string, unknown> & { action: string };

const EVENT_LABEL: Record<string, string> = {
  rifa_creada: "Rifa creada", visibilidad: "Cambió la visibilidad", oculta: "La Polla ocultó la rifa", visible: "La Polla volvió a mostrar la rifa",
  reserva: "Reserva", reserva_cancelada: "Reserva cancelada", reservas_vencidas: "Reservas vencidas",
  comprobante_enviado: "Comprobante recibido", pago_aprobado: "Pago aprobado", pago_rechazado: "Pago rechazado",
  aprobacion_revertida: "Aprobación revertida", venta_por_fuera: "Venta por fuera", venta_por_fuera_pagada: "Venta por fuera pagada",
  numero_liberado: "Número liberado", resultado: "Resultado", reporte: "Reporte de un usuario",
};

export function RifaGestion({ initial, shareUrl }: { initial: RifaCreatorView; shareUrl: string }) {
  const [rifa, setRifa] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const { showToast } = useToast();
  const slug = rifa.slug;

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/rifas/${slug}/gestion`, { cache: "no-store" });
    if (res.ok) setRifa(await res.json());
  }, [slug]);

  const act = useCallback(async (body: Action, ok?: string): Promise<{ ok: boolean; code?: string; message?: string }> => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/rifas/${slug}/gestion`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo completar la operación."); return { ok: false, code: data.code, message: data.error }; }
      if (ok) showToast(ok, "success");
      return { ok: true };
    } finally {
      setBusy(false);
      await refresh();
    }
  }, [slug, refresh, showToast]);

  const byNumber = useMemo(() => new Map(rifa.tickets.map((t) => [t.number, t])), [rifa.tickets]);
  const cells: BoardCell[] = useMemo(() => Array.from({ length: rifa.number_count }, (_, n) => {
    const t = byNumber.get(n);
    return { n, state: t ? t.state : "libre" };
  }), [rifa.number_count, byNumber]);
  const pending = rifa.proofs.filter((p) => p.state === "en_revision");
  const approved = rifa.proofs.filter((p) => p.state === "aprobado");
  const finished = rifa.status !== "abierta";
  const drawPassed = new Date(rifa.draw_at).getTime() <= Date.now();

  return (
    <div className="space-y-4 px-4 pt-4">
      {/* Resumen: cifras de SQL. */}
      <StreetCard className="p-4">
        <dl className="grid grid-cols-3 gap-2 text-center">
          <div><dt className="text-[12px] text-text-muted">Pagados</dt><dd className="font-display text-[26px] leading-none tracking-[0.04em]">{rifa.summary.pagado}</dd></div>
          <div><dt className="text-[12px] text-text-muted">Reservados</dt><dd className="font-display text-[26px] leading-none tracking-[0.04em]">{rifa.summary.reservado}</dd></div>
          <div><dt className="text-[12px] text-text-muted">Recaudado</dt><dd className="lp-money text-[18px] leading-tight text-text-primary">{formatCop(rifa.summary.collected_cop)}</dd></div>
        </dl>
        <p className="mt-3 border-t border-border-subtle pt-3 text-[13px] text-text-secondary [overflow-wrap:anywhere]">
          Juega {drawLabel(rifa.draw_at)} con {rifa.lottery_name} · {formatCop(rifa.price_cop)} cada número
        </p>
        {rifa.hidden && <p role="status" className="mt-2 text-[13px] text-amber">La Polla ocultó esta rifa{rifa.hidden_reason ? `: ${rifa.hidden_reason}` : "."}</p>}
        {!finished && <Visibility rifa={rifa} busy={busy} act={act} />}
      </StreetCard>

      {error && <p role="alert" className="rounded-lg border border-red-alert/40 bg-red-alert/10 px-3 py-2 text-[15px] text-text-primary">{error}</p>}

      {pending.length > 0 && (
        <section aria-labelledby="pendientes-title" className="space-y-2">
          <h2 id="pendientes-title" className="lp-display-sm flex items-center gap-2 text-[22px]">
            Comprobantes por revisar
            <span className="rounded-full bg-red-alert px-2 py-0.5 font-body text-[13px] font-semibold text-text-primary">{pending.length}</span>
          </h2>
          {pending.map((p) => <ProofCard key={p.id} slug={slug} proof={p} busy={busy} act={act} locked={drawPassed} />)}
        </section>
      )}

      <ResultSection rifa={rifa} busy={busy} act={act} drawPassed={drawPassed} />

      <section aria-labelledby="tablero-title">
        <div className="mb-2 flex items-end justify-between gap-3">
          <h2 id="tablero-title" className="lp-display-sm text-[22px]">Tablero</h2>
          <p className="text-[13px] text-text-secondary">Toca un número</p>
        </div>
        <RifaBoard label="Tablero de la rifa" cells={cells} winningNumber={rifa.winning_number} onPick={(n) => setOpen(n)} />
        <RifaLegend showReview />
      </section>

      <SharePanel rifa={rifa} shareUrl={shareUrl} />
      <PrizePhoto slug={slug} hasImage={rifa.has_prize_image} onDone={refresh} />

      {rifa.tickets.length > 0 && (
        <details className="lp-card group p-4">
          <summary className="flex min-h-11 cursor-pointer items-center justify-between text-[15px] font-semibold">Compradores ({rifa.tickets.length})</summary>
          <ul className="mt-2 divide-y divide-border-subtle">
            {rifa.tickets.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                <span className="font-display text-[18px] tracking-[0.04em]">{rifaNumber(t.number)}</span>
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{t.name ?? "Sin nombre"}<span className="block text-text-muted">{displayPhone(t.phone)}</span></span>
                <span className="text-text-secondary">{t.state === "pagado" ? "Pagado" : t.state === "en_revision" ? "En revisión" : "Reservado"}{t.origin === "fuera" ? " · por fuera" : ""}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {approved.length > 0 && !finished && (
        <details className="lp-card p-4">
          <summary className="flex min-h-11 cursor-pointer items-center text-[15px] font-semibold">Pagos aprobados en la app ({approved.length})</summary>
          <div className="mt-2 space-y-2">{approved.map((p) => <ProofCard key={p.id} slug={slug} proof={p} busy={busy} act={act} locked={drawPassed} />)}</div>
        </details>
      )}

      <details className="lp-card p-4">
        <summary className="flex min-h-11 cursor-pointer items-center text-[15px] font-semibold">Actividad</summary>
        <ul className="mt-2 space-y-1.5 text-[13px] text-text-secondary">
          {rifa.events.map((e, i) => (
            <li key={i}>
              <span className="text-text-muted">{formatColombiaDateTime(e.created_at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>{" · "}
              {EVENT_LABEL[e.kind] ?? e.kind}{eventNumbers(e.detail)}{typeof e.detail.reason === "string" && e.detail.reason ? ` · ${e.detail.reason}` : ""}
            </li>
          ))}
        </ul>
      </details>

      {open !== null && (
        <TicketDialog number={open} ticket={byNumber.get(open) ?? null} rifa={rifa} busy={busy} act={act} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

function eventNumbers(detail: Record<string, unknown>): string {
  const list = Array.isArray(detail.numbers) ? detail.numbers : typeof detail.number === "number" ? [detail.number] : [];
  return list.length ? ` · ${list.map((n) => rifaNumber(Number(n))).join(", ")}` : "";
}

function Visibility({ rifa, busy, act }: { rifa: RifaCreatorView; busy: boolean; act: (b: Action, ok?: string) => Promise<{ ok: boolean }> }) {
  const publica = rifa.visibility === "publica";
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle pt-3">
      <p className="text-[13px] text-text-secondary">{publica ? "Pública: la abre cualquiera con el enlace." : "Privada: solo tú y los administradores."}</p>
      <button type="button" disabled={busy}
        onClick={() => void act({ action: "visibilidad", visibility: publica ? "privada" : "publica" }, publica ? "La rifa quedó privada." : "La rifa quedó pública.")}
        className="lp-btn lp-btn-ghost !min-h-11 !px-4 text-[13px]">{publica ? "Volver a privada" : "Hacer pública"}</button>
    </div>
  );
}

// locked: ya pasó el sorteo. Solo se aprueba; rechazar o revertir permitiría
// quitarle el premio a quien ganó (SQL responde DRAW_LOCKED).
function ProofCard({ slug, proof, busy, act, locked }: {
  slug: string; proof: RifaCreatorView["proofs"][number]; busy: boolean; locked: boolean;
  act: (b: Action, ok?: string) => Promise<{ ok: boolean }>;
}) {
  const [mode, setMode] = useState<null | "rechazar" | "revertir">(null);
  const [reason, setReason] = useState("");
  return (
    <StreetCard className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold [overflow-wrap:anywhere]">{proof.buyer_name ?? "Comprador"}</p>
          <p className="text-[13px] text-text-muted">{displayPhone(proof.buyer_phone)}</p>
        </div>
        <p className="lp-money text-[20px] leading-none">{formatCop(proof.amount_cop)}</p>
      </div>
      <p className="text-[13px] text-text-secondary">Números {proof.numbers.map(rifaNumber).join(", ")}</p>
      <a href={`/api/rifas/${slug}/comprobante/${proof.id}`} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-ghost w-full">
        <Eye aria-hidden="true" className="h-5 w-5" /> Ver comprobante
      </a>
      {mode ? (
        <div className="space-y-2">
          <label htmlFor={`motivo-${proof.id}`} className="block text-[13px] text-text-secondary">{mode === "rechazar" ? "¿Por qué lo rechazas?" : "¿Por qué reviertes la aprobación?"}</label>
          <input id={`motivo-${proof.id}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} className="lp-input w-full" />
          <div className="flex gap-2">
            <button type="button" onClick={() => { setMode(null); setReason(""); }} className="lp-btn lp-btn-ghost flex-1">Cancelar</button>
            <button type="button" disabled={busy || reason.trim().length < 3}
              onClick={() => void act({ action: mode, proofId: proof.id, reason }, mode === "rechazar" ? "Comprobante rechazado. Los números quedaron libres." : "Aprobación revertida.")}
              className="lp-btn lp-btn-danger flex-1">{mode === "rechazar" ? "Rechazar" : "Revertir"}</button>
          </div>
        </div>
      ) : proof.state === "en_revision" ? (
        <div className="flex gap-2">
          {!locked && <button type="button" disabled={busy} onClick={() => setMode("rechazar")} className="lp-btn lp-btn-ghost flex-1">Rechazar</button>}
          <button type="button" disabled={busy} onClick={() => void act({ action: "aprobar", proofId: proof.id }, "Pago aprobado.")} className="lp-btn lp-btn-primary flex-1">Aprobar</button>
        </div>
      ) : locked ? null : (
        <button type="button" disabled={busy} onClick={() => setMode("revertir")} className="lp-btn lp-btn-ghost w-full">Revertir aprobación</button>
      )}
    </StreetCard>
  );
}

function ResultSection({ rifa, busy, act, drawPassed }: {
  rifa: RifaCreatorView; busy: boolean; drawPassed: boolean; act: (b: Action, ok?: string) => Promise<{ ok: boolean; code?: string; message?: string }>;
}) {
  const [number, setNumber] = useState("");
  const [unsold, setUnsold] = useState(false);
  const [choice, setChoice] = useState<"volver_a_jugar" | "desierta">("volver_a_jugar");
  const [newDraw, setNewDraw] = useState(() => toColombiaDateTimeInput(new Date(Date.now() + 7 * 86_400_000)));
  const [lottery, setLottery] = useState(rifa.lottery_name);

  if (rifa.status !== "abierta") {
    const w = rifa.winner;
    const chat = w?.phone ? whatsappChatUrl(w.phone, `Hola, ganaste la rifa «${rifa.name}» con el ${rifaNumber(w.number)}.`) : null;
    return (
      <StreetCard hero className="space-y-3 p-4">
        <div className="flex items-center gap-3">
          <Trophy aria-hidden="true" className="h-7 w-7 shrink-0 text-gold" />
          <div>
            <Label>{rifa.status === "resuelta" ? "Número ganador" : "Rifa desierta"}</Label>
            <p className="font-display text-[30px] leading-none tracking-[0.04em]">{rifaNumber(rifa.winning_number ?? 0)}</p>
          </div>
        </div>
        {w && (
          <div className="space-y-2 border-t border-border-subtle pt-3">
            <p className="text-[15px] font-semibold [overflow-wrap:anywhere]">{w.name}</p>
            <p className="text-[13px] text-text-secondary">{displayPhone(w.phone)}</p>
            {rifa.prize_kind === "dinero" && w.payout_account ? (
              <div>
                <p className="text-[13px] text-text-muted">Paga el premio a · {PAYMENT_METHOD_LABEL[(w.payout_method ?? "otro") as keyof typeof PAYMENT_METHOD_LABEL] ?? w.payout_method}</p>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                  <span id="copiar-cuenta-ganador" className="lp-money text-[20px] [overflow-wrap:anywhere]">{w.payout_account}</span>
                  <CopiarDato valor={w.payout_account} etiqueta="cuenta-ganador" nombre="cuenta del ganador" />
                </div>
                {w.payout_account_name && <p className="text-[13px] text-text-secondary">A nombre de {w.payout_account_name}</p>}
              </div>
            ) : null}
            {chat && <a href={chat} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-ghost w-full"><MessageCircle aria-hidden="true" className="h-5 w-5" /> Escribirle por WhatsApp</a>}
          </div>
        )}
      </StreetCard>
    );
  }
  if (!drawPassed) return null;

  async function submit() {
    const n = Number(number);
    const res = await act({ action: "resultado", number: n, unsold: unsold ? choice : null,
      newDrawAt: unsold && choice === "volver_a_jugar" ? newDraw : null, newLottery: unsold && choice === "volver_a_jugar" ? lottery : null },
      "Resultado registrado.");
    if (!res.ok && res.code === "UNSOLD_CHOICE_REQUIRED") setUnsold(true);
  }

  return (
    <StreetCard hero className="space-y-3 p-4">
      <h2 className="lp-display-sm text-[22px]">Resultado del sorteo</h2>
      <label htmlFor="numero-ganador" className="block text-[13px] text-text-secondary">Número que salió ({rifa.lottery_name})</label>
      <input id="numero-ganador" inputMode="numeric" pattern="[0-9]*" maxLength={2} value={number}
        onChange={(e) => { setNumber(e.target.value.replace(/\D/g, "").slice(0, 2)); setUnsold(false); }}
        className="lp-input w-24 text-center font-display text-[24px] tracking-[0.08em]" />
      {unsold && (
        <fieldset className="space-y-2">
          <legend className="text-[15px] text-text-primary">Ese número no se vendió. ¿Qué pasa con la rifa?</legend>
          <label className="flex min-h-11 items-center gap-2 text-[15px]"><input type="radio" name="unsold" checked={choice === "volver_a_jugar"} onChange={() => setChoice("volver_a_jugar")} /> Se vuelve a jugar con otro sorteo</label>
          {choice === "volver_a_jugar" && (
            <div className="grid gap-2 pl-6">
              <ColombiaDateTimeField label="Nuevo sorteo" value={newDraw} onChange={setNewDraw} />
              <label className="text-[13px] text-text-secondary" htmlFor="nueva-loteria">Lotería</label>
              <input id="nueva-loteria" value={lottery} onChange={(e) => setLottery(e.target.value)} maxLength={60} className="lp-input" />
            </div>
          )}
          <label className="flex min-h-11 items-center gap-2 text-[15px]"><input type="radio" name="unsold" checked={choice === "desierta"} onChange={() => setChoice("desierta")} /> Queda desierta</label>
        </fieldset>
      )}
      <button type="button" disabled={busy || number.length === 0} onClick={() => void submit()} className="lp-btn lp-btn-primary w-full">Guardar resultado</button>
      <p className="text-[12px] text-text-muted">Todos ven el resultado. Si el número no se vendió, lo que elijas también se muestra.</p>
    </StreetCard>
  );
}

function SharePanel({ rifa, shareUrl }: { rifa: RifaCreatorView; shareUrl: string }) {
  const [template, setTemplate] = useState<"neutra" | "club">("neutra");
  const [club, setClub] = useState(STORY_CLUBS[0].key);
  const text = rifaShareText(rifa, shareUrl, formatCop(rifa.price_cop));
  const storyHref = `/api/rifas/${rifa.slug}/historia?plantilla=${template}${template === "club" ? `&club=${club}` : ""}`;
  return (
    <StreetCard className="space-y-3 p-4">
      <h2 className="lp-display-sm text-[22px]">Compartir</h2>
      <a href={whatsappShareUrl(text)} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-ghost w-full">
        <Share2 aria-hidden="true" className="h-5 w-5" /> Enviar por WhatsApp
      </a>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id="copiar-enlace-rifa" className="min-w-0 text-[13px] text-text-secondary [overflow-wrap:anywhere]">{shareUrl}</span>
        <CopiarDato valor={shareUrl} etiqueta="enlace-rifa" nombre="enlace de la rifa" />
      </div>
      <Link href={`/rifa/${rifa.slug}`} className="inline-flex min-h-11 items-center text-[13px] font-semibold text-text-secondary underline-offset-4 hover:text-text-primary hover:underline">Ver como comprador</Link>
      <div className="space-y-2 border-t border-border-subtle pt-3">
        <p className="text-[15px] font-semibold">Imagen para historia</p>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Plantilla">
          {(["neutra", "club"] as const).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={template === t} onClick={() => setTemplate(t)}
              className={`min-h-11 rounded-xl border px-3 text-[15px] transition-colors ${template === t ? "border-text-primary bg-bg-elevated text-text-primary" : "border-border-default text-text-secondary hover:border-gold/30"}`}>
              {t === "neutra" ? "La Polla" : "Colores de club"}
            </button>
          ))}
        </div>
        {template === "club" && (
          <>
            <label htmlFor="club-historia" className="block text-[13px] text-text-secondary">Club</label>
            <select id="club-historia" value={club} onChange={(e) => setClub(e.target.value)} className="lp-input w-full">
              {STORY_CLUBS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </>
        )}
        <a href={storyHref} download={`rifa-${rifa.slug}.png`} className="lp-btn lp-btn-ghost w-full">
          <Download aria-hidden="true" className="h-5 w-5" /> Descargar imagen
        </a>
        <p className="text-[12px] text-text-muted">Muestra los números tomados, nunca nombres ni celulares.</p>
      </div>
    </StreetCard>
  );
}

function PrizePhoto({ slug, hasImage, onDone }: { slug: string; hasImage: boolean; onDone: () => Promise<void> }) {
  const [status, setStatus] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  async function upload(file: File) {
    setStatus("Preparando la foto…");
    try {
      const prepared = await prepareImageUpload(file, PRIZE_IMAGE_PREPARE_OPTIONS);
      const candidate = prepared.candidates[0];
      const form = new FormData();
      form.set("file", new File([candidate.blob], "premio", { type: candidate.contentType }));
      setStatus("Subiendo…");
      const res = await fetch(`/api/rifas/${slug}/premio`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      setStatus(res.ok ? "Foto guardada." : data.error ?? "No se pudo guardar la foto.");
      if (res.ok) setVersion((v) => v + 1);
    } catch (err) {
      setStatus(err instanceof ImagePreparationError ? err.message : "No se pudo guardar la foto.");
    } finally {
      if (input.current) input.current.value = "";
      await onDone();
    }
  }
  return (
    <StreetCard className="flex flex-wrap items-center gap-3 p-4">
      {hasImage
        // eslint-disable-next-line @next/next/no-img-element -- URL firmada del bucket privado; sin next/image (free tier).
        ? <img src={`/api/rifas/${slug}/premio?v=${version}`} alt="Foto del premio" width={64} height={64} className="h-16 w-16 rounded-lg object-cover" />
        : <ImageIcon aria-hidden="true" className="h-8 w-8 text-text-muted" />}
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold">Foto del premio</p>
        {status && <p role="status" className="text-[13px] text-text-secondary">{status}</p>}
      </div>
      <input ref={input} id="foto-premio" type="file" accept="image/*" className="sr-only"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
      <label htmlFor="foto-premio" className="lp-btn lp-btn-ghost !min-h-11 !px-4 text-[13px]">{hasImage ? "Cambiar" : "Agregar"}</label>
    </StreetCard>
  );
}

function TicketDialog({ number, ticket, rifa, busy, act, onClose }: {
  number: number; ticket: RifaCreatorTicket | null; rifa: RifaCreatorView; busy: boolean;
  act: (b: Action, ok?: string) => Promise<{ ok: boolean }>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [paid, setPaid] = useState(true);
  const onPhone = useCallback((v: string) => setPhone(v), []);
  const setRef = useCallback((node: HTMLDialogElement | null) => {
    dialog.current = node;
    if (node && !node.open) node.showModal();
  }, []);
  const close = () => dialog.current?.close();
  const closedForSales = rifa.status !== "abierta" || new Date(rifa.draw_at).getTime() <= Date.now();

  async function run(body: Action, ok: string) {
    const res = await act(body, ok);
    if (res.ok) close();
  }

  return (
    <dialog ref={setRef} onClose={onClose} aria-labelledby="numero-title"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      className="m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto rounded-xl border border-border-default bg-bg-card p-4 text-text-primary backdrop:bg-bg-base/80">
      <div className="flex items-center justify-between gap-3">
        <h2 id="numero-title" className="font-display text-[34px] leading-none tracking-[0.04em]">{rifaNumber(number)}</h2>
        <button type="button" onClick={close} className="lp-btn lp-btn-ghost !min-h-11 !px-4 text-[13px]">Cerrar</button>
      </div>
      {!ticket ? (
        closedForSales ? <p className="mt-3 text-[15px] text-text-secondary">Libre. La rifa ya no recibe ventas.</p> : (
          <form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); void run({ action: "venta", number, name, phone, paid }, "Número anotado."); }}>
            <p className="text-[15px] font-semibold">Venta por fuera</p>
            <div>
              <label htmlFor="venta-nombre" className="block text-[13px] text-text-secondary">Nombre</label>
              <input id="venta-nombre" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="off" className="lp-input mt-1 w-full" />
            </div>
            <div>
              <p className="text-[13px] text-text-secondary">Celular</p>
              <div className="mt-1"><PhoneInput onChange={onPhone} /></div>
            </div>
            <label className="flex min-h-11 items-center gap-2 text-[15px]">
              <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} /> Ya pagó
            </label>
            <button type="submit" disabled={busy || name.trim().length < 2 || !/^\+[1-9]\d{7,14}$/.test(phone)} className="lp-btn lp-btn-primary w-full">
              {paid ? "Marcar pagado" : "Marcar reservado"}
            </button>
            <p className="text-[12px] text-text-muted">Anota solo datos que la persona te autorizó. No necesita cuenta: si después se registra con ese celular, verá su número.</p>
          </form>
        )
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-[15px] font-semibold [overflow-wrap:anywhere]">{ticket.name ?? "Comprador"}</p>
          <p className="text-[13px] text-text-secondary">{displayPhone(ticket.phone)}</p>
          <p className="text-[13px] text-text-secondary">
            {ticket.state === "pagado" ? "Pagado" : ticket.state === "en_revision" ? "Comprobante en revisión" : "Reservado"}
            {ticket.origin === "fuera" ? " · venta por fuera" : ""}
            {ticket.expires_at ? ` · vence ${formatColombiaDateTime(ticket.expires_at, { hour: "numeric", minute: "2-digit" })}` : ""}
          </p>
          {ticket.phone && whatsappChatUrl(ticket.phone, `Hola, te escribo por la rifa «${rifa.name}» (número ${rifaNumber(number)}).`) && (
            <a href={whatsappChatUrl(ticket.phone, `Hola, te escribo por la rifa «${rifa.name}» (número ${rifaNumber(number)}).`)!} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-ghost w-full">
              <MessageCircle aria-hidden="true" className="h-5 w-5" /> Escribir por WhatsApp
            </a>
          )}
          {!closedForSales && ticket.origin === "fuera" && ticket.state === "reservado" && (
            <button type="button" disabled={busy} onClick={() => void run({ action: "pagado", ticketId: ticket.id }, "Número pagado.")} className="lp-btn lp-btn-primary w-full">Marcar pagado</button>
          )}
          {!closedForSales && (ticket.state === "reservado" || (ticket.origin === "fuera" && ticket.state === "pagado")) && (
            <button type="button" disabled={busy} onClick={() => void run({ action: "liberar", ticketId: ticket.id }, "Número liberado.")} className="lp-btn lp-btn-ghost w-full">Liberar número</button>
          )}
          {ticket.state === "en_revision" && <p className="text-[13px] text-text-secondary">Revisa su comprobante en «Comprobantes por revisar».</p>}
          {ticket.state === "pagado" && ticket.origin === "app" && !closedForSales && (
            <p className="text-[13px] text-text-secondary">Para revertir este pago usa «Pagos aprobados en la app».</p>
          )}
        </div>
      )}
    </dialog>
  );
}
