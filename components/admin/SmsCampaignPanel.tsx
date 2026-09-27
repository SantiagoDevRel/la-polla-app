"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { campaignTemplate, CAMPAIGN_STATES, smsPlainText, smsSize, type AudienceUser, type CampaignPolla } from "@/lib/sms/campaigns/shared";
import { PAISES_SMS } from "@/lib/sms/paises";
import { colombiaDateKey, colombiaDateTimeToIso, formatColombiaDateTime } from "@/lib/time/colombia";

type History = { id: string; message: string; state: string; scheduled_at: string | null; created_at: string; recipient_count: number; credits: number; delivered: number; failed: number; subid: string };
type Catalog = { pollas: CampaignPolla[]; users: (AudienceUser & { suppressed: boolean })[]; exclusions: { id: string; name: string }[]; ownerId: string; nextTime: string; history: History[]; invalid: number };
type Preview = { id: string; message: string; scheduledAt: string | null; count: number; segments: number; unicode: boolean; credits: number; balance: number; reserved: number; invalid: number; excluded: number; recipients: { id: string; name: string; tail: string }[] };
const countries: Record<string, string> = { CO: "Colombia", US: "Estados Unidos", PA: "Panamá", AR: "Argentina", PE: "Perú", CL: "Chile", BR: "Brasil", EC: "Ecuador", ES: "España", PT: "Portugal", BE: "Bélgica" };
const dateLabel = (iso: string) => formatColombiaDateTime(iso, { dateStyle: "long", timeStyle: "short" });
const field = "lp-input mt-2 w-full min-w-0 text-[15px]";
const section = "lp-card space-y-4 p-4 sm:p-5";
const heading = "font-display text-[24px] tracking-wide";
const credits = (n: number) => Number(n).toLocaleString("es-CO", { maximumFractionDigits: 4 });

async function post(body: unknown) {
  const response = await fetch("/api/admin/sms-campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "No se pudo completar la operación.");
  return data;
}

export default function SmsCampaignPanel() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [pollaId, setPollaId] = useState("");
  const [template, setTemplate] = useState<"opening" | "closing">("opening");
  const [days, setDays] = useState(1);
  const [plain, setPlain] = useState(true);
  const [message, setMessage] = useState("");
  const [countryFilter, setCountryFilter] = useState<string[]>(["CO"]);
  const [selected, setSelected] = useState<string[] | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [exceptions, setExceptions] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(25);
  const [schedule, setSchedule] = useState(true);
  const [time, setTime] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [suppressionId, setSuppressionId] = useState("");

  const load = useCallback(async (initial = false) => {
    const response = await fetch("/api/admin/sms-campaigns", { cache: "no-store" });
    const data: Catalog & { error?: string } = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudo cargar el panel.");
    setCatalog(data);
    if (initial) {
      setPollaId(data.pollas[0]?.id ?? ""); setTime(data.nextTime);
      setExcluded(data.exclusions.filter(p => p.name.toLowerCase() === "la polla de carvalho").map(p => p.id));
      setExceptions(data.users.filter(u => u.id === data.ownerId || ["cirilo", "john trujillo"].includes(u.name.toLowerCase().trim())).map(u => u.id));
    }
  }, []);
  useEffect(() => { load(true).catch(e => setError(e.message)); }, [load]);
  const polla = catalog?.pollas.find(p => p.id === pollaId);
  useEffect(() => {
    if (polla) { const text = campaignTemplate(polla, template, days); setMessage(plain ? smsPlainText(text) : text); }
  }, [polla, template, days, plain]);
  useEffect(() => { setPreview(null); }, [pollaId, template, days, message, countryFilter, selected, excluded, exceptions, schedule, time]);
  const available = useMemo(() => (catalog?.users ?? []).filter(u => countryFilter.includes(u.country) && !u.suppressed), [catalog, countryFilter]);
  const matches = available.filter(u => `${u.name} ${u.phone}`.toLowerCase().includes(search.toLowerCase().trim()));
  const size = smsSize(message);
  const toggle = (items: string[], id: string) => items.includes(id) ? items.filter(x => x !== id) : [...items, id];

  async function review() {
    setBusy(true); setError(""); setNotice(""); setPreview(null);
    try {
      const data = await post({ action: "preview", input: { pollaId, template, days, message, scheduledAt: schedule ? time : null, audience: { countries: countryFilter, selectedIds: selected, excludedPollaIds: excluded, exceptionIds: exceptions } } });
      setPreview(data);
      requestAnimationFrame(() => document.getElementById("sms-review")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo revisar."); }
    finally { setBusy(false); }
  }
  async function send() {
    if (!preview) return;
    setBusy(true); setError("");
    try {
      const data = await post({ action: "send", id: preview.id, confirmed: true });
      if (data.state === "unknown" || data.state === "rejected") {
        setError(`${CAMPAIGN_STATES[data.state]}. ${data.state === "unknown" ? "Comprueba la referencia en LabsMobile antes de preparar otro envío." : "El proveedor rechazó la campaña. Revisa su referencia en el historial."}`);
      } else {
        setNotice(`${CAMPAIGN_STATES[data.state] ?? data.state}. ${data.state === "scheduled" ? "El proveedor conserva la programación; puedes cerrar esta página." : "Consulta las confirmaciones en el historial."}`);
      }
      setPreview(null);
      await load();
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : "No se recibió confirmación. Consulta el historial antes de repetir.");
      await load().catch(() => {});
    } finally { setBusy(false); }
  }
  function alignClosingDays() {
    if (!polla) return;
    try {
      const sendDate = schedule ? colombiaDateTimeToIso(time) : new Date().toISOString();
      const remaining = Math.round((Date.parse(colombiaDateKey(polla.closesAt)) - Date.parse(colombiaDateKey(sendDate))) / 86400000);
      setDays(Math.max(0, Math.min(60, remaining)));
    } catch { setError("Selecciona primero una fecha de envío válida."); }
  }

  return <main className="mx-auto w-full max-w-3xl space-y-6 px-4 pb-32 pt-6 font-body text-[15px] leading-relaxed text-text-primary">
    <header>
      <Link href="/admin" className="inline-flex min-h-11 items-center gap-2 text-text-secondary transition-colors hover:text-text-primary"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Administración</Link>
      <h1 className="font-display text-[34px] leading-tight tracking-wide">Campañas SMS</h1>
      <p className="mt-2 text-[13px] text-text-secondary">Acceso exclusivo de Santiago. Horarios de Colombia.</p>
    </header>
    {error && <p role="alert" className="rounded-lg border border-red-alert/40 bg-red-alert/10 p-4 text-red-alert">{error}</p>}
    {notice && <p role="status" className="rounded-lg border border-turf/30 bg-turf/10 p-4">{notice}</p>}
    {!catalog ? <section aria-busy={!error} className={section}>{error ? <button onClick={() => load(true).then(() => setError("")).catch(e => setError(e.message))} className="lp-btn lp-btn-ghost">Reintentar</button> : <div className="h-40 animate-pulse rounded-lg bg-bg-elevated" aria-label="Cargando campañas" />}</section> : <>
      {!catalog.pollas.length ? <section className={section}><MessageSquare className="h-8 w-8 text-text-secondary" aria-hidden="true" /><h2 className={heading}>No hay pollas abiertas</h2><p>Publica una polla para preparar su campaña.</p><Link href="/admin/pollas" className="lp-btn lp-btn-primary">Administrar pollas</Link></section> : <>
        <fieldset disabled={busy} className="min-w-0 space-y-6 disabled:opacity-70">
          <section className={section}>
            <h2 className={heading}>1. Mensaje</h2>
            <label className="block">Polla<select className={field} value={pollaId} onChange={e => setPollaId(e.target.value)}>{catalog.pollas.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            {polla && <p className="text-[13px] text-text-secondary">{polla.name} · Cierre: {dateLabel(polla.closesAt)}</p>}
            <fieldset className="space-y-2"><legend>Plantilla</legend>{([["opening", "Apertura de polla"], ["closing", "Recordatorio de cierre"]] as const).map(([value, label]) => <label key={value} className="flex min-h-11 cursor-pointer items-start gap-3 py-2"><input type="radio" name="sms-template" className="mt-1 h-5 w-5 shrink-0" checked={template === value} onChange={() => setTemplate(value)} /><span>{label}</span></label>)}</fieldset>
            {template === "closing" && <div className="space-y-2"><label className="block">Días hasta el cierre<input aria-label="Días hasta el cierre" type="number" min={0} max={60} className={field} value={days} onChange={e => setDays(Number(e.target.value))} /></label><p className="text-[13px] text-text-secondary">0: hoy · 1: mañana · 2 o más: en N días.</p><button type="button" onClick={alignClosingDays} className="lp-btn lp-btn-ghost">Calcular según el horario de envío</button></div>}
            <label className="flex min-h-11 cursor-pointer items-start gap-3"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={plain} onChange={e => setPlain(e.target.checked)} /><span>Usar plantilla sin tildes para reducir segmentos</span></label>
            <label className="block">Texto del SMS<textarea aria-label="Texto del SMS" rows={12} className={`${field} resize-y`} maxLength={1500} value={message} onChange={e => setMessage(e.target.value)} /></label>
            <p className="text-[13px] text-text-secondary">{message.length} caracteres · {size.unicode ? "Unicode" : "GSM-7"} · {size.segments} {size.segments === 1 ? "segmento" : "segmentos"} por persona.</p>
          </section>
          <section className={section}>
            <h2 className={heading}>2. Destinatarios</h2>
            <p className="text-[13px] text-text-secondary">El país corresponde al número de celular, no a la ubicación actual.</p>
            <details className="rounded-lg border border-subtle p-3"><summary className="min-h-11 cursor-pointer py-2">Países: {countryFilter.map(c => countries[c]).join(", ") || "ninguno"}</summary><div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Países de los números">{PAISES_SMS.map(country => <label key={country} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-subtle px-3 transition-colors hover:bg-bg-elevated"><input type="checkbox" checked={countryFilter.includes(country)} onChange={() => setCountryFilter(toggle(countryFilter, country))} />{countries[country]}</label>)}</div></details>
            <fieldset className="space-y-2"><legend>Selección</legend><label className="flex min-h-11 cursor-pointer items-start gap-3 py-2"><input type="radio" name="sms-audience" className="mt-1 h-5 w-5 shrink-0" checked={selected === null} onChange={() => setSelected(null)} /><span>Todos los números de los países elegidos</span></label><label className="flex min-h-11 cursor-pointer items-start gap-3 py-2"><input type="radio" name="sms-audience" className="mt-1 h-5 w-5 shrink-0" checked={selected !== null} onChange={() => setSelected([])} /><span>Elegir personas</span></label></fieldset>
            <p className="text-[13px] text-text-secondary">{selected === null ? available.length : selected.filter(id => available.some(u => u.id === id)).length} personas antes de exclusiones y números repetidos. {catalog.invalid} cuentas sin número válido o de país no habilitado.</p>
            <details className="rounded-lg border border-subtle p-3"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Excluir miembros de pollas ({excluded.length})</summary><div className="mt-2 max-h-64 space-y-1 overflow-y-auto">{catalog.exclusions.map(p => <label key={p.id} className="flex min-h-11 cursor-pointer items-start gap-3 py-2"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={excluded.includes(p.id)} onChange={() => setExcluded(toggle(excluded, p.id))} /><span className="min-w-0 break-words">{p.name}</span></label>)}</div></details>
            <p className="text-[13px] text-text-secondary">Excepciones: {exceptions.map(id => catalog.users.find(u => u.id === id)?.name).filter(Boolean).join(", ") || "ninguna"}. Se mantienen los filtros de país y las bajas.</p>
            <details className="rounded-lg border border-subtle p-3" open={selected !== null ? true : undefined}><summary className="min-h-11 cursor-pointer py-2 font-semibold">Buscar personas y ajustar excepciones</summary>
              <label className="mt-2 block">Nombre o celular<input type="search" className={field} value={search} onChange={e => { setSearch(e.target.value); setLimit(25); }} autoComplete="off" /></label>
              {selected !== null && <button type="button" className="lp-btn lp-btn-ghost my-2" onClick={() => setSelected([...new Set([...selected, ...matches.map(u => u.id)])])}>Seleccionar los {matches.length} resultados</button>}
              <ul className="mt-3 divide-y divide-subtle">{matches.slice(0, limit).map(u => <li key={u.id} className="space-y-2 py-3"><p className="break-words font-semibold">{u.name} <span className="font-normal text-text-secondary">· {u.phone}</span></p><div className="flex flex-wrap gap-x-5 gap-y-2">{selected !== null && <label className="flex min-h-11 cursor-pointer items-center gap-2"><input type="checkbox" checked={selected.includes(u.id)} onChange={() => setSelected(toggle(selected, u.id))} />Seleccionar</label>}<label className="flex min-h-11 cursor-pointer items-center gap-2"><input type="checkbox" checked={exceptions.includes(u.id)} onChange={() => setExceptions(toggle(exceptions, u.id))} />Excepción a la exclusión por polla</label></div></li>)}</ul>
              {!matches.length && <p className="py-4 text-text-secondary">No hay personas con estos filtros.</p>}
              {matches.length > limit && <button type="button" className="lp-btn lp-btn-ghost w-full" onClick={() => setLimit(limit + 25)}>Mostrar más ({matches.length - limit})</button>}
            </details>
          </section>
          <section className={section}>
            <h2 className={heading}>3. Horario</h2>
            <label className="block">Cuándo enviar<select className={field} value={schedule ? "scheduled" : "now"} onChange={e => setSchedule(e.target.value === "scheduled")}><option value="scheduled">Programar</option><option value="now">Enviar ahora</option></select></label>
            {schedule && <label className="block">Fecha y hora de Colombia<input type="datetime-local" className={field} value={time} onChange={e => setTime(e.target.value)} /></label>}
            <p className="text-[13px] text-text-secondary">Lunes a viernes, 7 a. m.–7 p. m.; sábado, 8 a. m.–3 p. m. Sin domingos ni festivos.</p>
          </section>
          {!preview && <button type="button" className="lp-btn lp-btn-primary w-full" disabled={busy || !message.trim()} onClick={review}>{busy ? "Revisando…" : "Revisar campaña"}</button>}
        </fieldset>
        {preview && <section id="sms-review" className={`${section} scroll-mt-6`}>
          <h2 className={heading}>4. Confirmar campaña</h2>
          <p className="whitespace-pre-wrap break-words rounded-lg bg-bg-elevated p-4">{preview.message}</p>
          <dl className="space-y-2"><div><dt className="text-text-secondary">Destinatarios</dt><dd className="font-semibold">{preview.count} números únicos · {preview.segments} segmentos por persona</dd></div><div><dt className="text-text-secondary">Envío (Colombia)</dt><dd>{preview.scheduledAt ? dateLabel(preview.scheduledAt) : "Ahora"}</dd></div><div><dt className="text-text-secondary">Costo estimado</dt><dd>{credits(preview.credits)} créditos · saldo: {credits(preview.balance)}</dd></div></dl>
          <p className="text-[13px] text-text-secondary">Se reservan 10 créditos para códigos de acceso{preview.reserved > 0 ? ` y ${credits(preview.reserved)} para campañas programadas` : ""}. La revisión vence en 10 minutos.</p>
          <details><summary className="min-h-11 cursor-pointer py-2">Ver los {preview.count} destinatarios finales</summary><ul className="max-h-64 space-y-2 overflow-y-auto py-3">{preview.recipients.map(u => <li key={u.id} className="break-words">{u.name} · termina en {u.tail}</li>)}</ul></details>
          <button type="button" onClick={send} disabled={busy} className="lp-btn lp-btn-primary w-full">{busy ? "Procesando · no cierres esta página…" : `${preview.scheduledAt ? "Confirmar programación" : "Confirmar envío"} a ${preview.count} números`}</button>
        </section>}
      </>}
      <section className={section}><div className="flex flex-wrap items-center justify-between gap-2"><h2 className={heading}>Historial</h2><button disabled={busy} onClick={() => load().catch(e => setError(e.message))} className="lp-btn lp-btn-ghost">Actualizar</button></div>
        {!catalog.history.length ? <p className="text-text-secondary">Todavía no hay envíos desde este panel.</p> : <ul className="space-y-4">{catalog.history.map(c => <li key={c.id} className="rounded-lg border border-subtle p-4"><p className="font-semibold">{CAMPAIGN_STATES[c.state] ?? c.state}</p><p className="mt-1 text-[13px] text-text-secondary">{dateLabel(c.scheduled_at ?? c.created_at)} · {c.recipient_count} números</p><p className="mt-2">{c.state === "cancelled" ? "El proveedor confirmó la cancelación. No se enviará." : `${c.delivered} entregados · ${c.failed} fallidos · ${c.recipient_count - c.delivered - c.failed} sin confirmación`}</p><details className="mt-2"><summary className="min-h-11 cursor-pointer py-2">Ver mensaje y referencia</summary><p className="whitespace-pre-wrap break-words">{c.message}</p><p className="mt-3 break-words text-[13px] text-text-secondary">Referencia: {c.subid} · {credits(c.credits)} créditos estimados</p></details></li>)}</ul>}
      </section>
      <details className={section}><summary className="min-h-11 cursor-pointer py-2 font-semibold">Bajas de promociones SMS</summary><p className="text-[13px] text-text-secondary">Registra solicitudes recibidas por soporte. Estos números quedarán fuera de las nuevas campañas, incluso si son excepciones. No cancela envíos ya programados.</p><label className="block">Persona<select className={field} value={suppressionId} onChange={e => setSuppressionId(e.target.value)}><option value="">Selecciona una persona</option>{catalog.users.filter(u => !u.suppressed).map(u => <option key={u.id} value={u.id}>{u.name} · {u.phone.slice(-4)}</option>)}</select></label><button type="button" disabled={busy || !suppressionId} className="lp-btn lp-btn-ghost" onClick={async () => { setBusy(true); setError(""); try { await post({ action: "suppress", userId: suppressionId }); setPreview(null); setSuppressionId(""); await load(); setNotice("Baja registrada para futuras campañas."); } catch (e) { setError(e instanceof Error ? e.message : "No se pudo registrar la baja."); } finally { setBusy(false); } }}>Registrar solicitud de baja</button></details>
    </>}
  </main>;
}
