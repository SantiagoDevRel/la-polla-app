"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/cn";
import { flagUrlForTeam } from "@/lib/flags/country-iso";
import { teamNameKey } from "@/lib/teams/team-name-key";
import catalog from "@/lib/teams/crest-catalog.json";
import { crestFallbackSource, localCrestSource } from "@/lib/teams/crest-source";

const bySource: Record<string, string> = catalog.bySource;
const byName: Record<string, string> = catalog.byName;

/** Real club crests, with local assets first and the provider as a backup. */
export function TeamCrest({
  team,
  src,
  className,
}: {
  team: string;
  src: string | null | undefined;
  className?: string;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const countryFlag = flagUrlForTeam(team);
  const candidates = [
    localCrestSource(team,src),
    countryFlag,
    src ? bySource[src] : undefined,
    byName[teamNameKey(team)],
    crestFallbackSource(src),
  ].filter((value): value is string => Boolean(value));
  const current = candidates.find((candidate) => !failed.includes(candidate));

  return (
    <span
      data-team-crest={team}
      className={cn(
        "inline-flex h-6 w-6 max-w-none shrink-0 items-center justify-center rounded-sm",
        className,
      )}
    >
      {current ? (
        // Static, pre-sized images work offline without Image Optimization.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={current}
          src={current}
          alt=""
          width={96}
          height={96}
          loading="lazy"
          decoding="async"
          onError={() => setFailed((previous) => [...previous, current])}
          className="h-full w-full max-w-none object-contain"
        />
      ) : (
        <span role="img" aria-label={`Escudo de ${team} no disponible`} title={`Escudo de ${team} no disponible`}>
          <ImageOff className="h-4 w-4 text-text-secondary" aria-hidden="true" />
        </span>
      )}
    </span>
  );
}
