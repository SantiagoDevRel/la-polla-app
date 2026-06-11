// components/inicio/UpcomingHeroCard.tsx — Wrapper cliente del MatchHero
// del strip "Próximos" de /inicio. Existe porque /inicio es Server
// Component y el tap-en-equipo (abre TeamInfoSheet) necesita estado
// cliente. El tap en bandera/nombre es DISTINTO del quick-pick: el
// quick-pick vive en su strip dentro del card (quickPickSlot) y no se
// toca; los equipos hacen stopPropagation dentro de MatchHero.
"use client";

import { useState } from "react";
import { MatchHero, type MatchHeroProps } from "@/components/match/MatchHero";
import TeamInfoSheet from "@/components/match/TeamInfoSheet";
import { isPlaceholderTeam } from "@/lib/matches/is-placeholder";

interface UpcomingHeroCardProps extends Omit<MatchHeroProps, "onHomeTeamClick" | "onAwayTeamClick" | "onTap"> {
  /** Slug interno del torneo (worldcup_2026) — alimenta /api/teams/info. */
  tournament: string;
}

export default function UpcomingHeroCard({ tournament, ...heroProps }: UpcomingHeroCardProps) {
  const [teamSheet, setTeamSheet] = useState<{ team: string; flag: string | null } | null>(null);

  const home = heroProps.homeTeam;
  const away = heroProps.awayTeam;

  return (
    <>
      <MatchHero
        {...heroProps}
        onHomeTeamClick={
          isPlaceholderTeam(home.name)
            ? undefined
            : () => setTeamSheet({ team: home.name, flag: home.crestUrl ?? null })
        }
        onAwayTeamClick={
          isPlaceholderTeam(away.name)
            ? undefined
            : () => setTeamSheet({ team: away.name, flag: away.crestUrl ?? null })
        }
      />
      {teamSheet && (
        <TeamInfoSheet
          team={teamSheet.team}
          fallbackFlag={teamSheet.flag}
          tournament={tournament}
          onClose={() => setTeamSheet(null)}
        />
      )}
    </>
  );
}
