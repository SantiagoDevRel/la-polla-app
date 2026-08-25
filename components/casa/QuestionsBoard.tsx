"use client";

// components/casa/QuestionsBoard.tsx — las pollas MANUALES, del lado de la gente.
//
// Tama escribe la pregunta ("¿Quién mete el primer gol?") y las opciones; acá
// la gente elige. Igual que en los partidos, bajo cada opción va el porcentaje
// de los que pusieron eso — que es la mitad de la gracia del producto.
//
// Preguntas de texto libre: se escribe y ya. El match contra la respuesta
// correcta lo hace SQL, insensible a mayúsculas y espacios.

import { useMemo, useState } from "react";
import { Label, PctBar, Tape } from "@/components/street";
import type { CasaDistribution, CasaQuestion } from "@/lib/casa/types";

interface Props {
  slug: string;
  questions: CasaQuestion[];
  /** respuestas actuales del usuario, por question_id */
  initialPicks: Record<string, { optionId: string | null; freeText: string | null }>;
  distribution: CasaDistribution;
  canEdit: boolean;
  lockedReason?: string;
}

export function QuestionsBoard({
  slug,
  questions,
  initialPicks,
  distribution,
  canEdit,
  lockedReason,
}: Props) {
  const [picks, setPicks] = useState(initialPicks);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  const respondidas = useMemo(
    () =>
      questions.filter((q) => {
        const p = picks[q.id];
        return Boolean(p?.optionId || p?.freeText?.trim());
      }).length,
    [picks, questions],
  );

  function elegirOpcion(questionId: string, optionId: string) {
    setPicks((prev) => ({ ...prev, [questionId]: { optionId, freeText: null } }));
    setDirty(true);
    setMsg(null);
  }

  function escribir(questionId: string, texto: string) {
    setPicks((prev) => ({
      ...prev,
      [questionId]: { optionId: null, freeText: texto },
    }));
    setDirty(true);
    setMsg(null);
  }

  async function guardar() {
    setSaving(true);
    setMsg(null);
    try {
      const payload = questions
        .filter((q) => picks[q.id]?.optionId || picks[q.id]?.freeText?.trim())
        .map((q) => ({
          questionId: q.id,
          optionId: picks[q.id]?.optionId ?? null,
          freeText: picks[q.id]?.freeText?.trim() || null,
        }));

      if (payload.length === 0) {
        setMsg({ text: "Todavía no respondiste nada.", bad: true });
        return;
      }

      const res = await fetch(`/api/casa/pollas/${slug}/picks`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ picks: payload }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMsg({ text: json.error ?? "No pude guardar.", bad: true });
        return;
      }
      setDirty(false);
      setMsg({ text: "Guardado." });
    } catch {
      setMsg({ text: "Se cayó la conexión.", bad: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <ul className="space-y-px">
        {questions.map((q) => {
          const resuelta = q.resolved_at != null;
          const editable = canEdit && !resuelta;
          const dist = distribution.preguntas?.[q.id];
          const total = dist?.total ?? 0;
          const mine = picks[q.id];

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
                          <span className="min-w-0 truncate">{op.label}</span>
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
                    placeholder="Escribí tu respuesta"
                    className="lp-input"
                  />
                  {total > 0 && mine?.freeText?.trim() && (
                    <p className="mt-2 text-[11px] text-text-muted">
                      {(() => {
                        const clave = mine.freeText!.trim().toLowerCase();
                        const n = dist?.conteo?.[clave] ?? 0;
                        return n <= 1
                          ? "Nadie más puso eso."
                          : `${n} de ${total} pusieron lo mismo (${Math.round((n / total) * 100)}%)`;
                      })()}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {canEdit && (
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
            disabled={saving || !dirty}
            className="lp-btn lp-btn-primary w-full"
          >
            {saving
              ? "Guardando..."
              : dirty
                ? `Guardar (${respondidas}/${questions.length})`
                : `Guardado ${respondidas}/${questions.length}`}
          </button>
        </div>
      )}

      {!canEdit && lockedReason && (
        <p className="mt-4 border border-border-default bg-bg-elevated p-3 text-center text-[12px] text-text-secondary">
          {lockedReason}
        </p>
      )}

      {canEdit && <Label className="mt-3 px-4 text-center">Las resuelve Tama a mano</Label>}
    </div>
  );
}
