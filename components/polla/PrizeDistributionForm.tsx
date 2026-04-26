// components/polla/PrizeDistributionForm.tsx
// Form puro para construir una distribución de premios.
// Sin API — emite onChange con el shape válido (o null si está incompleto).
// Reutilizable en (a) crear polla (paso opcional) y (b) panel admin.
"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";

export type PrizeMode = "percentage" | "cop";

export interface PrizeDistribution {
  mode: PrizeMode;
  prizes: { position: number; value: number }[];
}

interface PrizeRow {
  position: number;
  value: string;
}

interface Props {
  /** Pozo total (buy_in * approved). Usado para el preview en COP cuando mode='percentage'. */
  pot: number;
  /** Estado inicial. null o sin prizes ⇒ una sola fila vacía con placeholder ???. */
  initial: PrizeDistribution | null;
  /** Callback con el último valor válido. Se llama con null cuando hay errores o falta info. */
  onChange?: (value: PrizeDistribution | null) => void;
  /** Cuando true, los warnings se muestran como "info" en vez de error (modo opcional). */
  optional?: boolean;
}

const ORDINAL_ES = ["1°", "2°", "3°", "4°", "5°", "6°", "7°", "8°", "9°", "10°"];
function ordinal(p: number): string {
  return ORDINAL_ES[p - 1] ?? `${p}°`;
}

function fmtCOP(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `$${Math.round(n).toLocaleString("es-CO")}`;
}

function buildInitialRows(initial: PrizeDistribution | null): { mode: PrizeMode; rows: PrizeRow[] } {
  if (initial && initial.prizes.length > 0) {
    return {
      mode: initial.mode,
      rows: initial.prizes.map((p) => ({ position: p.position, value: String(p.value) })),
    };
  }
  // Default: una sola fila vacía. El admin elige todo (placeholder ???).
  return { mode: "percentage", rows: [{ position: 1, value: "" }] };
}

export default function PrizeDistributionForm({ pot, initial, onChange, optional = false }: Props) {
  const init = buildInitialRows(initial);
  const [mode, setMode] = useState<PrizeMode>(init.mode);
  const [rows, setRows] = useState<PrizeRow[]>(init.rows);

  // Re-sync only when the parent provides a new `initial` (rare). Use a
  // serialized hash so the effect doesn't fire on every render due to
  // the object identity changing.
  const initialKey = initial ? JSON.stringify(initial) : "empty";
  useEffect(() => {
    const fresh = buildInitialRows(initial);
    setMode(fresh.mode);
    setRows(fresh.rows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey]);

  // Compute the validated payload + emit onChange whenever something changes.
  useEffect(() => {
    if (!onChange) return;
    const numeric = rows.map((r) => ({ position: r.position, value: parseFloat(r.value) }));
    const valid = numeric.every((r) => Number.isFinite(r.value) && r.value > 0);
    if (!valid || numeric.length === 0) {
      onChange(null);
      return;
    }
    if (mode === "percentage") {
      const sum = numeric.reduce((acc, r) => acc + r.value, 0);
      if (sum > 100.0001) {
        onChange(null);
        return;
      }
    }
    onChange({ mode, prizes: numeric });
  }, [mode, rows, onChange]);

  function addRow() {
    setRows((prev) => {
      const nextPos = (prev[prev.length - 1]?.position ?? 0) + 1;
      return [...prev, { position: nextPos, value: "" }];
    });
  }

  function removeRow(idx: number) {
    setRows((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      return next.map((r, i) => ({ ...r, position: i + 1 }));
    });
  }

  function updateValue(idx: number, value: string) {
    const sanitized =
      mode === "percentage" ? value.replace(/[^\d.]/g, "") : value.replace(/[^\d]/g, "");
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, value: sanitized } : r)));
  }

  function changeMode(next: PrizeMode) {
    if (next === mode) return;
    setMode(next);
    setRows((prev) => prev.map((r) => ({ ...r, value: "" })));
  }

  const numericRows = rows.map((r) => ({ position: r.position, value: parseFloat(r.value) }));
  const total = numericRows.reduce((acc, r) => acc + (Number.isFinite(r.value) ? r.value : 0), 0);
  const percentSum = mode === "percentage" ? total : 0;
  const overflowPct = mode === "percentage" && percentSum > 100;
  const overflowCOP = mode === "cop" && pot > 0 && total > pot;

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => changeMode("percentage")}
          className={`flex-1 px-3 py-2 rounded-xl text-sm font-semibold transition-all ${
            mode === "percentage"
              ? "bg-gold text-bg-base shadow-[0_0_12px_rgba(255,215,0,0.2)]"
              : "bg-bg-elevated text-text-secondary border border-border-subtle hover:border-gold/30"
          }`}
        >
          Porcentaje (%)
        </button>
        <button
          type="button"
          onClick={() => changeMode("cop")}
          className={`flex-1 px-3 py-2 rounded-xl text-sm font-semibold transition-all ${
            mode === "cop"
              ? "bg-gold text-bg-base shadow-[0_0_12px_rgba(255,215,0,0.2)]"
              : "bg-bg-elevated text-text-secondary border border-border-subtle hover:border-gold/30"
          }`}
        >
          Monto fijo (COP)
        </button>
      </div>

      <ul className="space-y-2">
        {rows.map((row, idx) => {
          const numeric = parseFloat(row.value);
          const previewCOP =
            mode === "percentage" && Number.isFinite(numeric) ? (pot * numeric) / 100 : null;
          return (
            <li
              key={idx}
              className="flex items-center gap-2 rounded-xl px-3 py-2 bg-bg-elevated border border-border-subtle"
            >
              <span
                className="font-display text-[20px] text-gold w-10 text-center"
                style={{ fontFeatureSettings: '"tnum"' }}
              >
                {ordinal(row.position)}
              </span>
              <div className="flex-1 flex items-center gap-2 min-w-0">
                <input
                  type="text"
                  inputMode={mode === "percentage" ? "decimal" : "numeric"}
                  value={row.value}
                  onChange={(e) => updateValue(idx, e.target.value)}
                  placeholder="???"
                  className="flex-1 min-w-0 bg-bg-base border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-gold/50 focus:ring-1 focus:ring-gold/30"
                />
                <span className="text-text-muted text-sm w-8">
                  {mode === "percentage" ? "%" : "COP"}
                </span>
              </div>
              {previewCOP !== null && pot > 0 && (
                <span className="text-[11px] text-text-muted whitespace-nowrap">
                  ≈ {fmtCOP(previewCOP)}
                </span>
              )}
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRow(idx)}
                  className="text-text-muted hover:text-red-alert transition-colors p-1"
                  title="Quitar puesto"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={addRow}
        className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-dashed border-border-subtle text-text-secondary hover:border-gold/40 hover:text-gold transition-colors text-sm"
      >
        <Plus className="w-4 h-4" /> Crear otro ganador
      </button>

      <div className="rounded-xl p-3 bg-bg-elevated border border-border-subtle text-xs space-y-1">
        {mode === "percentage" ? (
          <>
            <p
              className={`flex justify-between ${overflowPct ? "text-red-alert" : "text-text-secondary"}`}
            >
              <span>Suma total</span>
              <span className="font-semibold">{percentSum.toFixed(2)}%</span>
            </p>
            {pot > 0 && (
              <p className="flex justify-between text-text-muted">
                <span>Sobrante del pozo</span>
                <span>{fmtCOP(Math.max(0, pot - (pot * percentSum) / 100))}</span>
              </p>
            )}
            {overflowPct && (
              <p className="text-red-alert text-[11px]">
                Los porcentajes no pueden superar 100%.
              </p>
            )}
          </>
        ) : (
          <>
            <p
              className={`flex justify-between ${overflowCOP ? (optional ? "text-text-secondary" : "text-amber") : "text-text-secondary"}`}
            >
              <span>Total a repartir</span>
              <span className="font-semibold">{fmtCOP(total)}</span>
            </p>
            {pot > 0 && (
              <p className="flex justify-between text-text-muted">
                <span>Pozo {optional ? "estimado" : "disponible"}</span>
                <span>{fmtCOP(pot)}</span>
              </p>
            )}
            {overflowCOP && !optional && (
              <p className="text-amber text-[11px]">
                El total supera el pozo actual — verificalo antes del cierre.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
