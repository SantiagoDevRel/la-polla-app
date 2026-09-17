"use client";

// components/admin/CortesiasAdmin.tsx — dar cortesías desde el panel (migración 138).
//
// El recorrido es el del pedido del dueño: busco a la persona, elijo la polla,
// elijo cuántas cortesías y listo. Debajo queda la lista de lo dado, con el
// estado de cada enlace (sin usar, quién la usó, vencida).

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Search, Ticket, X } from "lucide-react";
import { HeroFrame, Label, SectionHead, Tape } from "@/components/street";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { CASA_HEADERS } from "@/lib/casa/contract";
import { formatCop } from "@/lib/casa/format";
import { courtesyLabel, type AdminCourtesy } from "@/lib/casa/courtesies-shared";
import { formatPhone } from "@/lib/format-phone";

/** Polla que admite cortesías: publicada, abierta, con entrada y sin boletas. */
export interface CortesiaPolla {
  id: string;
  name: string;
  entry_price_cop: number;
  closes_at: string;
}

interface Persona {
  id: string;
  display_name: string;
  whatsapp_number: string | null;
}

const CANTIDADES = [1, 2, 3, 4, 5];

export function CortesiasAdmin({ pollas }: { pollas: CortesiaPolla[] }) {
  const { showToast } = useToast();
  const [query, setQuery] = useState("");
  const [resultados, setResultados] = useState<Persona[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [persona, setPersona] = useState<Persona | null>(null);
  const [pollaId, setPollaId] = useState(pollas[0]?.id ?? "");
  const [cantidad, setCantidad] = useState(1);
  const [guardando, setGuardando] = useState(false);

  const [cortesias, setCortesias] = useState<AdminCourtesy[] | null>(null);
  const [listaError, setListaError] = useState(false);
  const [retirando, setRetirando] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setListaError(false);
    try {
      const response = await fetch("/api/casa/admin/cortesias", { cache: "no-store" });
      if (!response.ok) throw new Error("no se pudo leer la lista");
      const data = await response.json();
      setCortesias(data.cortesias ?? []);
    } catch {
      setListaError(true);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  // Búsqueda de personas: el mismo directorio del panel, con el término en un
  // header para que ningún teléfono quede en la URL ni en los access logs.
  useEffect(() => {
    const termino = query.trim();
    if (!termino) { setResultados(null); setBuscando(false); return; }
    const controller = new AbortController();
    setBuscando(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/admin/promote?directory=1&page=0", {
          cache: "no-store",
          headers: { "X-User-Search": encodeURIComponent(termino) },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("no se pudo buscar");
        const data = await response.json();
        if (!controller.signal.aborted) setResultados(data.usuarios ?? []);
      } catch {
        if (!controller.signal.aborted) setResultados([]);
      } finally {
        if (!controller.signal.aborted) setBuscando(false);
      }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);

  async function dar() {
    if (!persona || !pollaId) return;
    setGuardando(true);
    try {
      const response = await fetch("/api/casa/admin/cortesias", {
        method: "POST",
        headers: CASA_HEADERS,
        body: JSON.stringify({ accion: "dar", pollaId, userId: persona.id, cantidad }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(data.error ?? "No se pudieron dar las cortesías.", "error");
        return;
      }
      const nombre = persona.display_name || "La persona";
      showToast(
        cantidad === 1
          ? `${nombre} ya tiene 1 cortesía para regalar.`
          : `${nombre} ya tiene ${cantidad} cortesías para regalar.`,
        "success",
      );
      setPersona(null);
      setQuery("");
      setCantidad(1);
      await cargar();
    } catch {
      showToast("Se cayó la conexión. Intenta otra vez.", "error");
    } finally {
      setGuardando(false);
    }
  }

  // Quitar una cortesía YA USADA saca a esa persona de la polla (migración
  // 137), así que esa pide un clic de confirmación. La que nadie ha usado no:
  // no le quita nada a nadie.
  async function retirar(cortesia: AdminCourtesy) {
    if (cortesia.status === "redimida" && confirmar !== cortesia.id) {
      setConfirmar(cortesia.id);
      return;
    }
    setConfirmar(null);
    setRetirando(cortesia.id);
    try {
      const response = await fetch("/api/casa/admin/cortesias", {
        method: "POST",
        headers: CASA_HEADERS,
        body: JSON.stringify({ accion: "retirar", cortesiaId: cortesia.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(data.error ?? "No se pudo retirar la cortesía.", "error");
        return;
      }
      showToast(
        cortesia.status === "redimida"
          ? `Cupo retirado: ${cortesia.redeemed_name || "esa persona"} sale de la polla.`
          : "Cortesía retirada.",
        "success",
      );
      await cargar();
    } catch {
      showToast("Se cayó la conexión. Intenta otra vez.", "error");
    } finally {
      setRetirando(null);
    }
  }

  const polla = pollas.find((p) => p.id === pollaId) ?? null;
  const sinPollas = pollas.length === 0;

  return (
    <div className="pb-28">
      <HeroFrame height="min-h-[170px]">
        <Link href="/admin" className="mb-3 inline-flex min-h-11 items-center gap-2 self-start text-[13px] text-text-secondary transition-colors hover:text-text-primary">
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" /> Administración
        </Link>
        <Label>Panel</Label>
        <h1 className="lp-display mt-1 text-[34px]">Cortesías</h1>
      </HeroFrame>

      <div className="px-4 pt-5">
        <p className="mb-5 text-[15px] leading-relaxed text-text-secondary">
          Le das cupos gratis a una persona para que los regale. Cada cortesía es un enlace
          distinto que solo sirve una vez.
        </p>
        <p className="mb-6 text-[13px] leading-snug text-text-muted">
          *Solo las redime quien nunca ha tenido cuenta en La Polla, una vez por persona y
          solo en la polla que elijas. Si nadie la usa antes del cierre, vence con la polla.
        </p>

        {sinPollas ? (
          <div className="lp-card p-4">
            <p className="text-[15px] text-text-primary">No hay pollas para dar cortesías</p>
            <p className="mt-1 text-[13px] leading-snug text-text-secondary">
              Solo se pueden dar en una polla publicada, con inscripciones abiertas y con entrada
              en dinero. Las rifas se juegan con boletas.
            </p>
            <Link href="/admin/pollas" className="lp-btn lp-btn-ghost mt-4 w-full">Administrar pollas</Link>
          </div>
        ) : (
          <div className="lp-card p-4">
            <SectionHead title="Dar cortesías" />

            <label htmlFor="buscar-persona" className="lp-label mb-2 block">1. ¿A quién?</label>
            {persona ? (
              <div className="flex items-center gap-3 rounded-md border border-border-default bg-bg-elevated p-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] text-text-primary [overflow-wrap:anywhere]">{persona.display_name || "Sin nombre"}</span>
                  <span className="mt-0.5 block text-[13px] tabular-nums text-text-secondary">{formatPhone(persona.whatsapp_number) || "Sin teléfono"}</span>
                </span>
                <button
                  type="button"
                  onClick={() => { setPersona(null); setQuery(""); }}
                  aria-label={`Elegir otra persona en vez de ${persona.display_name || "esta"}`}
                  className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-bg-card-hover hover:text-text-primary"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
                  <input
                    id="buscar-persona"
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Nombre o teléfono"
                    autoComplete="off"
                    className="lp-input !pl-11"
                  />
                </div>
                {buscando && <p role="status" className="mt-2 text-[13px] text-text-secondary">Buscando...</p>}
                {!buscando && resultados !== null && resultados.length === 0 && (
                  <p className="mt-2 text-[13px] text-text-secondary">No encontramos a nadie con ese nombre o teléfono.</p>
                )}
                {!buscando && resultados !== null && resultados.length > 0 && (
                  <ul className="mt-2 max-h-72 divide-y divide-border-subtle overflow-y-auto overscroll-contain rounded-md border border-border-default">
                    {resultados.map((encontrada) => (
                      <li key={encontrada.id}>
                        <button
                          type="button"
                          onClick={() => setPersona(encontrada)}
                          className="flex w-full cursor-pointer items-center gap-3 p-3 text-left transition-colors hover:bg-bg-elevated"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block text-[15px] text-text-primary [overflow-wrap:anywhere]">{encontrada.display_name || "Sin nombre"}</span>
                            <span className="mt-0.5 block text-[13px] tabular-nums text-text-secondary">{formatPhone(encontrada.whatsapp_number) || "Sin teléfono"}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            <label htmlFor="polla-cortesia" className="lp-label mb-2 mt-6 block">2. ¿En qué polla?</label>
            <select
              id="polla-cortesia"
              value={pollaId}
              onChange={(event) => setPollaId(event.target.value)}
              className="lp-input"
            >
              {pollas.map((opcion) => (
                <option key={opcion.id} value={opcion.id}>{opcion.name}</option>
              ))}
            </select>
            {polla && (
              <p className="mt-2 text-[13px] text-text-secondary">
                Entrada {formatCop(polla.entry_price_cop)}. Cada cortesía vale una entrada.
              </p>
            )}

            <span id="cantidad-cortesias" className="lp-label mb-2 mt-6 block">3. ¿Cuántas cortesías?</span>
            <div role="group" aria-labelledby="cantidad-cortesias" className="flex flex-wrap gap-2">
              {CANTIDADES.map((numero) => (
                <button
                  key={numero}
                  type="button"
                  onClick={() => setCantidad(numero)}
                  aria-pressed={cantidad === numero}
                  className={`lp-btn min-w-[56px] flex-1 ${cantidad === numero ? "lp-btn-primary" : "lp-btn-ghost"}`}
                >
                  {numero}
                </button>
              ))}
            </div>
            <label htmlFor="cantidad-otra" className="mt-3 flex flex-wrap items-center gap-3 text-[13px] text-text-secondary">
              <span className="shrink-0">Otra cantidad (hasta 20)</span>
              <input
                id="cantidad-otra"
                type="number"
                min={1}
                max={20}
                value={cantidad}
                onChange={(event) => {
                  const valor = Number(event.target.value);
                  if (Number.isFinite(valor)) setCantidad(Math.min(20, Math.max(1, Math.trunc(valor))));
                }}
                className="lp-input w-24 tabular-nums"
              />
            </label>

            <button
              type="button"
              onClick={dar}
              disabled={!persona || !pollaId || guardando}
              className="lp-btn lp-btn-primary mt-6 w-full"
            >
              {guardando ? "Dando..." : persona
                ? `Dar ${cantidad} ${cantidad === 1 ? "cortesía" : "cortesías"} a ${persona.display_name || "esta persona"}`
                : "Elige a quién le das las cortesías"}
            </button>
          </div>
        )}

        <SectionHead className="mt-9" title="Cortesías dadas" meta={cortesias ? `${cortesias.length}` : undefined} />
        {listaError && (
          <div role="alert" className="mb-3 rounded-md bg-bg-card p-4 text-[13px] text-text-secondary">
            <p>No se pudo cargar la lista de cortesías.</p>
            <button type="button" onClick={() => void cargar()} className="lp-btn lp-btn-ghost mt-2 text-[13px]">Reintentar</button>
          </div>
        )}
        {cortesias === null && !listaError && (
          <div role="status" className="space-y-3">
            <span className="sr-only">Cargando cortesías...</span>
            {[0, 1, 2].map((fila) => <Skeleton key={fila} className="h-16 w-full" aria-hidden="true" />)}
          </div>
        )}
        {cortesias !== null && cortesias.length === 0 && !listaError && (
          <div className="lp-card p-5 text-center">
            <Ticket className="mx-auto h-6 w-6 text-text-secondary" aria-hidden="true" />
            <p className="lp-display-sm mt-2">Todavía no has dado cortesías</p>
            <p className="mt-1 text-[13px] text-text-secondary">Las que des aparecen aquí con su estado.</p>
          </div>
        )}
        {cortesias !== null && cortesias.length > 0 && (
          <ul className="space-y-px">
            {cortesias.map((cortesia) => {
              const estado = courtesyLabel(cortesia);
              return (
                <li key={cortesia.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 bg-bg-card p-4">
                  <span className="min-w-0 grow basis-40">
                    <span className="block text-[15px] text-text-primary [overflow-wrap:anywhere]">{cortesia.holder_name || "Sin nombre"}</span>
                    <span className="mt-0.5 block text-[13px] text-text-secondary [overflow-wrap:anywhere]">{cortesia.polla}</span>
                    <span className="mt-1 block font-mono text-[13px] tracking-[0.08em] text-text-muted">{cortesia.code}</span>
                  </span>
                  <span className="flex shrink-0 flex-wrap items-center gap-2">
                    <Tape tone={estado.tone}>{estado.text}</Tape>
                    {/* Con la polla repartida o anulada ya no se puede: SQL lo
                        rechaza y mostrar el botón sería prometer de más. */}
                    {(cortesia.status === "disponible" || cortesia.status === "redimida")
                      && (cortesia.polla_status === "abierta" || cortesia.polla_status === "cerrada") && (
                      <button
                        type="button"
                        onClick={() => retirar(cortesia)}
                        disabled={retirando !== null}
                        className="lp-btn lp-btn-ghost !px-3 !text-[13px]"
                      >
                        {retirando === cortesia.id
                          ? "Retirando..."
                          : confirmar === cortesia.id
                            ? "Confirmar"
                            : cortesia.status === "redimida" ? "Quitar el cupo" : "Retirar"}
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default CortesiasAdmin;
