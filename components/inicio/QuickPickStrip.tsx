// components/inicio/QuickPickStrip.tsx — Inicio hero-match quick-pick
//
// Rendered inside MatchHero via its quickPickSlot. Shows a "Tu pronóstico"
// pill when the user already saved a pick, then a row of 4 preset scores
// and a primary "Apuntar" button. Posts to the existing
// /api/pollas/[slug]/predictions endpoint; no new server contract.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";

/**
 * Fallback presets when the caller does not pass a `presets` prop. Inicio
 * now passes 4 random scores from a 10-entry pool; this default is kept so
 * any future caller (or tests) still gets a sensible strip.
 */
const DEFAULT_PRESETS: Array<{ home: number; away: number }> = [
  { home: 2, away: 1 },
  { home: 1, away: 1 },
  { home: 0, away: 2 },
  { home: 3, away: 0 },
];

export interface QuickPickStripProps {
  pollaSlug: string;
  pollaName: string;
  matchId: string;
  /** Existing prediction for this match, if the user already picked. */
  initialPrediction?: { home: number; away: number };
  /**
   * Disables the picker when the match is already live, finished, or within
   * the 5-minute lock window enforced by check_prediction_lock. Server
   * decides; UI just reflects it so users do not hit the toast error path.
   */
  locked?: boolean;
  /**
   * Score presets to show. Inicio passes 4 random entries per render from
   * a 10-score pool so users get a different quick-pick row each visit.
   * Ordering is preserved; rendering is left-to-right.
   */
  presets?: Array<{ home: number; away: number }>;
}

export function QuickPickStrip({
  pollaSlug,
  pollaName,
  matchId,
  initialPrediction,
  locked = false,
  presets,
}: QuickPickStripProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const effectivePresets = presets && presets.length > 0 ? presets : DEFAULT_PRESETS;
  const [selected, setSelected] = useState<{ home: number; away: number } | null>(
    initialPrediction ?? effectivePresets[0],
  );
  const [saving, setSaving] = useState(false);
  const [savedPred, setSavedPred] = useState<{ home: number; away: number } | null>(
    initialPrediction ?? null,
  );

  async function submit() {
    if (!selected || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/pollas/${pollaSlug}/predictions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          matchId,
          predictedHome: selected.home,
          predictedAway: selected.away,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg =
          data?.error === "payment_required"
            ? "Paga la polla para pronosticar"
            : data?.error || "No se pudo guardar el pronóstico";
        showToast(msg, "error");
        return;
      }
      setSavedPred(selected);
      showToast(`Apuntado ${selected.home}-${selected.away} en ${pollaName}`, "success");
      router.refresh();
    } catch {
      showToast("Error de red. Probá de nuevo.", "error");
    } finally {
      setSaving(false);
    }
  }

  const lockedToSaved =
    savedPred &&
    selected &&
    selected.home === savedPred.home &&
    selected.away === savedPred.away;

  return (
    <div>
      {savedPred ? (
        <div className="flex items-center justify-between rounded-md bg-bg-elevated border border-gold/30 px-3 py-2 mb-2.5">
          <span className="font-body text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            Tu pronóstico
          </span>
          <span
            className="font-display text-[20px] leading-none text-gold tracking-[0.04em]"
            style={{ fontFeatureSettings: '"tnum"' }}
          >
            {savedPred.home}-{savedPred.away}
          </span>
        </div>
      ) : null}

      {locked ? (
        <div className="rounded-md border border-border-subtle bg-bg-elevated px-3 py-3 text-center">
          <p className="font-body text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted">
            Pronóstico cerrado
          </p>
          <p className="font-body text-[12px] text-text-secondary mt-1">
            {savedPred
              ? `Te quedaste con ${savedPred.home}-${savedPred.away}. Suerte.`
              : "El partido ya arrancó o está por arrancar."}
          </p>
        </div>
      ) : (
        <>
          <p className="font-body text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted text-center mb-2">
            {savedPred ? "Cambiá tu pronóstico rápido" : "Pronóstico rápido"} · {pollaName}
          </p>

          <div className="flex gap-1.5 justify-center mb-2.5">
            {effectivePresets.map((p) => {
              const isSelected =
                selected && selected.home === p.home && selected.away === p.away;
              return (
                <button
                  key={`${p.home}-${p.away}`}
                  type="button"
                  onClick={() => setSelected(p)}
                  className={
                    "flex-1 py-1.5 rounded-md font-display text-[15px] tracking-[0.06em] transition-colors " +
                    (isSelected
                      ? "bg-gold text-bg-base"
                      : "bg-bg-elevated text-text-secondary border border-border-subtle hover:text-text-primary")
                  }
                  style={{ fontFeatureSettings: '"tnum"' }}
                  aria-pressed={isSelected ?? false}
                >
                  {p.home}-{p.away}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={submit}
            disabled={!selected || saving || Boolean(lockedToSaved)}
            className="w-full py-2.5 rounded-full font-body text-[13px] font-extrabold tracking-[0.04em] text-bg-base bg-gradient-to-b from-gold to-amber disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {saving
              ? "Apuntando…"
              : lockedToSaved
                ? `Ya apuntaste ${savedPred?.home}-${savedPred?.away}`
                : selected
                  ? `Apuntar ${selected.home}-${selected.away}`
                  : "Elegí un marcador"}
          </button>
        </>
      )}
    </div>
  );
}

export default QuickPickStrip;
