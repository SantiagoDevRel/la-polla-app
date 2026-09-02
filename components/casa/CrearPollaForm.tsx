"use client";

// components/casa/CrearPollaForm.tsx — el flujo de Tama.
//
// Tres tipos de polla en un solo formulario, porque son el mismo gesto con
// distinto contenido:
//   partidos → elegís torneo, elegís los partidos del finde, elegís si se
//              juega por 1X2 o por marcador.
//   manual   → escribís vos las preguntas y sus opciones ("primer goleador").
//   rifa     → cuántas boletas, cuánto vale, y cómo se sortea.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Label, SectionHead, StreetCard, Tape } from "@/components/street";
import { formatCop, formatMatchTime } from "@/lib/casa/format";
import { LOCK_MINUTES } from "@/lib/casa/types";
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

  // ── Premio ─────────────────────────────────────────────────────────
  // Antes solo existia un input de texto libre "Premio en objeto". Para
  // decir "el premio es el pozo" habia que escribirlo a mano, con lo que
  // cada polla lo contaba distinto y la cifra nunca se actualizaba sola.
  const [prizeKind, setPrizeKind] = useState<"pozo" | "objeto">("pozo");
  const [premioObjeto, setPremioObjeto] = useState("");
  const [prizeImagePath, setPrizeImagePath] = useState<string | null>(null);
  const [prizeImageUrl, setPrizeImageUrl] = useState<string | null>(null);
  const [subiendoFoto, setSubiendoFoto] = useState(false);

  // ── Cierre ─────────────────────────────────────────────────────────
  // "auto" lo calcula el SERVER a partir del primer partido; el input de
  // fecha solo se usa en "manual".
  const [closeMode, setCloseMode] = useState<"auto" | "manual">("auto");

  // Cuenta de cobro. Se pre-llena con la de la última polla creada: la casa
  // casi siempre cobra a la misma, y volver a escribirla cada vez es la clase
  // de fricción que hace que alguien publique sin cuenta.
  const [payoutMethod, setPayoutMethod] = useState("Nequi");
  const [payoutAccount, setPayoutAccount] = useState("");
  const [payoutAccountName, setPayoutAccountName] = useState("");

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
  const [sincronizando, setSincronizando] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  // ── Cierre vs primer pitazo ──────────────────────────────────────────
  // (2026-09-02) El default era "el proximo sabado a las 12:00", fijo. Para
  // la fecha 5 de Premier los 7 partidos del sabado arrancan entre 06:30 y
  // 11:30 hora de Bogota: TODOS antes del cierre. O sea que alguien podia
  // pagar, ver que Liverpool ya iba ganando, y recien ahi pronosticar.
  // El lock por partido de 5 minutos limitaba el daño, pero la polla nacia
  // con una ventana de trampa abierta y nada lo advertia.
  //
  // Ahora el cierre se deriva del primer partido elegido (menos 15 min) y se
  // avisa en rojo si el admin lo mueve mas alla del pitazo.
  const primerKickoff = useMemo(() => {
    if (seleccion.length === 0) return null;
    const elegidos = matches
      .filter((m) => seleccion.includes(m.id))
      .map((m) => new Date(m.scheduled_at).getTime())
      .filter((t) => Number.isFinite(t));
    return elegidos.length ? Math.min(...elegidos) : null;
  }, [matches, seleccion]);

  // Se respeta la decision del admin: si toco el campo, no se lo pisamos.
  const cierreTocado = useRef(false);

  useEffect(() => {
    if (cierreTocado.current || primerKickoff === null) return;
    // Prellena el input de manual con el mismo valor que usaria el modo
    // automatico, para que cambiar de modo no sea un salto brusco.
    setClosesAt(toLocalInput(new Date(primerKickoff - LOCK_MINUTES * 60_000)));
  }, [primerKickoff]);

  // El cierre automatico necesita partidos de donde sacar la hora. En una
  // polla manual o una rifa no hay primer pitazo, asi que el modo se cae
  // solo a manual en vez de dejar una opcion que el server va a rechazar.
  useEffect(() => {
    if (kind !== "partidos" && closeMode === "auto") setCloseMode("manual");
  }, [kind, closeMode]);

  const cierreTarde =
    primerKickoff !== null && new Date(closesAt).getTime() > primerKickoff;

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
  const [msgOk, setMsgOk] = useState<string | null>(null);

  // Trae la cuenta de cobro de la última polla para no re-escribirla.
  useEffect(() => {
    fetch("/api/casa/admin/pollas")
      .then((r) => r.json())
      .then((j) => {
        const ultima = (j.pollas ?? []).find(
          (p: { payout_account?: string | null }) => p.payout_account,
        );
        if (!ultima) return;
        setPayoutMethod(ultima.payout_method ?? "Nequi");
        setPayoutAccount(ultima.payout_account ?? "");
        setPayoutAccountName(ultima.payout_account_name ?? "");
      })
      .catch(() => {});
  }, []);

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

  /**
   * Trae el calendario de ESPN para el torneo elegido y vuelve a pedir los
   * partidos. Es admin-only del lado del server; el boton solo existe cuando
   * la lista vino vacia.
   */
  async function traerDeEspn() {
    setSincronizando(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/admin/sync-ligas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tournament }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSyncMsg(json.error ?? "No se pudo traer el calendario.");
        return;
      }
      const r = await fetch(`/api/casa/admin/matches?tournament=${tournament}`);
      const j = await r.json().catch(() => ({}));
      const traidos = j.matches ?? [];
      setMatches(traidos);
      setSyncMsg(
        traidos.length > 0
          ? `Listo: ${traidos.length} partidos.`
          : "ESPN tampoco tiene partidos próximos de este torneo. Puede estar fuera de temporada.",
      );
    } catch {
      setSyncMsg("Se cayó la conexión.");
    } finally {
      setSincronizando(false);
    }
  }

  async function subirFoto(file: File | null) {
    if (!file) return;
    setSubiendoFoto(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/casa/admin/prize-image", {
        method: "POST",
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "No se pudo subir la imagen.");
        return;
      }
      setPrizeImagePath(json.path);
      setPrizeImageUrl(json.url);
    } catch {
      setError("Se cayó la conexión al subir la imagen.");
    } finally {
      setSubiendoFoto(false);
    }
  }

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
    if (name.trim().length < 3) return setError("Escribe el nombre de la polla.");
    if (kind === "partidos" && seleccion.length === 0)
      return setError("Elige al menos un partido.");
    if (kind === "manual" && preguntas.every((q) => !q.prompt.trim()))
      return setError("Escribe al menos una pregunta.");
    if (kind === "rifa" && premioObjeto.trim().length < 3)
      return setError("Escribe qué se rifa.");
    if (prizeKind === "objeto" && premioObjeto.trim().length < 3)
      return setError("Escribe cuál es el premio.");
    if (publicar && precio > 0 && payoutAccount.trim().length < 5)
      return setError("Falta la cuenta de cobro: sin eso nadie puede pagar.");

    setGuardando(true);
    try {
      const base = {
        name: name.trim(),
        description: description.trim() || undefined,
        entryPriceCop: precio,
        houseCutPct: houseCut,
        // En modo auto el server ignora este valor y lo recalcula desde el
        // primer partido; se manda igual porque el schema lo exige.
        closesAt: new Date(closesAt).toISOString(),
        closeMode,
        prizeKind,
        prizeObject: premioObjeto.trim() || undefined,
        prizeImagePath: prizeImagePath ?? undefined,
        payoutMethod: payoutMethod.trim() || undefined,
        payoutAccount: payoutAccount.trim() || undefined,
        payoutAccountName: payoutAccountName.trim() || undefined,
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
      if (!res.ok) return setError(json.error ?? "No se pudo crear la polla.");

      // Un borrador NO es visible en /casa/<slug> (esa ruta hace notFound()
      // para los borradores), asi que mandar ahi era mandar a un 404.
      if (json.publicada) {
        router.push(`/casa/${json.slug}`);
      } else {
        setError(null);
        setMsgOk("Guardado como borrador. No es visible hasta que lo publiques.");
      }
      router.refresh();
    } catch {
      setError("Error de conexión.");
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

        {/* Cuenta de cobro — sin esto la polla no se puede pagar. */}
        <div className="border-t border-border-subtle pt-4">
          <Label>Cuenta de cobro</Label>
          <div className="mt-2 grid grid-cols-3 gap-px">
            {["Nequi", "Daviplata", "Banco"].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setPayoutMethod(m)}
                className={`lp-btn text-[12px] ${
                  payoutMethod === m ? "lp-btn-primary" : "lp-btn-ghost bg-bg-elevated"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <input
            value={payoutAccount}
            onChange={(e) => setPayoutAccount(e.target.value)}
            placeholder="300 123 4567"
            inputMode="numeric"
            className="lp-input lp-money mt-2 text-[18px]"
          />
          <input
            value={payoutAccountName}
            onChange={(e) => setPayoutAccountName(e.target.value)}
            placeholder="A nombre de..."
            className="lp-input mt-2"
          />
          <p className="mt-2 text-[11px] text-text-muted">
            Es la cuenta que ven los inscritos para transferir. Sin esto no
            puedes publicar una polla con precio.
          </p>
        </div>

        {/* ── Cuándo cierra ──────────────────────────────────────────
              El modo automático es el default porque es el que casi siempre
              se quiere y el que no se puede equivocar: la hora la calcula el
              server leyendo los partidos, no el navegador. */}
        <div>
          <Label>Cuándo cierra</Label>
          <div className="mt-2 grid grid-cols-2 gap-px">
            {(
              [
                { v: "auto", t: "Automático" },
                { v: "manual", t: "Fecha manual" },
              ] as const
            ).map((o) => {
              const on = closeMode === o.v;
              const off = o.v === "auto" && kind !== "partidos";
              return (
                <button
                  key={o.v}
                  type="button"
                  disabled={off}
                  onClick={() => setCloseMode(o.v)}
                  className={`px-4 py-3 text-[14px] font-semibold transition-colors ${
                    on
                      ? "bg-gold text-bg-base"
                      : off
                        ? "bg-bg-elevated text-text-muted opacity-40"
                        : "bg-bg-elevated text-text-secondary"
                  }`}
                >
                  {o.t}
                </button>
              );
            })}
          </div>

          {closeMode === "auto" ? (
            <p className="mt-2 text-[12px] leading-relaxed text-text-secondary">
              Cierra 5 minutos antes de que arranque el primer partido que
              elijas
              {primerKickoff !== null ? (
                <>
                  {" "}
                  &mdash;{" "}
                  <span className="text-text-primary">
                    {formatMatchTime(
                      new Date(primerKickoff - LOCK_MINUTES * 60_000).toISOString(),
                    )}
                  </span>
                </>
              ) : (
                ". Elige los partidos abajo y aquí te muestro la hora exacta."
              )}
            </p>
          ) : (
            <>
              <input
                type="datetime-local"
                value={closesAt}
                onChange={(e) => {
                  cierreTocado.current = true;
                  setClosesAt(e.target.value);
                }}
                className="lp-input mt-2"
              />
              {cierreTarde ? (
                // No es un error que impida publicar: es una decisión válida
                // (dejar entrar gente el domingo aunque el sábado ya se jugó).
                // Pero tiene que estar dicho, porque cambia lo que recibe el
                // que entra tarde.
                <p className="mt-2 text-[12px] leading-relaxed text-amber">
                  Cierra después de que arranque el primer partido. Quien entre
                  tarde igual va a poder inscribirse, pero NO va a poder
                  pronosticar los partidos ya empezados: entra con esos puntos
                  perdidos.
                </p>
              ) : (
                <p className="mt-2 text-[11px] text-text-muted">
                  Hora de tu teléfono.
                </p>
              )}
            </>
          )}
        </div>

        {/* ── El premio ──────────────────────────────────────────────── */}
        <div>
          <Label>Premio</Label>
          <div className="mt-2 grid grid-cols-2 gap-px">
            {(
              [
                { v: "pozo", t: "El pozo" },
                { v: "objeto", t: "Un objeto" },
              ] as const
            ).map((o) => {
              const on = prizeKind === o.v;
              return (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => setPrizeKind(o.v)}
                  className={`px-4 py-3 text-[14px] font-semibold transition-colors ${
                    on ? "bg-gold text-bg-base" : "bg-bg-elevated text-text-secondary"
                  }`}
                >
                  {o.t}
                </button>
              );
            })}
          </div>

          {prizeKind === "pozo" ? (
            // La cifra es VIVA: crece con cada inscripción. Por eso se muestra
            // calculada y no como un texto que el admin escriba.
            <div className="mt-3 border border-border-subtle bg-bg-elevated p-3">
              <span className="lp-label block">Se lleva el ganador</span>
              <div className="lp-money mt-1 text-[26px] leading-none text-gold">
                {formatCop(alPozo)}
                <span className="lp-label ml-2 inline text-text-muted">
                  por cada inscrito
                </span>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
                El {100 - houseCut}% de todo lo que entre. Con {precio > 0 ? "10" : "N"}{" "}
                inscritos serían {formatCop(alPozo * 10)}.
              </p>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <input
                value={premioObjeto}
                onChange={(e) => setPremioObjeto(e.target.value)}
                placeholder="iPhone 15, camiseta del Nacional..."
                className="lp-input"
              />
              <label className="block">
                <span className="lp-label">Foto (opcional)</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => subirFoto(e.target.files?.[0] ?? null)}
                  className="lp-input mt-2 file:mr-3 file:border-0 file:bg-bg-card file:px-3 file:py-1 file:text-[13px] file:text-text-secondary"
                />
              </label>
              {subiendoFoto && (
                <p className="text-[12px] text-text-muted">Subiendo la foto...</p>
              )}
              {prizeImageUrl && (
                <div className="flex items-center gap-3 border border-border-subtle bg-bg-elevated p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={prizeImageUrl}
                    alt="Foto del premio"
                    className="h-14 w-14 max-w-none shrink-0 object-cover"
                  />
                  <span className="text-[12px] text-text-secondary">
                    Lista. Se muestra en la polla.
                  </span>
                </div>
              )}
            </div>
          )}
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
                Cargando partidos...
              </StreetCard>
            ) : matches.length === 0 ? (
              // (2026-09-02) Antes esto solo decía "no hay partidos" y se leía
              // como un error de la app: el admin elegía Champions o BetPlay,
              // veía la caja vacía y no tenía nada que hacer al respecto.
              // La causa real es que esas ligas nunca se sincronizaron, y ESPN
              // sí las tiene — así que acá va el botón que las trae.
              <StreetCard className="p-5 text-center">
                <p className="text-[13px] text-text-secondary">
                  No hay partidos cargados de este torneo.
                </p>
                <button
                  type="button"
                  onClick={traerDeEspn}
                  disabled={sincronizando}
                  className="lp-btn lp-btn-ghost mt-3 h-10 min-h-0 w-full text-[14px]"
                >
                  {sincronizando ? "Trayendo el calendario..." : "Traer el calendario"}
                </button>
                {syncMsg && (
                  <p className="mt-2 text-[12px] text-text-muted">{syncMsg}</p>
                )}
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
                    <Label>Opciones disponibles</Label>
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
          {/* En una rifa el premio es obligatorio: es LA razón por la que
              alguien compra la boleta. En las otras pollas el premio es el
              pozo en plata y esto es un extra opcional (el campo de arriba). */}
          <div>
            <Label>Qué se rifa</Label>
            <input
              value={premioObjeto}
              onChange={(e) => setPremioObjeto(e.target.value)}
              placeholder="Camiseta firmada por el plantel"
              className="lp-input mt-2"
            />
            <p className="mt-2 text-[11px] text-text-muted">
              Obligatorio. Es lo primero que se lee.
            </p>
          </div>

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
              Escríbelo con claridad: es lo que se lee antes de pagar.
            </p>
          </div>
        </StreetCard>
      )}

      {error && (
        <p className="border border-red-alert/40 bg-red-alert/10 p-3 text-center text-[12px] text-red-alert">
          {error}
        </p>
      )}

      {msgOk && (
        <p className="border border-turf/40 bg-turf/10 p-3 text-center text-[12px] text-turf">
          {msgOk}
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
