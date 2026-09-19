import { Trophy } from "lucide-react";
import type { CasaPollaKind } from "@/lib/casa/types";
import { getTournamentBySlug, getTournamentLogo, getTournamentLogoClassName, getTournamentName } from "@/lib/tournaments";

/**
 * Logos de los torneos de una polla. Solo logos en todas las vistas: el nombre
 * queda para lectores de pantalla y en el `title`.
 *
 * (2026-09-13) El detalle mostraba logo + nombre en una grilla de 2 columnas:
 * con seis ligas eran tres filas de texto encima del nombre de la polla. El
 * dueño pidió solo logos. `lg` es una sola fila de fichas de 40 px: seis caben
 * desde 320 px y, si una polla trae más, la fila se desliza en horizontal en
 * vez de partirse y dejar un logo huérfano en otra fila.
 *
 * (2026-09-19) `limit` es para las tarjetas de polla, que miden todas lo mismo:
 * una sola fila, y si la polla trae más torneos que el límite, los últimos se
 * resumen en «+N». Sin `limit`, `sm` conserva el salto de fila de antes.
 */
export function TournamentIdentity({
  tournaments,
  kind,
  size = "sm",
  limit,
}: {
  tournaments: readonly string[];
  kind: CasaPollaKind;
  size?: "sm" | "lg";
  /** Máximo de fichas en la fila, contando la de «+N». */
  limit?: number;
}) {
  if (tournaments.length === 0) {
    return <span className="lp-label">{kind === "rifa" ? "Rifa" : kind === "manual" ? "Polla manual" : "Fútbol"}</span>;
  }

  const lg = size === "lg";
  const shown = limit && tournaments.length > limit ? tournaments.slice(0, limit - 1) : tournaments;
  const extra = tournaments.length - shown.length;
  return (
    <ul
      aria-label="Torneos de la polla"
      className={lg
        ? "-mx-4 flex min-w-0 items-center gap-2 overflow-x-auto px-4 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        : `flex min-w-0 items-center gap-2 ${limit ? "overflow-hidden" : "flex-wrap"}`}
    >
      {shown.map((slug) => (
        <li key={slug} title={getTournamentName(slug)} className="flex shrink-0">
          <span
            className={lg
              ? "flex h-10 w-10 items-center justify-center rounded-md border border-border-subtle bg-bg-card/70 backdrop-blur-sm"
              : "flex h-8 w-8 items-center justify-center rounded-sm"}
          >
            {getTournamentBySlug(slug) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={getTournamentLogo(slug, "small")}
                alt=""
                width={lg ? 28 : 24}
                height={lg ? 28 : 24}
                className={`${lg ? "h-7 w-7" : "h-6 w-6"} max-w-none object-contain ${getTournamentLogoClassName(slug)}`}
              />
            ) : <Trophy aria-hidden="true" className="h-5 w-5 text-text-secondary" />}
          </span>
          <span className="sr-only">{getTournamentName(slug)}</span>
        </li>
      ))}
      {extra > 0 && (
        <li className="flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full border border-border-subtle px-1.5 text-[13px] font-semibold tabular-nums text-text-secondary">
          <span aria-hidden="true">+{extra}</span>
          <span className="sr-only">{extra === 1 ? "y 1 torneo más" : `y ${extra} torneos más`}</span>
        </li>
      )}
    </ul>
  );
}
