"use client";
// components/admin/RifasAdmin.tsx — panel de rifas de creadores (migración 157).
//
// Tres cosas y nada más:
//   1. Creadores: buscar una persona por nombre o celular, habilitarla o
//      quitarle el permiso. Lista con cuántas rifas activas tiene y quién la
//      habilitó. Quitar el permiso no apaga sus rifas en curso.
//   2. Rifas: todas, con reportes; ocultar (con motivo) o volver a mostrar.
//      El administrador NO ve compradores ni comprobantes (Ley 1581).
//   3. Embudo: visitas sin sesión → cuentas nuevas → reservaron → pagaron →
//      entraron a una polla.
// La autoridad es SQL (ADMIN_REQUIRED en cada RPC).
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { HeroFrame, Label, SectionHead } from "@/components/street";
import { useToast } from "@/components/ui/Toast";
import { displayPhone } from "@/lib/rifas/shared";
import { formatColombiaDateTime } from "@/lib/time/colombia";

interface Creator {
  user_id: string; display_name: string | null; whatsapp_number: string | null;
  granted_at: string; granted_by_name: string | null; revoked_at: string | null; revoked_by_name: string | null;
  active_rifas: number; total_rifas: number;
}
interface AdminRifa {
  id: string; slug: string; name: string; creator_name: string | null; visibility: string; status: string; draw_at: string;
  hidden_at: string | null; hidden_reason: string | null; number_count: number; paid: number; pending_proofs: number;
  reports: number; last_report: string | null;
}
interface Funnel {
  rifa_id: string; slug: string; name: string; anonymous_views: number; signups: number;
  signups_reserved: number; signups_paid: number; signups_polla: number;
}
interface Person { id: string; display_name: string | null; whatsapp_number: string | null }

const when = (iso: string) => formatColombiaDateTime(iso, { day: "numeric", month: "short", year: "numeric" });

export function RifasAdmin() {
  const [data, setData] = useState<{ creators: Creator[]; rifas: AdminRifa[]; funnel: Funnel[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Person[] | null>(null);
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/rifas", { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setError(body.error ?? "No se pudo cargar."); return; }
    setError(null);
    setData(body);
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Mismo directorio del panel, con el término en un header (sin teléfonos en la URL).
  useEffect(() => {
    const term = query.trim();
    if (!term) { setResults(null); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/admin/promote?directory=1&page=0", {
          cache: "no-store", headers: { "X-User-Search": encodeURIComponent(term) }, signal: controller.signal,
        });
        const body = await res.json();
        if (!controller.signal.aborted) setResults(res.ok ? body.usuarios ?? [] : []);
      } catch { if (!controller.signal.aborted) setResults([]); }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);

  async function post(body: Record<string, unknown>, ok: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/rifas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(data.error ?? "No se pudo completar.", "error"); return; }
      showToast(ok, "success");
      await load();
    } finally { setBusy(false); }
  }

  const activeCreators = new Set((data?.creators ?? []).filter((c) => !c.revoked_at).map((c) => c.user_id));

  return (
    <div className="pb-28">
      <HeroFrame height="min-h-[120px]">
        <Label>Administración</Label>
        <h1 className="lp-display mt-1 text-[30px]">Rifas de creadores</h1>
      </HeroFrame>
      <div className="space-y-8 px-4 pt-5">
        {error && <p role="alert" className="text-[15px] text-red-alert">{error}</p>}

        <section>
          <SectionHead title="Creadores" meta={data ? `${activeCreators.size} activos` : undefined} />
          <label htmlFor="buscar-creador" className="block text-[13px] text-text-secondary">Buscar por nombre o celular</label>
          <div className="relative mt-1">
            <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted" />
            <input id="buscar-creador" value={query} onChange={(e) => setQuery(e.target.value)} className="lp-input w-full !pl-11" autoComplete="off" />
          </div>
          {results && (
            <ul className="mt-2 space-y-2">
              {results.length === 0 && <li className="text-[13px] text-text-muted">Sin resultados.</li>}
              {results.slice(0, 8).map((p) => (
                <li key={p.id} className="lp-card flex items-center gap-3 p-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">{p.display_name ?? "Sin nombre"}</span>
                    <span className="block text-[13px] text-text-muted">{displayPhone(p.whatsapp_number)}</span>
                  </span>
                  {activeCreators.has(p.id)
                    ? <span className="text-[13px] text-turf">Creador</span>
                    : <button type="button" disabled={busy} onClick={() => void post({ action: "asignar", userId: p.id }, "Creador habilitado.")}
                        className="lp-btn lp-btn-ghost !min-h-11 !px-4 text-[13px]">Habilitar</button>}
                </li>
              ))}
            </ul>
          )}
          <ul className="mt-4 space-y-2">
            {(data?.creators ?? []).map((c) => (
              <li key={c.user_id} className={`lp-card flex flex-wrap items-center gap-3 p-3 ${c.revoked_at ? "opacity-60" : ""}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{c.display_name ?? "Sin nombre"}</span>
                  <span className="block text-[13px] text-text-secondary">
                    {c.active_rifas} activas · {c.total_rifas} en total · habilitado el {when(c.granted_at)}{c.granted_by_name ? ` por ${c.granted_by_name}` : ""}
                    {c.revoked_at ? ` · sin permiso desde el ${when(c.revoked_at)}${c.revoked_by_name ? ` (${c.revoked_by_name})` : ""}` : ""}
                  </span>
                </span>
                {c.revoked_at
                  ? <button type="button" disabled={busy} onClick={() => void post({ action: "asignar", userId: c.user_id }, "Creador habilitado.")} className="lp-btn lp-btn-ghost !min-h-11 !px-4 text-[13px]">Habilitar</button>
                  : <button type="button" disabled={busy} onClick={() => { if (window.confirm(`¿Quitar el permiso a ${c.display_name ?? "esta persona"}? Sus rifas en curso siguen.`)) void post({ action: "quitar", userId: c.user_id }, "Permiso retirado."); }} className="lp-btn lp-btn-ghost !min-h-11 !px-4 text-[13px]">Quitar</button>}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <SectionHead title="Rifas" meta={data ? `${data.rifas.length}` : undefined} />
          <ul className="space-y-2">
            {(data?.rifas ?? []).map((r) => (
              <li key={r.id} className="lp-card space-y-2 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold [overflow-wrap:anywhere]">{r.name}</span>
                    <span className="block text-[13px] text-text-secondary">
                      {r.creator_name ?? "—"} · {r.visibility === "privada" ? "Privada" : "Pública"} · {r.status} · {r.paid}/{r.number_count} pagados
                    </span>
                  </span>
                  <Link href={`/rifa/${r.slug}`} className="text-[13px] font-semibold text-text-secondary underline-offset-4 hover:underline">Ver</Link>
                </div>
                {r.reports > 0 && <p className="text-[13px] text-amber">{r.reports} {r.reports === 1 ? "reporte" : "reportes"}{r.last_report ? `: «${r.last_report}»` : ""}</p>}
                {r.hidden_at
                  ? <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[13px] text-text-muted">Oculta: {r.hidden_reason}</p>
                      <button type="button" disabled={busy} onClick={() => void post({ action: "mostrar", rifaId: r.id }, "Rifa visible otra vez.")} className="lp-btn lp-btn-ghost !min-h-11 !px-4 text-[13px]">Mostrar</button>
                    </div>
                  : <HideControl disabled={busy} onHide={(reason) => post({ action: "ocultar", rifaId: r.id, reason }, "Rifa oculta.")} />}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <SectionHead title="Embudo" />
          <p className="mb-2 text-[13px] text-text-secondary">Visitas sin sesión → cuentas nuevas → reservaron → pagaron → entraron a una polla.</p>
          <div className="overflow-x-auto lp-hscroll">
            <table className="w-full min-w-[480px] text-left text-[13px]">
              <thead className="text-text-muted">
                <tr><th className="py-2 pr-2 font-medium">Rifa</th><th className="px-2 font-medium">Visitas</th><th className="px-2 font-medium">Cuentas</th><th className="px-2 font-medium">Reservaron</th><th className="px-2 font-medium">Pagaron</th><th className="px-2 font-medium">Polla</th></tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {(data?.funnel ?? []).map((f) => (
                  <tr key={f.rifa_id}>
                    <td className="max-w-[160px] truncate py-2 pr-2">{f.name}</td>
                    <td className="px-2 tabular-nums">{f.anonymous_views}</td>
                    <td className="px-2 tabular-nums">{f.signups}</td>
                    <td className="px-2 tabular-nums">{f.signups_reserved}</td>
                    <td className="px-2 tabular-nums">{f.signups_paid}</td>
                    <td className="px-2 tabular-nums">{f.signups_polla}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

/** Ocultar exige motivo (el creador lo ve). Campo en línea, sin prompt del navegador. */
function HideControl({ disabled, onHide }: { disabled: boolean; onHide: (reason: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) return <button type="button" disabled={disabled} onClick={() => setOpen(true)} className="lp-btn lp-btn-ghost !min-h-11 !px-4 text-[13px]">Ocultar</button>;
  return (
    <div className="space-y-2">
      <label className="block text-[13px] text-text-secondary">
        Motivo (el creador lo ve)
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className="lp-input mt-1 w-full" />
      </label>
      <div className="flex gap-2">
        <button type="button" onClick={() => { setOpen(false); setReason(""); }} className="lp-btn lp-btn-ghost flex-1 !min-h-11">Cancelar</button>
        <button type="button" disabled={disabled || reason.trim().length < 3} onClick={() => void onHide(reason)} className="lp-btn lp-btn-danger flex-1 !min-h-11">Ocultar</button>
      </div>
    </div>
  );
}
