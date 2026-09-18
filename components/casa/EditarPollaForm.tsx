"use client";

// components/casa/EditarPollaForm.tsx — editor administrativo de una polla
// (2026-09-14, migración 122). Se abre desde la tuerca de /casa y de
// Administrar pollas. Todo lo que se guarda pasa por casa_edit_polla_v2: si la
// polla ya cerró o tiene inscripciones, SQL lo rechaza aunque esta pantalla
// esté desactualizada.

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Plus, X } from "lucide-react";
import { CASA_HEADERS } from "@/lib/casa/contract";
import { Label, SectionHead, StreetCard } from "@/components/street";
import { TeamCrest } from "@/components/match/TeamCrest";
import { MatchPicker, type PickedMatch } from "@/components/casa/MatchPicker";
import { formatCop, formatMatchTime } from "@/lib/casa/format";
import { CREATABLE_TOURNAMENTS } from "@/lib/tournaments";
import {
  EDIT_BLOCK_MESSAGES,
  MAX_POLLA_MATCHES,
  buildEditChanges,
  editableFieldsFromPolla,
  removeMatchBlock,
  validateEditDraft,
  type EditableFields,
} from "@/lib/casa/editor";
import type { PollaEditorState } from "@/lib/casa/editor-state";
import { DEFAULT_REFERRAL_EVERY } from "@/lib/casa/referrals-shared";

type Aviso = { tone: "ok" | "error"; text: string } | null;

async function patchPolla(id: string, body: unknown): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const response = await fetch(`/api/casa/admin/pollas/${id}`, {
      method: "PATCH",
      headers: CASA_HEADERS,
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: data.error ?? "No se pudo guardar. Intenta de nuevo." };
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Se cayó la conexión. Intenta de nuevo." };
  }
}

function tournamentName(slug: string | null): string | null {
  return CREATABLE_TOURNAMENTS.find((t) => t.slug === slug)?.name ?? null;
}

export function EditarPollaForm({ state }: { state: PollaEditorState }) {
  const router = useRouter();
  const { polla, block, entries, matches } = state;
  const original = useMemo(() => editableFieldsFromPolla(polla), [polla]);
  const [draft, setDraft] = useState<EditableFields>(original);
  const [guardando, setGuardando] = useState(false);
  const [quitando, setQuitando] = useState<string | null>(null);
  const [agregando, setAgregando] = useState(false);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [nuevos, setNuevos] = useState<PickedMatch[]>([]);

  const hasEntries = entries > 0;
  const objeto = polla.prize_kind === "objeto";
  const esPartidos = polla.kind === "partidos";
  const changes = buildEditChanges(original, draft, { hasEntries, kind: polla.kind, prizeKind: polla.prize_kind });
  const hayCambios = Object.keys(changes).length > 0;
  const lockedIds = useMemo(() => new Set(matches.map((m) => m.match_id)), [matches]);
  const cupo = Math.max(0, MAX_POLLA_MATCHES - matches.length);
  const set = (patch: Partial<EditableFields>) => setDraft((prev) => ({ ...prev, ...patch }));

  if (block) {
    return (
      <div className="space-y-5">
        <div role="status" className="flex items-start gap-3 rounded-md border border-border-default bg-bg-card/80 p-4">
          <Lock className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-text-primary">{EDIT_BLOCK_MESSAGES[block]}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">
              Los cambios solo se permiten hasta el cierre de inscripciones.
            </p>
          </div>
        </div>
        {esPartidos && matches.length > 0 && (
          <div>
            <SectionHead title="Partidos" meta={`${matches.length}`} />
            <ul className="lp-card divide-y divide-border-subtle overflow-hidden" aria-label="Partidos de la polla">
              {matches.map((m) => (
                <li key={m.match_id} className="p-3">
                  <p className="text-[15px] text-text-primary [overflow-wrap:anywhere]">{m.home_team} vs {m.away_team}</p>
                  <p className="mt-1 text-[13px] text-text-secondary">{formatMatchTime(m.scheduled_at, m.scheduled_at_confirmed)}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  async function guardar() {
    setAviso(null);
    const invalid = validateEditDraft(draft, { hasEntries, prizeKind: polla.prize_kind });
    if (invalid) return setAviso({ tone: "error", text: invalid });
    if (!hayCambios) return setAviso({ tone: "error", text: "No hay cambios para guardar." });
    setGuardando(true);
    const result = await patchPolla(polla.id, { action: "editar", changes });
    setGuardando(false);
    if (!result.ok) return setAviso({ tone: "error", text: result.error });
    setAviso({ tone: "ok", text: "Cambios guardados." });
    router.refresh();
  }

  async function quitar(matchId: string) {
    setAviso(null);
    setQuitando(matchId);
    const result = await patchPolla(polla.id, { action: "quitar_partido", matchId });
    setQuitando(null);
    if (!result.ok) return setAviso({ tone: "error", text: result.error });
    setAviso({ tone: "ok", text: "Partido quitado de la polla." });
    router.refresh();
  }

  async function agregar() {
    if (nuevos.length === 0) return;
    setAviso(null);
    setAgregando(true);
    const result = await patchPolla(polla.id, { action: "agregar_partidos", matchIds: nuevos.map((m) => m.id) });
    setAgregando(false);
    if (!result.ok) return setAviso({ tone: "error", text: result.error });
    setAviso({ tone: "ok", text: nuevos.length === 1 ? "Partido agregado a la polla." : `${nuevos.length} partidos agregados a la polla.` });
    setNuevos([]);
    router.refresh();
  }

  function toggleNuevo(match: PickedMatch) {
    setNuevos((prev) => {
      if (prev.some((item) => item.id === match.id)) return prev.filter((item) => item.id !== match.id);
      if (prev.length >= cupo) return prev;
      return [...prev, match];
    });
  }

  const avisoNode = aviso && (
    <p
      role={aviso.tone === "error" ? "alert" : "status"}
      className={`rounded-md border p-3 text-[13px] leading-relaxed [overflow-wrap:anywhere] ${
        aviso.tone === "error" ? "border-red-alert/40 bg-red-alert/10 text-text-primary" : "border-turf/40 bg-turf/10 text-text-primary"
      }`}
    >
      {aviso.text}
    </p>
  );

  return (
    <div className="space-y-5">
      <p className="text-[13px] leading-relaxed text-text-secondary">
        Puedes editar esta polla hasta el cierre de inscripciones: {formatMatchTime(polla.closes_at).replace(/\.$/, "")}.
        {esPartidos && polla.close_mode === "auto" ? " El cierre sigue al primer partido y se ajusta si agregas o quitas partidos." : ""}
      </p>

      {avisoNode}

      {/* ── Datos ────────────────────────────────────────────────────────── */}
      <StreetCard className="space-y-4 p-4">
        <div>
          <label htmlFor="editar-nombre" className="block text-[15px] font-semibold text-text-primary">Nombre</label>
          <input
            id="editar-nombre"
            value={draft.name}
            maxLength={80}
            onChange={(e) => set({ name: e.target.value })}
            className="lp-input mt-2"
          />
          <p className="mt-1 text-[13px] text-text-secondary">El enlace de la polla no cambia.</p>
        </div>
        <div>
          <label htmlFor="editar-descripcion" className="block text-[15px] font-semibold text-text-primary">Descripción (opcional)</label>
          <textarea
            id="editar-descripcion"
            value={draft.description}
            maxLength={400}
            rows={3}
            onChange={(e) => set({ description: e.target.value })}
            className="lp-input mt-2 min-h-[88px] resize-y"
          />
        </div>
        {polla.kind !== "rifa" && (
          <div>
            <label htmlFor="editar-participaciones" className="block text-[15px] font-semibold text-text-primary">Cupos por persona</label>
            <input
              id="editar-participaciones"
              type="number"
              min={1}
              max={50}
              value={draft.maxEntriesPerUser}
              onChange={(e) => set({ maxEntriesPerUser: Number(e.target.value) })}
              aria-describedby="editar-participaciones-ayuda"
              className="lp-input lp-money mt-2 text-[18px]"
            />
            <p id="editar-participaciones-ayuda" className="mt-2 text-[13px] leading-relaxed text-text-secondary">
              Cuántos cupos puede comprar una misma persona. Cada cupo es una transferencia y un comprobante aparte. Bajarlo no quita cupos existentes.
            </p>
          </div>
        )}
        {/* Invitaciones (migración 135). Prender se puede con inscripciones (2026-09-17);
            apagar, solo mientras nadie se haya inscrito. Nunca en rifas. */}
        {polla.kind !== "rifa" && (
          <label htmlFor="editar-invitaciones" className={`flex min-h-11 items-start gap-3 ${hasEntries && (draft.referralOn ?? false) ? "cursor-default opacity-60" : "cursor-pointer"}`}>
            <input
              id="editar-invitaciones"
              type="checkbox"
              checked={draft.referralOn ?? false}
              disabled={hasEntries && (original.referralOn ?? false)}
              onChange={(e) => set({ referralOn: e.target.checked })}
              aria-describedby="editar-invitaciones-ayuda"
              className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-turf disabled:cursor-default"
            />
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold text-text-primary">Cupo de regalo por invitar</span>
              <span id="editar-invitaciones-ayuda" className="mt-1 block text-[13px] text-text-secondary">
                1 cupo gratis por cada {polla.referral_every ?? DEFAULT_REFERRAL_EVERY} invitados nuevos que paguen. Automático y sin sumar al pozo.{draft.entryPriceCop <= 0 ? " No aplica con entrada gratis." : ""}{hasEntries && (original.referralOn ?? false) ? " Con inscripciones ya no se puede apagar." : ""}
              </span>
            </span>
          </label>
        )}
      </StreetCard>

      {/* ── Condiciones: solo sin inscripciones ─────────────────────────── */}
      <StreetCard className="space-y-4 p-4">
        <div>
          <Label>Condiciones</Label>
          {hasEntries ? (
            <p className="mt-2 flex items-start gap-2 text-[13px] leading-relaxed text-text-secondary">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                {entries === 1 ? "Ya hay 1 inscripción" : `Ya hay ${entries} inscripciones`}: el modo de puntaje, la entrada,
                el premio y la cuenta de cobro no se pueden cambiar.
              </span>
            </p>
          ) : (
            <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">
              Mientras nadie se inscriba puedes cambiar el modo de puntaje, la entrada, el premio y la cuenta de cobro.
            </p>
          )}
        </div>

        <fieldset disabled={hasEntries} className="space-y-4 disabled:opacity-60">
          {esPartidos && (
            <div>
              <legend className="text-[15px] font-semibold text-text-primary">Cómo se puntúa</legend>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {([
                  ["1x2", "Acierta ganador del partido"],
                  ["marcador", "Acierta marcador exacto"],
                ] as const).map(([mode, text]) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={draft.scoringMode === mode}
                    onClick={() => set({ scoringMode: mode })}
                    className={`lp-btn min-w-0 text-center text-[15px] ${draft.scoringMode === mode ? "lp-btn-primary" : "lp-btn-ghost bg-bg-elevated"}`}
                  >
                    {text}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">
                {draft.scoringMode === "1x2"
                  ? "Local, empate o visitante. Acertar suma 3 puntos."
                  : "Solo el marcador exacto suma: 3 puntos; cualquier otro resultado, 0. Las pollas anteriores a esta regla conservan 1 punto por acertar los goles de un solo equipo (Info muestra la regla de cada polla)."}
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <label htmlFor="editar-entrada" className="block text-[15px] font-semibold text-text-primary">Entrada (COP)</label>
              <input
                id="editar-entrada"
                type="number"
                min={0}
                step={1000}
                value={draft.entryPriceCop}
                onChange={(e) => set({ entryPriceCop: Number(e.target.value) })}
                className="lp-input lp-money mt-2 text-[18px]"
              />
            </div>
            {!objeto && (
              <div className="min-w-0">
                <label htmlFor="editar-casa" className="block text-[15px] font-semibold text-text-primary">Se queda la casa (%)</label>
                <input
                  id="editar-casa"
                  type="number"
                  min={0}
                  max={100}
                  value={draft.houseCutPct}
                  onChange={(e) => set({ houseCutPct: Number(e.target.value) })}
                  className="lp-input lp-money mt-2 text-[18px]"
                />
              </div>
            )}
          </div>

          {objeto ? (
            <div>
              <label htmlFor="editar-objeto" className="block text-[15px] font-semibold text-text-primary">Premio</label>
              <input
                id="editar-objeto"
                value={draft.prizeObject}
                maxLength={160}
                onChange={(e) => set({ prizeObject: e.target.value })}
                className="lp-input mt-2"
              />
            </div>
          ) : (
            <div>
              <p className="text-[15px] font-semibold text-text-primary">Premio</p>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {([
                  ["fijo", "Pozo fijo"],
                  ["proporcional", "Pozo proporcional"],
                ] as const).map(([mode, text]) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={draft.potMode === mode}
                    onClick={() => set({ potMode: mode })}
                    className={`lp-btn min-w-0 text-center text-[15px] ${draft.potMode === mode ? "lp-btn-primary" : "lp-btn-ghost bg-bg-elevated"}`}
                  >
                    {text}
                  </button>
                ))}
              </div>
              {draft.potMode === "fijo" && (
                <div className="mt-3">
                  <label htmlFor="editar-fijo" className="block text-[15px] font-semibold text-text-primary">Premio garantizado (COP)</label>
                  <input
                    id="editar-fijo"
                    type="number"
                    min={1}
                    step={1000}
                    value={draft.fixedPrizeCop ?? ""}
                    onChange={(e) => set({ fixedPrizeCop: e.target.value === "" ? null : Number(e.target.value) })}
                    className="lp-input lp-money mt-2 text-[18px]"
                  />
                  {draft.fixedPrizeCop ? (
                    <p className="mt-1 text-[13px] text-text-secondary">Mínimo garantizado: {formatCop(draft.fixedPrizeCop)}.</p>
                  ) : null}
                </div>
              )}
            </div>
          )}

          <div>
            <p className="text-[15px] font-semibold text-text-primary">Cuenta de cobro</p>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <input aria-label="Medio de pago" placeholder="Nequi" value={draft.payoutMethod} maxLength={40}
                onChange={(e) => set({ payoutMethod: e.target.value })} className="lp-input" />
              <input aria-label="Número de cuenta" placeholder="Número" value={draft.payoutAccount} maxLength={60}
                onChange={(e) => set({ payoutAccount: e.target.value })} className="lp-input" />
              <input aria-label="Titular de la cuenta" placeholder="Titular" value={draft.payoutAccountName} maxLength={80}
                onChange={(e) => set({ payoutAccountName: e.target.value })} className="lp-input" />
            </div>
          </div>
        </fieldset>
      </StreetCard>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={guardar} disabled={guardando || !hayCambios} className="lp-btn lp-btn-primary grow basis-48">
          {guardando ? "Guardando..." : "Guardar cambios"}
        </button>
        {hayCambios && !guardando && (
          <button type="button" onClick={() => { setDraft(original); setAviso(null); }} className="lp-btn lp-btn-ghost grow basis-40">
            Descartar cambios
          </button>
        )}
      </div>

      {/* ── Partidos de la polla ─────────────────────────────────────────── */}
      {esPartidos && (
        <div>
          <SectionHead title="Partidos de la polla" meta={`${matches.length}/${MAX_POLLA_MATCHES}`} className="[&>div]:flex-wrap" />
          <p className="mb-3 text-[13px] leading-relaxed text-text-secondary">
            Un partido con pronósticos no se puede quitar. Si no se va a jugar, decídelo en Issues de partidos.
          </p>
          <ul className="lp-card divide-y divide-border-subtle overflow-hidden" aria-label="Partidos de la polla">
            {matches.map((m) => {
              const bloqueo = removeMatchBlock(m, matches.length);
              const liga = tournamentName(m.tournament);
              return (
                <li key={m.match_id} className="p-3">
                  <div className="grid grid-cols-2 gap-3 text-[15px] text-text-primary">
                    <span className="min-w-0">
                      <TeamCrest team={m.home_team} src={m.home_team_flag} />
                      <span className="mt-1 block [overflow-wrap:anywhere]">{m.home_team}</span>
                    </span>
                    <span className="min-w-0 text-right">
                      <TeamCrest team={m.away_team} src={m.away_team_flag} />
                      <span className="mt-1 block [overflow-wrap:anywhere]">{m.away_team}</span>
                    </span>
                  </div>
                  <p className="mt-2 text-[13px] text-text-secondary [overflow-wrap:anywhere]">
                    {[liga, formatMatchTime(m.scheduled_at, m.scheduled_at_confirmed), m.voided ? "Anulado" : null].filter(Boolean).join(" · ")}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[13px] text-text-secondary">
                      {m.picks === 0 ? "Sin pronósticos" : m.picks === 1 ? "1 pronóstico" : `${m.picks} pronósticos`}
                    </span>
                    <button
                      type="button"
                      onClick={() => quitar(m.match_id)}
                      disabled={Boolean(bloqueo) || quitando !== null}
                      aria-describedby={bloqueo ? `quitar-${m.match_id}` : undefined}
                      className="lp-btn lp-btn-ghost min-h-11 !px-4 text-[15px]"
                    >
                      <X className="h-4 w-4 shrink-0" aria-hidden="true" />
                      {quitando === m.match_id ? "Quitando..." : "Quitar"}
                    </button>
                  </div>
                  {bloqueo && (
                    <p id={`quitar-${m.match_id}`} className="mt-1 text-[13px] leading-relaxed text-text-secondary">{bloqueo}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ── Agregar partidos ─────────────────────────────────────────────── */}
      {esPartidos && (
        cupo === 0 ? (
          <p className="text-[13px] text-text-secondary">La polla ya tiene {MAX_POLLA_MATCHES} partidos, el máximo permitido.</p>
        ) : (
          <section aria-labelledby="agregar-partidos" className="space-y-4">
          <div>
            <h2 id="agregar-partidos" className="font-display text-[24px] font-normal uppercase leading-tight tracking-[0.04em] text-text-primary">Agregar partidos</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">Elige el torneo y marca los partidos que quieres sumar a la polla.</p>
          </div>
          <MatchPicker
            title="Partidos disponibles"
            meta={`${nuevos.length} ${nuevos.length === 1 ? "elegido" : "elegidos"} · caben ${cupo}`}
            selected={nuevos}
            onToggle={toggleNuevo}
            maxSelected={cupo}
            lockedIds={lockedIds}
            initialTournament={matches[0]?.tournament && tournamentName(matches[0].tournament) ? matches[0].tournament : undefined}
            beforeList={
              <div className="mb-3 space-y-2">
                <p className="text-[13px] leading-relaxed text-text-secondary">
                  Solo se agregan partidos que no han empezado y a los que les faltan más de 5 minutos.
                </p>
                <button type="button" onClick={agregar} disabled={agregando || nuevos.length === 0} className="lp-btn lp-btn-primary w-full">
                  <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {agregando
                    ? "Agregando..."
                    : nuevos.length === 0
                      ? "Elige partidos para agregar"
                      : nuevos.length === 1 ? "Agregar 1 partido" : `Agregar ${nuevos.length} partidos`}
                </button>
              </div>
            }
          />
          </section>
        )
      )}

      <p className="pb-6 text-center text-[13px] text-text-secondary">
        {polla.status === "borrador" ? (
          <Link href="/admin/pollas" className="underline underline-offset-4 hover:text-text-primary">Volver a Administrar pollas</Link>
        ) : (
          <Link href={`/polla/${polla.slug}`} className="underline underline-offset-4 hover:text-text-primary">Ver la polla</Link>
        )}
      </p>
    </div>
  );
}
