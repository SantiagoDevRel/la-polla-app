"use client";

// components/casa/MatchPicker.tsx — selector de partidos de Casa.
//
// Compartido por /admin/pollas/crear y el editor de /admin/pollas/[id]/editar
// (2026-09-14). Maneja torneo, rango de fechas, búsqueda por equipo, semanas
// plegables y la actualización del calendario. La selección vive en el padre:
// el selector solo avisa qué partido se tocó.

import { CASA_HEADERS } from "@/lib/casa/contract";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Search, SearchX, X } from "lucide-react";
import { Label, SectionHead, StreetCard } from "@/components/street";
import { formatMatchTime } from "@/lib/casa/format";
import { CREATABLE_TOURNAMENTS, TOURNAMENT_GROUPS, getTournamentLogo, getTournamentLogoClassName } from "@/lib/tournaments";
import { TeamCrest } from "@/components/match/TeamCrest";
import { colombiaDateKey, formatColombiaDateTime } from "@/lib/time/colombia";
import {
  groupMatchesByWeek,
  matchDayKey,
  matchesTeamQuery,
  teamQueryStatus,
  weekDetail,
  weekTitle,
} from "@/lib/casa/match-weeks";

/** Ventana del calendario de selección. "todo" = temporada restante. */
type Ventana = "10" | "30" | "todo";

const VENTANAS: { v: Ventana; t: string }[] = [
  { v: "10", t: "Próximos 10 días" },
  { v: "30", t: "30 días" },
  { v: "todo", t: "Toda la temporada" },
];

function matchesUrl(tournament: string, ventana: Ventana): string {
  const query = new URLSearchParams({ tournament });
  if (ventana === "todo") query.set("todo", "1");
  else query.set("dias", ventana);
  return `/api/casa/admin/matches?${query}`;
}

function dayHeading(key: string): string {
  // Mediodía de Colombia: el mismo día calendario sin importar la zona.
  const label = formatColombiaDateTime(`${key}T12:00:00-05:00`, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function kickoffHour(iso: string): string {
  return formatColombiaDateTime(iso, { hour: "numeric", minute: "2-digit", hour12: true });
}

export interface MatchOption {
  id: string;
  home_team: string;
  away_team: string;
  home_team_flag: string | null;
  away_team_flag: string | null;
  scheduled_at: string;
  scheduled_at_confirmed?: boolean;
  /** Jornada del torneo; null en fases eliminatorias. */
  match_day?: number | null;
}

export interface PickedMatch extends MatchOption {
  tournament: string;
}

export const DEFAULT_PICKER_TOURNAMENT =
  // Champions encabeza el array pero suele estar fuera de temporada; abrir
  // el form ahi mostraba "no hay partidos" y se leia como error.
  CREATABLE_TOURNAMENTS.find((t) => t.slug === "premier_2025")?.slug ?? CREATABLE_TOURNAMENTS[0]?.slug ?? "";

export function MatchPicker({
  selected,
  onToggle,
  maxSelected,
  lockedIds,
  lockedLabel = "Ya está en la polla",
  onMatchesLoaded,
  tournamentExtra,
  title = "Partidos",
  meta,
  beforeList,
  initialTournament = DEFAULT_PICKER_TOURNAMENT,
}: {
  selected: readonly PickedMatch[];
  onToggle: (match: PickedMatch) => void;
  /** Con esta cantidad elegida, los demás partidos quedan deshabilitados. */
  maxSelected: number;
  /** Partidos que ya pertenecen a la polla: se ven marcados y no se tocan. */
  lockedIds?: ReadonlySet<string>;
  lockedLabel?: string;
  /** Cada carga de la lista visible, para refrescar horarios de los elegidos. */
  onMatchesLoaded?: (loaded: MatchOption[], tournament: string) => void;
  /** Contenido extra dentro de la tarjeta del torneo (por ejemplo, el modo de puntaje). */
  tournamentExtra?: ReactNode;
  title?: string;
  meta: string;
  /** Avisos o resumen de la selección, entre la búsqueda y la lista. */
  beforeList?: ReactNode;
  initialTournament?: string;
}) {
  const [tournament, setTournament] = useState(initialTournament);
  const selectedIds = useMemo(() => new Set(selected.map((m) => m.id)), [selected]);
  const [matches, setMatches] = useState<MatchOption[]>([]);
  const [matchesError, setMatchesError] = useState<string | null>(null);
  const [matchesRevision, setMatchesRevision] = useState(0);
  const syncController = useRef<AbortController | null>(null);
  const [cargando, setCargando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [ventana, setVentana] = useState<Ventana>("10");
  const [ventanaDias, setVentanaDias] = useState<number | null>(10);
  const [truncado, setTruncado] = useState(false);
  const [proximoPartido, setProximoPartido] = useState<{ scheduled_at: string; scheduled_at_confirmed: boolean } | null>(null);
  // El callback del padre puede cambiar en cada render; la carga no depende de él.
  const loadedCallback = useRef(onMatchesLoaded);
  useEffect(() => {
    loadedCallback.current = onMatchesLoaded;
  }, [onMatchesLoaded]);

  // Búsqueda por equipo sobre la lista cargada (torneo y rango visibles). No
  // se borra al cambiar de torneo ni de rango.
  const [busqueda, setBusqueda] = useState("");
  const busquedaRef = useRef<HTMLInputElement>(null);
  const consulta = busqueda.trim();
  const buscando = consulta.length > 0;
  // Semanas que el admin abrió o cerró a mano. Sin búsqueda todas empiezan
  // cerradas; con búsqueda, abiertas para ver los resultados sin tocar nada.
  // Se identifican por su lunes, así que una semana abierta sigue abierta al
  // cambiar de torneo o de rango.
  const [semanasTocadas, setSemanasTocadas] = useState<ReadonlySet<string>>(() => new Set());
  const partidosVisibles = useMemo(
    () => (consulta ? matches.filter((match) => matchesTeamQuery(match, consulta)) : matches),
    [matches, consulta],
  );
  // Semanas de lunes a domingo en Colombia, con la misma clave de día de los
  // encabezados. Dentro de cada día van primero los de hora confirmada, en
  // orden, y al final los de hora por confirmar.
  const hoyKey = colombiaDateKey(new Date());
  const semanas = useMemo(
    () => groupMatchesByWeek(partidosVisibles, matchDayKey, hoyKey),
    [partidosVisibles, hoyKey],
  );
  // El conteo solo existe cuando hay una lista cargada que filtrar.
  const resultadosBusqueda =
    buscando && !cargando && !matchesError && matches.length > 0 ? partidosVisibles.length : null;
  const nombreTorneo = CREATABLE_TOURNAMENTS.find((t) => t.slug === tournament)?.name ?? "este torneo";

  useEffect(() => {
    if (!tournament) return;
    const controller = new AbortController();
    setCargando(true);
    setMatches([]);
    setMatchesError(null);
    setSyncMsg(null);
    setProximoPartido(null);
    setSincronizando(false);
    setTruncado(false);
    fetch(matchesUrl(tournament, ventana), { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error("No se pudieron cargar los partidos.");
        return r.json();
      })
      .then((j) => {
        if (controller.signal.aborted) return;
        const loaded: MatchOption[] = j.matches ?? [];
        setMatches(loaded);
        setVentanaDias(j.todo ? null : (j.dias ?? 10));
        setTruncado(j.truncated === true);
        setProximoPartido(j.nextMatch ?? null);
        if (j.scheduleRefreshed === false) setSyncMsg("No pudimos actualizar los horarios. Se muestran los últimos datos guardados.");
        loadedCallback.current?.(loaded, tournament);
      })
      .catch(() => {
        if (!controller.signal.aborted) setMatchesError("No se pudieron cargar los partidos. Tu selección se conserva.");
      })
      .finally(() => { if (!controller.signal.aborted) setCargando(false); });
    return () => {
      controller.abort();
      syncController.current?.abort();
    };
  }, [tournament, ventana, matchesRevision]);

  /**
   * Pide al server que actualice el calendario del torneo elegido y vuelve a
   * pedir los partidos de la ventana visible. Es admin-only del lado del
   * server; el boton solo existe cuando la lista vino vacia.
   */
  async function actualizarCalendario() {
    const controller = new AbortController();
    syncController.current?.abort();
    syncController.current = controller;
    setSincronizando(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/admin/sync-ligas", {
        method: "POST",
        headers: CASA_HEADERS,
        body: JSON.stringify({ tournament }),
        signal: controller.signal,
      });
      const json = await res.json().catch(() => ({}));
      if (controller.signal.aborted) return;
      if (!res.ok) {
        setSyncMsg(json.error ?? "No se pudo traer el calendario.");
        return;
      }
      const r = await fetch(matchesUrl(tournament, ventana), { signal: controller.signal });
      if (!r.ok) throw new Error("No se pudieron cargar los partidos.");
      const j = await r.json().catch(() => ({}));
      if (controller.signal.aborted) return;
      const traidos = j.matches ?? [];
      setMatches(traidos);
      setVentanaDias(j.todo ? null : (j.dias ?? 10));
      setTruncado(j.truncated === true);
      setProximoPartido(j.nextMatch ?? null);
      setSyncMsg(
        traidos.length > 0
          ? `Listo: ${traidos.length} partidos.`
          : j.nextMatch
            ? null
            : "Todavía no hay partidos próximos publicados para este torneo.",
      );
    } catch {
      if (!controller.signal.aborted) setSyncMsg("Se cayó la conexión.");
    } finally {
      if (!controller.signal.aborted) setSincronizando(false);
    }
  }

  // Cada búsqueda nueva, y borrarla, devuelve las semanas a su estado
  // inicial: abiertas con resultados, cerradas sin búsqueda.
  function cambiarBusqueda(value: string) {
    if (value.trim() !== consulta) setSemanasTocadas(new Set());
    setBusqueda(value);
  }

  function borrarBusqueda() {
    setBusqueda("");
    setSemanasTocadas(new Set());
    busquedaRef.current?.focus();
  }

  // `<details>` controlado: el navegador ya cambió `open` cuando llega el
  // evento, así que solo se registra si difiere del estado inicial.
  function alternarSemana(key: string, abierta: boolean) {
    setSemanasTocadas((prev) => {
      const tocada = abierta !== buscando;
      if (prev.has(key) === tocada) return prev;
      const next = new Set(prev);
      if (tocada) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  return (
    <>
      <StreetCard className="space-y-4 p-4">
        <div>
          <Label>Torneo</Label>
          <p className="mt-1 text-[12px] text-text-secondary">
            Puedes combinar ligas. Los partidos elegidos se conservan al cambiar de torneo.
          </p>
          {TOURNAMENT_GROUPS.map((group) => (
          <div key={group.label} className="mt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">{group.label}</p>
            {/* Una columna hasta 360 px: con dos, al nombre le quedaban ~44 px
                y «Champions League» se partía en «Champion / s League». Desde
                ahí entran dos y el nombre se lee entero. */}
            <div className="mt-1.5 grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
            {group.slugs.map((slug, index) => {
              const t = CREATABLE_TOURNAMENTS.find((c) => c.slug === slug)!;
              const selectedCount = selected.filter((m) => m.tournament === t.slug).length;
              // Grupo impar: el último va a lo ancho, para que la última fila
              // se lea como decisión y no como un hueco.
              const wide = group.slugs.length % 2 === 1 && index === group.slugs.length - 1;
              return (
                <button
                  key={t.slug}
                  type="button"
                  onClick={() => setTournament(t.slug)}
                  title={t.name}
                  aria-pressed={tournament === t.slug}
                  className={`flex min-h-[64px] min-w-0 cursor-pointer items-center gap-2 rounded-md border p-2 text-left transition-all duration-200 hover:bg-bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold active:scale-[0.98] ${
                    wide ? "min-[360px]:col-span-2" : ""
                  } ${
                    tournament === t.slug
                      ? "border-gold bg-gold/10"
                      : "border-border-subtle bg-bg-elevated"
                  }`}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm">
                    {/* Pre-sized local assets avoid the image optimizer's query-string restriction. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={getTournamentLogo(t.slug, "small")}
                      alt=""
                      width={32}
                      height={32}
                      className={`h-8 w-8 max-w-none object-contain ${getTournamentLogoClassName(t.slug)}`}
                    />
                  </span>
                  {/* `break-words` y no `anywhere`: con nombres largos
                      («Champions League», «Conference League») anywhere partía
                      la palabra aunque entrara entera. Rompe dentro de una
                      palabra solo cuando sola no cabe, así que el texto
                      ampliado sigue sin desbordar. */}
                  <span className="min-w-0 break-words text-[12px] font-medium leading-snug text-text-primary">
                    {t.name}
                    {selectedCount > 0 && (
                      <span className="mt-1 block text-[11px] text-turf">
                        {selectedCount} {selectedCount === 1 ? "elegido" : "elegidos"}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
            </div>
          </div>
          ))}
        </div>
        {tournamentExtra}
      </StreetCard>

      <div>
        <SectionHead title={title} meta={meta} className="[&>div]:flex-wrap" />
        {/* Ventana del calendario. Cambiarla no toca la selección: los
            partidos elegidos viven aparte de la lista visible. En
            teléfono van 2 + "Toda la temporada" a lo ancho (decisión,
            no huérfano); desde sm, una fila de 3. */}
        <div role="group" aria-label="Rango de fechas" className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {VENTANAS.map((option) => (
            <button
              key={option.v}
              type="button"
              aria-pressed={ventana === option.v}
              onClick={() => setVentana(option.v)}
              className={`lp-btn min-w-0 px-3 text-center text-[15px] ${
                option.v === "todo" ? "col-span-2 sm:col-span-1" : ""
              } ${
                ventana === option.v ? "lp-btn-primary" : "lp-btn-ghost bg-bg-elevated"
              }`}
            >
              {option.t}
            </button>
          ))}
        </div>
        <div className="mb-3">
          <label htmlFor="buscar-equipo" className="block text-[15px] font-semibold text-text-primary">
            Buscar equipo
          </label>
          <div className="relative mt-2">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary"
            />
            {/* Se oculta la X nativa del campo de búsqueda: la propia es
                más grande y también se ve en iOS. */}
            <input
              id="buscar-equipo"
              ref={busquedaRef}
              type="search"
              value={busqueda}
              onChange={(e) => cambiarBusqueda(e.target.value)}
              placeholder="Ej.: Nacional"
              autoComplete="off"
              enterKeyHint="search"
              className="lp-input !pl-11 !pr-14 [&::-webkit-search-cancel-button]:hidden"
            />
            {busqueda && (
              <button
                type="button"
                onClick={borrarBusqueda}
                aria-label="Borrar búsqueda"
                className="absolute inset-y-0 right-1 my-auto flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-bg-card hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            )}
          </div>
          {/* Región viva siempre montada. Sin resultados, el conteo solo
              se anuncia: la tarjeta de abajo ya lo dice en pantalla. */}
          <p
            role="status"
            className={
              resultadosBusqueda
                ? "mt-2 text-[13px] leading-relaxed text-text-secondary [overflow-wrap:anywhere]"
                : "sr-only"
            }
          >
            {resultadosBusqueda === null ? "" : teamQueryStatus(resultadosBusqueda, consulta)}
          </p>
        </div>
        {beforeList}
        {cargando ? (
          <StreetCard className="p-6 text-center text-[13px] text-text-muted">
            Cargando partidos...
          </StreetCard>
        ) : matchesError ? (
          <StreetCard className="p-5 text-center">
            <p role="alert" className="text-[13px] text-text-secondary">{matchesError}</p>
            <button type="button" onClick={() => setMatchesRevision((n) => n + 1)} className="lp-btn lp-btn-ghost mt-3 w-full text-[14px]">
              Reintentar
            </button>
          </StreetCard>
        ) : matches.length === 0 ? (
          // (2026-09-02) Antes esto solo decía "no hay partidos" y se leía
          // como un error de la app. (2026-09-13) Si la liga sí está cargada
          // pero no juega en la ventana (Champions entre jornadas), se dice
          // cuándo es el próximo partido y el botón no aparece.
          <StreetCard className="p-5 text-center">
            <p className="text-[13px] text-text-secondary">
              {ventanaDias === null
                ? "No hay partidos próximos guardados de este torneo."
                : `No hay partidos de este torneo en los próximos ${ventanaDias} días.`}
            </p>
            {proximoPartido ? (
              <p className="mt-2 text-[13px] text-text-primary">
                El próximo partido es el{" "}
                {formatMatchTime(proximoPartido.scheduled_at, proximoPartido.scheduled_at_confirmed)}
              </p>
            ) : (
              <button
                type="button"
                onClick={actualizarCalendario}
                disabled={sincronizando}
                className="lp-btn lp-btn-ghost mt-3 w-full text-[15px]"
              >
                {sincronizando ? "Actualizando el calendario..." : "Actualizar calendario"}
              </button>
            )}
            {syncMsg && (
              <p className="mt-2 text-[12px] text-text-muted">{syncMsg}</p>
            )}
          </StreetCard>
        ) : partidosVisibles.length === 0 ? (
          // Hay partidos cargados, pero ninguno del equipo buscado.
          <StreetCard className="p-5 text-center">
            <SearchX aria-hidden className="mx-auto h-6 w-6 text-text-secondary" />
            <p className="mt-2 text-[15px] text-text-primary [overflow-wrap:anywhere]">
              No hay partidos de «{consulta}» en {nombreTorneo} para estas fechas.
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">
              {ventana === "todo"
                ? "Revisa el nombre del equipo o elige otro torneo."
                : "Prueba con «Toda la temporada» o elige otro torneo."}
            </p>
            <button type="button" onClick={borrarBusqueda} className="lp-btn lp-btn-ghost mt-3 w-full">
              Borrar búsqueda
            </button>
          </StreetCard>
        ) : (
          <>
            {/* Semanas plegables en vez de un scroll interno: con la
                temporada completa son cientos de filas y así se salta a
                cualquier semana sin recorrerlas. */}
            <ul className="space-y-3" aria-label="Partidos disponibles">
              {semanas.map((semana) => {
                const partidosSemana = semana.days.reduce((total, day) => total + day.list.length, 0);
                const elegidosSemana = semana.days.reduce(
                  (total, day) => total + day.list.filter((m) => selectedIds.has(m.id)).length,
                  0,
                );
                return (
                  <li key={semana.key}>
                    <details
                      open={buscando !== semanasTocadas.has(semana.key)}
                      onToggle={(event) => alternarSemana(semana.key, event.currentTarget.open)}
                      className="lp-card overflow-hidden"
                    >
                      <summary className="grid min-h-14 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3 transition-colors hover:bg-bg-elevated/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold [&::-webkit-details-marker]:hidden">
                        <h3 className="col-start-1 font-display text-[20px] font-normal uppercase leading-tight text-text-primary [overflow-wrap:anywhere]">
                          {weekTitle(semana)}
                        </h3>
                        <span className="col-start-1 mt-1 text-[13px] leading-relaxed text-text-secondary">
                          {weekDetail(semana, partidosSemana, elegidosSemana)}
                        </span>
                        {/* Variante arbitraria y no `group-open`: con las
                            dependencias actuales Tailwind descarta en
                            silencio toda clase `group-*`. */}
                        <ChevronDown
                          aria-hidden
                          className="col-start-2 row-span-2 row-start-1 h-5 w-5 text-text-secondary transition-transform duration-200 [[open]>summary>&]:rotate-180"
                        />
                      </summary>
                      <ul className="border-t border-border-default bg-bg-base/60">
                        {semana.days.map((day) => (
                          <li key={day.key}>
                            <h4 className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-border-subtle bg-bg-base/95 px-3 py-2">
                              <span className="text-[13px] font-semibold text-text-primary">{dayHeading(day.key)}</span>
                              <span className="text-[13px] text-text-muted">
                                {day.list.length} {day.list.length === 1 ? "partido" : "partidos"}
                              </span>
                            </h4>
                            <ul className="space-y-px">
                              {day.list.map((m) => {
                                const locked = lockedIds?.has(m.id) ?? false;
                                const on = locked || selectedIds.has(m.id);
                                const provisional = m.scheduled_at_confirmed === false;
                                const hora = provisional ? "hora por confirmar" : kickoffHour(m.scheduled_at);
                                const jornada = m.match_day ?? null;
                                return (
                                  <li key={m.id}>
                                    <button
                                      type="button"
                                      onClick={() => onToggle({ ...m, tournament })}
                                      disabled={locked || (!on && selected.length >= maxSelected)}
                                      aria-label={`${m.home_team} vs ${m.away_team}, ${hora}${jornada === null ? "" : `, jornada ${jornada}`}${locked ? `, ${lockedLabel.toLowerCase()}` : ""}`}
                                      aria-pressed={on}
                                      className={`flex min-h-[44px] w-full cursor-pointer items-center gap-3 p-3 text-left transition-colors hover:bg-bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold disabled:cursor-not-allowed ${
                                        locked ? "" : "disabled:opacity-50"
                                      } ${on ? "bg-gold/10" : "bg-bg-card"}`}
                                    >
                                      <span
                                        className={`h-4 w-4 shrink-0 border-2 ${
                                          on ? "border-gold bg-gold" : "border-border-strong"
                                        }`}
                                        aria-hidden
                                      />
                                      <span className="min-w-0 flex-1">
                                        <span className="grid grid-cols-2 gap-3 text-[13px] text-text-primary">
                                          <span className="min-w-0">
                                            <TeamCrest team={m.home_team} src={m.home_team_flag} />
                                            <span className="mt-1 block [overflow-wrap:anywhere]">{m.home_team}</span>
                                          </span>
                                          <span className="min-w-0 text-right">
                                            <TeamCrest team={m.away_team} src={m.away_team_flag} />
                                            <span className="mt-1 block [overflow-wrap:anywhere]">{m.away_team}</span>
                                          </span>
                                        </span>
                                        <span className="mt-1 block text-[13px] text-text-secondary">
                                          {provisional ? (
                                            <span className="font-semibold text-amber">Hora por confirmar</span>
                                          ) : (
                                            <span className="tabular-nums">{hora}</span>
                                          )}
                                          {jornada !== null && <>&nbsp;· Jornada&nbsp;{jornada}</>}
                                          {locked && <span className="block font-semibold text-turf">{lockedLabel}</span>}
                                        </span>
                                      </span>
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                );
              })}
            </ul>
            {truncado && (
              <p className="mt-2 text-[13px] text-text-muted">Se muestran los primeros 1.000 partidos por fecha.</p>
            )}
          </>
        )}
      </div>
    </>
  );
}
