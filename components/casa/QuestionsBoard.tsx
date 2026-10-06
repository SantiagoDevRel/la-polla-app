"use client";

// components/casa/QuestionsBoard.tsx — las pollas MANUALES, del lado de la gente.
//
// Tama escribe la pregunta ("¿Quién mete el primer gol?") y las opciones; acá
// la gente elige. Igual que en los partidos, bajo cada opción va el porcentaje
// de los que pusieron eso — que es la mitad de la gracia del producto.
//
// Preguntas de texto libre: se escribe y ya. El match contra la respuesta
// correcta lo hace SQL, insensible a mayúsculas y espacios.

import { useMemo } from "react";
import { usePickSave } from "@/lib/casa/use-pick-save";
import { Label, PctBar, Tape } from "@/components/street";
import type { CasaDistribution, CasaQuestion } from "@/lib/casa/types";

interface Props {
  slug: string;
  /** Participación que se está editando (migración 131). Sin número = la principal. */
  entryNumber?: number | null;
  ownerId?: string;
  entryId?: string;
  initialRevision?: number;
  questions: CasaQuestion[];
  /** respuestas actuales del usuario, por question_id */
  initialPicks: Record<string, { optionId: string | null; freeText: string | null }>;
  distribution: CasaDistribution;
  canEdit: boolean;
  lockedReason?: string;
}

export function QuestionsBoard({
  slug,
  entryNumber, ownerId, entryId, initialRevision,
  questions,
  initialPicks,
  distribution,
  canEdit,
  lockedReason,
}: Props) {
  const { picks, saved, changed, save: guardar, discard, dirty, saving, uncertain, sessionExpired, msg } = usePickSave({
    slug, entryNumber, ownerId, entryId, initialRevision, initialPicks, targetIds: questions.map(q => q.id), kind: "question",
  });

  const respondidas = useMemo(
    () =>
      questions.filter((q) => {
        const p = picks[q.id];
        return Boolean(p?.optionId || p?.freeText?.trim());
      }).length,
    [picks, questions],
  );

  function elegirOpcion(questionId: string, optionId: string) {
    changed(questionId, { optionId, freeText: null });
  }

  function escribir(questionId: string, texto: string) {
    changed(questionId, { optionId: null, freeText: texto });
  }

  const confirmadas = questions.filter(q => saved[q.id]?.optionId || saved[q.id]?.freeText?.trim()).length;

  return (
    <div data-app-update-blocked={dirty || saving || uncertain}>
      <ul className="space-y-px">
        {questions.map((q) => {
          const resuelta = q.resolved_at != null;
          const editable = canEdit && !resuelta;
          const dist = distribution.preguntas?.[q.id];
          const total = dist?.total ?? 0;
          const mine = editable ? picks[q.id] : saved[q.id];

          return (
            <li key={q.id} className="bg-bg-card p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <h3 className="text-[15px] font-semibold leading-snug text-text-primary">
                  {q.prompt}
                </h3>
                <span className="lp-money shrink-0 text-[13px] text-text-muted">
                  {q.points} pt{q.points === 1 ? "" : "s"}
                </span>
              </div>

              {resuelta && (
                <div className="mb-3">
                  <Tape tone="live">
                    Respuesta:{" "}
                    {q.options?.find((o) => o.id === q.resolved_option_id)?.label ??
                      q.resolved_text ??
                      "—"}
                  </Tape>
                </div>
              )}

              {q.input_kind === "opciones" ? (
                <div className="space-y-1.5">
                  {(q.options ?? []).map((op) => {
                    const elegida = mine?.optionId === op.id;
                    const acertada = resuelta && q.resolved_option_id === op.id;
                    const n = dist?.conteo?.[op.id] ?? 0;
                    const pct = total > 0 ? (n / total) * 100 : 0;

                    return (
                      <div key={op.id}>
                        <button
                          type="button"
                          disabled={!editable}
                          onClick={() => elegirOpcion(q.id, op.id)}
                          aria-pressed={elegida}
                          className={[
                            "flex w-full items-center justify-between gap-3 border-2 px-3 py-3 text-left text-[14px] transition-colors",
                            acertada
                              ? "border-turf bg-turf/15 text-turf"
                              : elegida
                                ? "border-gold bg-gold/15 text-gold"
                                : "border-border-subtle bg-bg-elevated text-text-primary",
                            !editable ? "cursor-not-allowed opacity-70" : "",
                          ].join(" ")}
                        >
                          <span className="min-w-0 whitespace-normal [overflow-wrap:anywhere]">{op.label}</span>
                          {total > 0 && (
                            <span className="lp-money shrink-0 text-[12px] text-text-muted">
                              {Math.round(pct)}%
                            </span>
                          )}
                        </button>
                        {total > 0 && <PctBar pct={pct} showValue={false} className="mt-1" />}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div>
                  <input
                    type="text"
                    maxLength={120}
                    disabled={!editable}
                    value={mine?.freeText ?? ""}
                    onChange={(e) => escribir(q.id, e.target.value)}
                    placeholder="Escribe tu respuesta"
                    className="lp-input"
                  />
                  {total > 0 && mine?.freeText?.trim() && (
                    <p className="mt-2 text-[11px] text-text-muted">
                      {(() => {
                        const clave = mine.freeText!.trim().toLowerCase();
                        const n = dist?.conteo?.[clave] ?? 0;
                        return n <= 1
                          ? "Nadie más respondió eso."
                          : `${n} de ${total} respondieron lo mismo (${Math.round((n / total) * 100)}%)`;
                      })()}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {(canEdit || dirty || uncertain) && (
        <div className="sticky bottom-[88px] z-20 mt-4 border-t border-border-default bg-bg-base px-4 pb-3 pt-3">
          {msg && (
            <p
              className={`mb-2 border p-2 text-center text-[12px] ${
                msg.bad
                  ? "border-red-alert/40 bg-red-alert/10 text-red-alert"
                  : "border-turf/40 bg-turf/10 text-turf"
              }`}
            >
              {msg.text}
            </p>
          )}
          <button
            type="button"
            onClick={guardar}
            disabled={saving || (!dirty && !uncertain)}
            className="lp-btn lp-btn-primary w-full"
          >
            {saving
              ? "Guardando..."
              : uncertain ? "Comprobar guardado"
                : dirty ? `Guardar (${respondidas}/${questions.length})`
                : `Guardado ${confirmadas}/${questions.length}`}
          </button>
          {sessionExpired && <a href={`/login?returnTo=${encodeURIComponent(`/polla/${slug}${entryNumber ? `?p=${entryNumber}` : ""}`)}`} target="_blank" rel="noopener noreferrer" className="lp-btn mt-2 w-full border border-border-default">Ingresar de nuevo</a>}
          {dirty && !uncertain && !saving && <button type="button" onClick={discard} className="mt-2 min-h-11 w-full text-[13px] text-text-secondary underline">Descartar cambios sin guardar</button>}
        </div>
      )}

      {!canEdit && lockedReason && (
        <p className="mt-4 border border-border-default bg-bg-elevated p-3 text-center text-[12px] text-text-secondary">
          {lockedReason}
        </p>
      )}

      {canEdit && <Label className="mt-3 px-4 text-center">Las resuelve el administrador</Label>}
    </div>
  );
}
