"use client";
// components/rifas/RifaBoard.tsx — tablero de números de una rifa (00–99).
//
// Lo usan el comprador (elegir números libres) y el creador (tocar cualquier
// número para gestionarlo). Estado = color + ícono en la esquina + tipo de
// borde (.lp-rifa-* en globals.css), así se lee sin distinguir colores.
// El tablero público nunca recibe nombres: solo el estado de cada número.
import { Check, Clock, FileText, Plus } from "lucide-react";
import { rifaNumber } from "@/lib/rifas/shared";

export type BoardCellState = "libre" | "reservado" | "en_revision" | "pagado";

export interface BoardCell {
  n: number;
  state: BoardCellState;
  mine?: boolean;
}

// (2026-11-06, pedido del dueño) No hay estado «reservado» a la vista. Quien
// compra ve solo Libre o Pagado: con el comprobante enviado el número ya es
// suyo. El equipo distingue lo que falta: Sin pagar (sin comprobante o venta
// por fuera sin pago) y Por confirmar (comprobante enviado).
const STATE_LABEL: Record<BoardCellState, string> = {
  libre: "libre",
  reservado: "sin pagar",
  en_revision: "pagado, por confirmar",
  pagado: "pagado",
};

export function RifaBoard({
  cells, selected, onPick, pickable, winningNumber, label,
}: {
  cells: BoardCell[];
  selected?: ReadonlySet<number>;
  /** Sin onPick el tablero es de solo lectura. */
  onPick?: (n: number) => void;
  /** Qué números se pueden tocar. Por defecto: todos si hay onPick. */
  pickable?: (cell: BoardCell) => boolean;
  winningNumber?: number | null;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="lp-rifa-grid">
      {cells.map((cell) => {
        const isSelected = selected?.has(cell.n) ?? false;
        const canPick = Boolean(onPick) && (pickable ? pickable(cell) : true);
        const tone = isSelected ? "lp-rifa-sel"
          : cell.state === "pagado" ? "lp-rifa-pagado"
          : cell.state === "en_revision" ? "lp-rifa-revision"
          : cell.state === "reservado" ? "lp-rifa-reservado" : "lp-rifa-libre";
        const ring = winningNumber === cell.n ? "lp-rifa-ganador" : cell.mine ? "lp-rifa-mio" : "";
        const Icon = isSelected ? Plus : cell.state === "pagado" ? Check
          : cell.state === "en_revision" ? FileText : cell.state === "reservado" ? Clock : null;
        const name = `${rifaNumber(cell.n)}, ${isSelected ? "elegido" : STATE_LABEL[cell.state]}${cell.mine ? ", tuyo" : ""}${winningNumber === cell.n ? ", ganador" : ""}`;
        const content = <>
          {rifaNumber(cell.n)}
          {Icon && <Icon aria-hidden="true" className="lp-rifa-icon" />}
        </>;
        return onPick ? (
          <button key={cell.n} type="button" disabled={!canPick} aria-pressed={isSelected} aria-label={name}
            onClick={() => onPick(cell.n)} className={`lp-rifa-cell ${tone} ${ring}`}>
            {content}
          </button>
        ) : (
          <span key={cell.n} role="img" aria-label={name} className={`lp-rifa-cell ${tone} ${ring}`}>{content}</span>
        );
      })}
    </div>
  );
}

/** Leyenda con la forma de cada estado. Crece y envuelve con el texto ampliado.
 *  team: la vista del equipo, que además ve Sin pagar y Por confirmar. */
export function RifaLegend({ team = false, showSelected = false }: { team?: boolean; showSelected?: boolean }) {
  const items: Array<{ tone: string; label: string; Icon: typeof Check | null }> = [
    { tone: "lp-rifa-libre", label: "Libre", Icon: null },
    ...(team ? [
      { tone: "lp-rifa-reservado", label: "Sin pagar", Icon: Clock },
      { tone: "lp-rifa-revision", label: "Por confirmar", Icon: FileText },
    ] : []),
    { tone: "lp-rifa-pagado", label: "Pagado", Icon: Check },
    ...(showSelected ? [{ tone: "lp-rifa-sel", label: "Elegido", Icon: Plus }] : []),
  ];
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[13px] text-text-secondary">
      {items.map(({ tone, label, Icon }) => (
        <li key={label} className="flex items-center gap-2">
          <span aria-hidden="true" className={`lp-rifa-cell ${tone} !h-6 !w-6 !text-[11px]`}>
            {Icon && <Icon className="lp-rifa-icon" />}
          </span>
          {label}
        </li>
      ))}
    </ul>
  );
}
