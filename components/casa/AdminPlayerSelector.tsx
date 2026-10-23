"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, UsersRound } from "lucide-react";
import { CASA_HEADERS } from "@/lib/casa/contract";
import { getPollitoBase, POLLITO_TYPES } from "@/lib/pollitos";

interface Player {
  id: string;
  name: string;
  avatar: string;
  selected: boolean;
  ticket: number | null;
  revision: number;
  conflict: boolean;
}
interface Selection { players: Player[]; editable: boolean }

export function AdminPlayerSelector({ pollaId, viewedPlayerId }: { pollaId: string; viewedPlayerId?: string }) {
  const router = useRouter();
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Selection | null>(null);
  const [loading, setLoading] = useState(false);
  const [synced, setSynced] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const endpoint = `/api/casa/admin/pollas/${pollaId}/jugadores`;

  useEffect(() => {
    mounted.current = true;
    setHydrated(true);
    return () => { mounted.current = false; };
  }, []);

  async function load() {
    setLoading(true);
    setSynced(false);
    setError(null);
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(15000) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo cargar la lista.");
      if (!Array.isArray(body.players) || typeof body.editable !== "boolean") throw new Error("No se pudo confirmar la lista. Actualízala antes de continuar.");
      if (mounted.current) {
        setData(body);
        setSynced(true);
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "No se pudo cargar la lista.");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }

  function toggle() {
    setOpen(!open);
    if (!open) void load();
  }

  async function select(player: Player) {
    if (busy.current || !data?.editable || player.conflict) return;
    busy.current = true;
    setSaving(player.id);
    setError(null);
    setNotice("");
    try {
      const response = await fetch(endpoint, {
        method: "PATCH", headers: CASA_HEADERS, signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ userId: player.id, selected: !player.selected, revision: player.revision }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo guardar la selección.");
      if (!Array.isArray(body.players) || typeof body.editable !== "boolean") throw new Error("No se pudo confirmar la selección. Verifica el estado antes de reintentar.");
      if (mounted.current) {
        setData(body);
        setNotice(player.selected ? `${player.name}: retirado de esta polla.` : `${player.name}: inscripción pagada registrada.`);
        router.refresh();
      }
    } catch (cause) {
      // A lost response may follow a committed write. Read authoritative state
      // before permitting another click; never undo locally or retry a write.
      await load();
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Se perdió la conexión. Verifica la selección antes de reintentar.");
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(null);
    }
  }

  const selected = data?.players.filter((player) => player.selected).length;

  return (
    <section
      aria-label="Jugadores administrados"
      data-app-update-blocked={saving !== null || loading ? "true" : undefined}
      className="mx-4 mb-4 rounded-lg border border-border-subtle bg-bg-card/80 backdrop-blur-sm transition-colors duration-200 hover:border-border-medium"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger} type="button" aria-expanded={open} aria-controls={panelId} onClick={toggle} disabled={!hydrated || saving !== null}
        className="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-lg px-4 py-3 text-left text-[15px] font-semibold text-text-primary transition-colors duration-200 hover:bg-bg-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-turf active:bg-bg-elevated"
      >
        <UsersRound aria-hidden="true" className="h-5 w-5 shrink-0 text-text-secondary" />
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          Jugadores de la casa
          <span className="mt-0.5 block text-[13px] font-normal text-text-secondary">
            Solo administradores{selected !== undefined ? ` · ${selected} de ${data?.players.length} inscritos` : ""}
          </span>
        </span>
        <ChevronDown aria-hidden="true" className={`h-5 w-5 shrink-0 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
      </button>
      <div id={panelId} hidden={!open} className="border-t border-border-subtle p-3">
        <p className="px-1 text-[13px] leading-relaxed text-text-secondary">
          Marca para registrar una entrada pagada, con derecho a premio. Desmarca para retirar al jugador de esta polla.
        </p>
        {data && !data.editable && <p className="mt-2 px-1 text-[13px] text-text-secondary">Las inscripciones no están abiertas. Puedes consultar la selección.</p>}
        {error && <p role="alert" className="mt-3 px-1 text-[13px] text-red-alert">{error}</p>}
        {loading ? (
          <div role="status" aria-label="Cargando jugadores" className="mt-3 space-y-2">
            {[0, 1, 2].map((key) => <div key={key} className="h-16 animate-pulse rounded-md bg-bg-elevated motion-reduce:animate-none" />)}
          </div>
        ) : data?.players.length ? (
          <fieldset disabled={saving !== null || !data.editable || !synced} className="mt-3 max-h-[55dvh] space-y-1 overflow-y-auto overscroll-contain pr-1">
            <legend className="sr-only">Selecciona los jugadores de esta polla</legend>
            {data.players.map((player) => (
              <div key={player.id} className="rounded-md px-2 py-2 transition-colors duration-200 hover:bg-bg-elevated focus-within:bg-bg-elevated">
              <label className="flex min-h-16 cursor-pointer items-center gap-3">
                <input
                  type="checkbox" checked={player.selected} disabled={player.conflict || loading}
                  onChange={() => void select(player)} aria-label={`Inscribir a ${player.name}`}
                  className="h-6 w-6 shrink-0 cursor-pointer accent-turf focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-turf disabled:cursor-not-allowed"
                />
                {/* Local assets are already sized; avoid Image Optimization. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={getPollitoBase(player.avatar)} alt="" width={40} height={40} loading="lazy" className="h-10 w-10 max-w-none shrink-0 object-contain" />
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  <span className="block text-[15px] font-medium text-text-primary">{player.name}</span>
                  <span className="block text-[13px] text-text-secondary">
                    {saving === player.id ? "Guardando…" : player.conflict ? "Inscripción gestionada fuera de este selector" : POLLITO_TYPES.find((pollito) => pollito.id === player.avatar)?.label}
                    {player.ticket !== null ? ` · Boleta ${player.ticket}` : ""}
                  </span>
                </span>
              </label>
              <Link href={`/admin/pollas/${pollaId}/jugadores/${player.id}`} aria-label={`Ver a ${player.name}`}
                aria-current={viewedPlayerId === player.id ? "page" : undefined}
                className="ml-9 inline-flex min-h-11 items-center rounded-full px-3 text-[13px] font-medium text-text-primary underline decoration-border-medium underline-offset-4 transition-colors duration-200 hover:bg-bg-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-turf">
                {viewedPlayerId === player.id ? "Vista actual" : "Ver jugador"}
              </Link>
              </div>
            ))}
          </fieldset>
        ) : !error && <p className="mt-3 px-1 text-[13px] text-text-secondary">No hay jugadores configurados.</p>}
        {error && !loading && <button type="button" disabled={saving !== null} onClick={() => void load()} className="lp-btn lp-btn-ghost mt-2 min-h-11">Actualizar lista</button>}
        <p role="status" aria-live="polite" className="mt-2 px-1 text-[13px] text-turf">{notice}</p>
      </div>
    </section>
  );
}
