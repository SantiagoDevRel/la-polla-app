"use client";

// components/casa/CrearPollaForm.tsx — el flujo de Tama.
//
// Tres tipos de polla en un solo formulario, porque son el mismo gesto con
// distinto contenido:
//   partidos → elegís torneo, elegís los partidos del finde, elegís si se
//              juega por 1X2 o por marcador.
//   manual   → escribís vos las preguntas y sus opciones ("primer goleador").
//   rifa     → cuántas boletas, cuánto vale, y cómo se sortea.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Label, SectionHead, StreetCard, Tape } from "@/components/street";
import { formatCop, formatMatchTime } from "@/lib/casa/format";
import { CREATABLE_TOURNAMENTS, getTournamentLogo } from "@/lib/tournaments";

type Kind = "partidos" | "manual" | "rifa";

interface MatchOption {
  id: string;
  home_team: string;
  away_team: string;
  home_team_flag: string | null;
  away_team_flag: string | null;
  scheduled_at: string;
}

interface Pregunta {
  prompt: string;
  points: number;
  inputKind: "opciones" | "texto";
  options: string[];
}

/** Por defecto la polla cierra el sábado que viene a las 12:00 (Bogotá). */
function proximoCierre(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  d.setHours(12, 0, 0, 0);
  return toLocalInput(d);
}
function toLocalInput(d: Date): string {
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

export function CrearPollaForm() {
  const router = useRouter();

  const [kind, setKind] = useState<Kind>("partidos");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [precio, setPrecio] = useState(10000);
  const [houseCut, setHouseCut] = useState(30);
  const [closesAt, setClosesAt] = useState(proximoCierre);
  const [premioObjeto, setPremioObjeto] = useState("");

  // partidos
  const [tournament, setTournament] = useState(
    // Champions encabeza el array pero suele estar fuera de temporada; abrir
    // el form ahi mostraba "no hay partidos" y se leia como error.
    CREATABLE_TOURNAMENTS.find((t) => t.slug === "premier_2025")?.slug ??
      CREATABLE_TOURNAMENTS[0]?.slug ??
      "",
  );
  const [scoringMode, setScoringMode] = useState<"1x2" | "marcador">("1x2");
  const [matches, setMatches] = useState<MatchOption[]>([]);
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [cargando, setCargando] = useState(false);

  // manual
  const [preguntas, setPreguntas] = useState<Pregunta[]>([
    { prompt: "", points: 3, inputKind: "opciones", options: ["", ""] },
  ]);

  // rifa
  const [boletas, setBoletas] = useState(100);
  const [metodoSorteo, setMetodoSorteo] = useState(
    "Los dos últimos números del premio mayor de la Lotería de Medellín del sábado.",
  );

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== "partidos" || !tournament) return;
    setCargando(true);
    setSeleccion([]);
    fetch(`/api/casa/admin/matches?tournament=${tournament}`)
      .then((r) => r.json())
      .then((j) => setMatches(j.matches ?? []))
      .catch(() => setMatches([]))
      .finally(() => setCargando(false));
  }, [kind, tournament]);

  function toggleMatch(id: string) {
    setSeleccion((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function setPregunta(i: number, patch: Partial<Pregunta>) {
    setPreguntas((prev) => prev.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  }

  async function crear(publicar: boolean) {
    setError(null);
    if (name.trim().length < 3) return setError("Ponle un nombre a la polla.");
    if (kind === "partidos" && seleccion.length === 0)
      return setError("Elige al menos un partido.");
    if (kind === "manual" && preguntas.every((q) => !q.prompt.trim()))
      return setError("Escribe al menos una pregunta.");

    setGuardando(true);
    try {
      const base = {
        name: name.trim(),
        description: description.trim() || undefined,
        entryPriceCop: precio,
        houseCutPct: houseCut,
        closesAt: new Date(closesAt).toISOString(),
        prizeObject: premioObjeto.trim() || undefined,
        publish: publicar,
      };

      const body =
        kind === "partidos"
          ? { ...base, kind, tournament, scoringMode, matchIds: seleccion }
          : kind === "manual"
            ? {
                ...base,
                kind,
                questions: preguntas
                  .filter((q) => q.prompt.trim())
                  .map((q) => ({
                    prompt: q.prompt.trim(),
                    points: q.points,
                    inputKind: q.inputKind,
                    options: q.options.map((o) => o.trim()).filter(Boolean),
                  })),
              }
            : { ...base, kind, ticketCount: boletas, drawMethod: metodoSorteo.trim() };

      const res = await fetch("/api/casa/admin/pollas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) return setError(json.error ?? "No pude crear la polla.");

      router.push(`/casa/${json.slug}`);
      router.refresh();
    } catch {
      setError("Se cayó la conexión.");
    } finally {
      setGuardando(false);
    }
  }

  const alPozo = Math.floor((precio * (100 - houseCut)) / 100);

  return (
    <div className="space-y-5">
      {/* ── Tipo ────────────────────────────────────────────────────────── */}
      <div>
        <Label>Tipo de polla</Label>
        <div className="mt-2 grid grid-cols-3 gap-px">
          {(
            [
              ["partidos", "Partidos"],
              ["manual", "Manual"],
              ["rifa", "Rifa"],
            ] as [Kind, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`lp-btn text-[13px] ${
                kind === k ? "lp-btn-primary" : "lp-btn-ghost bg-bg-elevated"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Datos comunes ───────────────────────────────────────────────── */}
      <StreetCard className="space-y-4 p-4">
        <div>
          <Label>Nombre</Label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Fecha 5 · Premier"
            className="lp-input mt-2"
          />
        </div>

        <div>
          <Label>Descripción (opcional)</Label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Los 8 del sábado. Solo local, empate o visitante."
            className="lp-input mt-2"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Entrada (COP)</Label>
            <input
              type="number"
              min={0}
              step={1000}
              value={precio}
              onChange={(e) => setPrecio(Number(e.target.value))}
              className="lp-input lp-money mt-2 text-[18px]"
            />
          </div>
          <div>
            <Label>Se queda la casa</Label>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={100}
                value={houseCut}
                onChange={(e) => setHouseCut(Number(e.target.value))}
                className="lp-input lp-money text-[18px]"
              />
              <span className="lp-money shrink-0 text-[18px] text-text-muted">%</span>
            </div>
          </div>
        </div>

        {/* La cuenta, en vivo. Que Tama vea el reparto antes de publicar. */}
        <p className="border-t border-border-subtle pt-3 text-[12px] text-text-muted">
          Por cada persona que entre: <b className="text-text-primary">{formatCop(alPozo)}</b> al
          pozo y <b className="text-text-primary">{formatCop(precio - alPozo)}</b> a la casa.
        </p>

        <div>
          <Label>Cierra</Label>
          <input
            type="datetime-local"
            value={closesAt}
            onChange={(e) => setClosesAt(e.target.value)}
            className="lp-input mt-2"
          />
        </div>

        <div>
          <Label>Premio en objeto (opcional)</Label>
          <input
            value={premioObjeto}
            onChange={(e) => setPremioObjeto(e.target.value)}
            placeholder="Camiseta del Nacional"
            className="lp-input mt-2"
          />
        </div>
      </StreetCard>

      {/* ── Partidos ────────────────────────────────────────────────────── */}
      {kind === "partidos" && (
        <>
          <StreetCard className="space-y-4 p-4">
            <div>
              <Label>Torneo</Label>
              <div className="mt-2 grid grid-cols-4 gap-px">
                {CREATABLE_TOURNAMENTS.map((t) => (
                  <button
                    key={t.slug}
                    type="button"
                    onClick={() => setTournament(t.slug)}
                    title={t.name}
                    className={`flex h-[52px] items-center justify-center border ${
                      tournament === t.slug
                        ? "border-gold bg-gold/10"
                        : "border-border-subtle bg-bg-elevated"
                    }`}
                  >
                    <Image
                      src={getTournamentLogo(t.slug)}
                      alt={t.name}
                      width={26}
                      height={26}
                      className="h-[26px] w-[26px] max-w-none object-contain"
                    />
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label>Cómo se puntúa</Label>
              <div className="mt-2 grid grid-cols-2 gap-px">
                <button
                  type="button"
                  onClick={() => setScoringMode("1x2")}
                  className={`lp-btn text-[12px] ${
                    scoringMode === "1x2" ? "lp-btn-primary" : "lp-btn-ghost bg-bg-elevated"
                  }`}
                >
                  1X2 · 3 pts
                </button>
                <button
                  type="button"
                  onClick={() => setScoringMode("marcador")}
                  className={`lp-btn text-[12px] ${
                    scoringMode === "marcador"
                      ? "lp-btn-primary"
                      : "lp-btn-ghost bg-bg-elevated"
                  }`}
                >
                  Marcador · 3/1
                </button>
              </div>
              <p className="mt-2 text-[11px] text-text-muted">
                {scoringMode === "1x2"
                  ? "Local, empate o visitante. Solo esas 3 opciones, 3 puntos el acierto."
                  : "Marcador exacto vale 3. Acertarle a los goles de un solo equipo vale 1."}
              </p>
            </div>
          </StreetCard>

          <div>
            <SectionHead
              title="Partidos"
              meta={seleccion.length > 0 ? `${seleccion.length} elegidos` : undefined}
            />
            {cargando ? (
              <StreetCard className="p-6 text-center text-[13px] text-text-muted">
                Buscando partidos...
              </StreetCard>
            ) : matches.length === 0 ? (
              <StreetCard className="p-6 text-center text-[13px] text-text-muted">
                No hay partidos programados en los próximos 10 días para ese torneo.
              </StreetCard>
            ) : (
              <ul className="max-h-[420px] space-y-px overflow-y-auto">
                {matches.map((m) => {
                  const on = seleccion.includes(m.id);
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => toggleMatch(m.id)}
                        className={`flex w-full items-center gap-3 p-3 text-left ${
                          on ? "bg-gold/10" : "bg-bg-card"
                        }`}
                      >
                        <span
                          className={`h-4 w-4 shrink-0 border-2 ${
                            on ? "border-gold bg-gold" : "border-border-strong"
                          }`}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-text-primary">
                            {m.home_team} vs {m.away_team}
                          </span>
                          <span className="lp-label mt-0.5 block">
                            {formatMatchTime(m.scheduled_at)}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}

      {/* ── Manual ──────────────────────────────────────────────────────── */}
      {kind === "manual" && (
        <div>
          <SectionHead title="Preguntas" meta={`${preguntas.length}`} />
          <div className="space-y-3">
            {preguntas.map((q, i) => (
              <StreetCard key={i} className="space-y-3 p-4">
                <div className="flex items-start gap-2">
                  <input
                    value={q.prompt}
                    onChange={(e) => setPregunta(i, { prompt: e.target.value })}
                    placeholder="¿Quién mete el primer gol?"
                    className="lp-input"
                  />
                  {preguntas.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setPreguntas((p) => p.filter((_, j) => j !== i))
                      }
                      aria-label="Quitar pregunta"
                      className="lp-btn lp-btn-ghost h-[48px] w-[48px] shrink-0 p-0 text-[18px]"
                    >
                      ×
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Puntos</Label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={q.points}
                      onChange={(e) =>
                        setPregunta(i, { points: Number(e.target.value) })
                      }
                      className="lp-input lp-money mt-2"
                    />
                  </div>
                  <div>
                    <Label>Respuesta</Label>
                    <div className="mt-2 grid grid-cols-2 gap-px">
                      <button
                        type="button"
                        onClick={() => setPregunta(i, { inputKind: "opciones" })}
                        className={`lp-btn text-[11px] ${
                          q.inputKind === "opciones"
                            ? "lp-btn-primary"
                            : "lp-btn-ghost bg-bg-elevated"
                        }`}
                      >
                        Opciones
                      </button>
                      <button
                        type="button"
                        onClick={() => setPregunta(i, { inputKind: "texto" })}
                        className={`lp-btn text-[11px] ${
                          q.inputKind === "texto"
                            ? "lp-btn-primary"
                            : "lp-btn-ghost bg-bg-elevated"
                        }`}
                      >
                        Libre
                      </button>
                    </div>
                  </div>
                </div>

                {q.inputKind === "opciones" && (
                  <div>
                    <Label>Opciones que puede elegir la gente</Label>
                    <div className="mt-2 space-y-px">
                      {q.options.map((op, j) => (
                        <input
                          key={j}
                          value={op}
                          onChange={(e) =>
                            setPregunta(i, {
                              options: q.options.map((o, k) =>
                                k === j ? e.target.value : o,
                              ),
                            })
                          }
                          placeholder={`Opción ${j + 1}`}
                          className="lp-input"
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setPregunta(i, { options: [...q.options, ""] })
                      }
                      className="lp-btn lp-btn-ghost mt-2 w-full text-[12px]"
                    >
                      + Otra opción
                    </button>
                  </div>
                )}
              </StreetCard>
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              setPreguntas((p) => [
                ...p,
                { prompt: "", points: 3, inputKind: "opciones", options: ["", ""] },
              ])
            }
            className="lp-btn lp-btn-ghost mt-3 w-full"
          >
            + Otra pregunta
          </button>
        </div>
      )}

      {/* ── Rifa ────────────────────────────────────────────────────────── */}
      {kind === "rifa" && (
        <StreetCard className="space-y-4 p-4">
          <div>
            <Label>Cuántas boletas</Label>
            <input
              type="number"
              min={2}
              max={1000}
              value={boletas}
              onChange={(e) => setBoletas(Number(e.target.value))}
              className="lp-input lp-money mt-2 text-[18px]"
            />
            <p className="mt-2 text-[11px] text-text-muted">
              Si se venden todas: <b className="text-text-primary">{formatCop(boletas * alPozo)}</b> de
              premio.
            </p>
          </div>
          <div>
            <Label>Cómo se define el ganador</Label>
            <textarea
              value={metodoSorteo}
              onChange={(e) => setMetodoSorteo(e.target.value)}
              rows={3}
              className="lp-input mt-2 min-h-[84px] resize-none py-3"
            />
            <p className="mt-2 text-[11px] text-text-muted">
              Escríbelo clarito: es lo que la gente va a leer antes de pagar.
            </p>
          </div>
        </StreetCard>
      )}

      {error && (
        <p className="border border-red-alert/40 bg-red-alert/10 p-3 text-center text-[12px] text-red-alert">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-px">
        <button
          type="button"
          onClick={() => crear(false)}
          disabled={guardando}
          className="lp-btn lp-btn-ghost"
        >
          Guardar borrador
        </button>
        <button
          type="button"
          onClick={() => crear(true)}
          disabled={guardando}
          className="lp-btn lp-btn-primary"
        >
          {guardando ? "Creando..." : "Publicar"}
        </button>
      </div>

      <p className="pb-6 text-center text-[11px] text-text-muted">
        <Tape tone="mute">Borrador</Tape> queda oculta hasta que la publiques.
      </p>
    </div>
  );
}
