// components/rifas/CombosResumen.tsx — respuestas de «¿Eres de un combo?» (migración 180).
// Solo lo ve un administrador de La Polla en Gestionar. Sin datos de contacto: nombre y combo.
import { Label, StreetCard } from "@/components/street";
import type { ComboSummary } from "@/lib/rifas/combo-shared";

export function CombosResumen({ summary, partnerName }: { summary: ComboSummary | null; partnerName: string }) {
  return (
    <StreetCard className="mt-4 space-y-3 p-4">
      <div>
        <Label>Combos de {partnerName}</Label>
        {summary && (
          <p className="mt-1 text-[13px] text-text-secondary">
            {summary.answered} respondieron · {summary.inCombo} de un combo
          </p>
        )}
      </div>
      {!summary && <p className="text-[15px] text-text-primary">No se pudieron cargar las respuestas.</p>}
      {summary && summary.groups.length === 0 && <p className="text-[15px] text-text-secondary">Todavía nadie escribió su combo.</p>}
      {summary && summary.groups.length > 0 && (
        <ul className="divide-y divide-border-subtle">
          {summary.groups.map((g) => (
            <li key={g.combo} className="py-1">
              <details>
                <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
                  <span className="min-w-0 text-[15px] font-semibold [overflow-wrap:anywhere]">{g.combo}</span>
                  <span className="lp-cifra shrink-0 text-[15px] text-text-secondary">{g.people.length}</span>
                </summary>
                <p className="pb-2 text-[13px] text-text-secondary [overflow-wrap:anywhere]">{g.people.join(", ")}</p>
              </details>
            </li>
          ))}
        </ul>
      )}
    </StreetCard>
  );
}
