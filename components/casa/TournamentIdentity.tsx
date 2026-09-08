import { Trophy } from "lucide-react";
import type { CasaPollaKind } from "@/lib/casa/types";
import { getTournamentBySlug, getTournamentLogo, getTournamentName } from "@/lib/tournaments";

/** Every linked competition keeps its own readable logo and name. */
export function TournamentIdentity({
  tournaments,
  kind,
}: {
  tournaments: readonly string[];
  kind: CasaPollaKind;
}) {
  if (tournaments.length === 0) {
    return <span className="lp-label">{kind === "rifa" ? "Rifa" : kind === "manual" ? "Polla manual" : "Fútbol"}</span>;
  }

  return (
    <ul aria-label="Torneos de la polla" className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2">
      {tournaments.map((slug) => (
        <li key={slug} className="flex min-w-0 max-w-full items-center gap-2 last:odd:col-span-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-text-primary">
            {getTournamentBySlug(slug) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={getTournamentLogo(slug, "small")}
                alt=""
                width={24}
                height={24}
                className="h-6 w-6 max-w-none object-contain"
              />
            ) : <Trophy aria-hidden="true" className="h-5 w-5 text-bg-base" />}
          </span>
          <span className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted [overflow-wrap:anywhere]">{getTournamentName(slug)}</span>
        </li>
      ))}
    </ul>
  );
}
