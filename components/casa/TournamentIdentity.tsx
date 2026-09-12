import { Trophy } from "lucide-react";
import type { CasaPollaKind } from "@/lib/casa/types";
import { getTournamentBySlug, getTournamentLogo, getTournamentLogoClassName, getTournamentName } from "@/lib/tournaments";

/** Compact lists keep every logo; detail views also show tournament names. */
export function TournamentIdentity({
  tournaments,
  kind,
  showNames = true,
}: {
  tournaments: readonly string[];
  kind: CasaPollaKind;
  showNames?: boolean;
}) {
  if (tournaments.length === 0) {
    return <span className="lp-label">{kind === "rifa" ? "Rifa" : kind === "manual" ? "Polla manual" : "Fútbol"}</span>;
  }

  return (
    <ul
      aria-label="Torneos de la polla"
      className={showNames ? "grid min-w-0 grid-cols-2 gap-x-3 gap-y-2" : "flex min-w-0 flex-wrap items-center gap-2"}
    >
      {tournaments.map((slug) => (
        <li
          key={slug}
          title={getTournamentName(slug)}
          className={showNames ? "flex min-w-0 max-w-full items-center gap-2 last:odd:col-span-2" : "flex shrink-0"}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm">
            {getTournamentBySlug(slug) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={getTournamentLogo(slug, "small")}
                alt=""
                width={24}
                height={24}
                className={`h-6 w-6 max-w-none object-contain ${getTournamentLogoClassName(slug)}`}
              />
            ) : <Trophy aria-hidden="true" className="h-5 w-5 text-text-secondary" />}
          </span>
          <span className={showNames ? "min-w-0 text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted [overflow-wrap:anywhere]" : "sr-only"}>{getTournamentName(slug)}</span>
        </li>
      ))}
    </ul>
  );
}
