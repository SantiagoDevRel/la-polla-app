// Semilla del crosswalk de equipos (scripts/seed-team-crosswalk.mjs → migración 111).
// Fotos mínimas sintéticas con ids reales de proveedor: 0 llamadas de red.
import { describe, expect, it } from "vitest";
import { RESULT_LEAGUES as RUNTIME_LEAGUES } from "@/lib/api-football/leagues";
import {
  RESULT_LEAGUES,
  buildCrosswalk,
  hostMatchedTeamId,
  providerTeamIdFromFlag,
  renderMigration,
  rowTeamKey,
} from "../scripts/seed-team-crosswalk.mjs";

type Row = Record<string, unknown>;
const fd = (id: number) => `https://crests.football-data.org/${id}.png`;
const espn = (id: number) => `https://a.espncdn.com/i/teamlogos/soccer/500/${id}.png`;
let rowSeq = 0;

function row(externalId: string, tournament: string, home: [string, string | null], away: [string, string | null], kickoff: string): Row {
  rowSeq += 1;
  return {
    id: `00000000-0000-0000-0000-${String(rowSeq).padStart(12, "0")}`,
    external_id: externalId, tournament, scheduled_at: kickoff, scheduled_at_confirmed: true,
    home_team: home[0], home_team_flag: home[1], away_team: away[0], away_team_flag: away[1],
  };
}

function fixture(id: number, league: number, kickoff: string, home: [number, string], away: [number, string], status = "NS") {
  return {
    fixture: { id, date: kickoff, status: { short: status } },
    league: { id: league, season: 2026, round: "Regular Season - 1" },
    teams: { home: { id: home[0], name: home[1] }, away: { id: away[0], name: away[1] } },
  };
}

const keyMap = (mappings: Array<{ provider: string; provider_team_id: string; af_team_id: number }>) =>
  new Map(mappings.map((m) => [`${m.provider}|${m.provider_team_id}`, m.af_team_id]));
const find = <T extends { provider: string; provider_team_id: string }>(mappings: T[], provider: string, id: string) =>
  mappings.find((m) => m.provider === provider && m.provider_team_id === id);

describe("seed-team-crosswalk", () => {
  it("mirrors the runtime league map", () => {
    expect(RESULT_LEAGUES).toEqual(RUNTIME_LEAGUES);
  });

  it("derives team ids only from the flag host of the provider that wrote the row", () => {
    expect(providerTeamIdFromFlag(fd(546))).toEqual({ provider: "football-data", id: "546" });
    expect(providerTeamIdFromFlag(espn(175))).toEqual({ provider: "espn", id: "175" });
    expect(providerTeamIdFromFlag("https://media.api-sports.io/football/teams/116.png")).toEqual({ provider: "api-football", id: "116" });
    expect(providerTeamIdFromFlag(`${fd(546)}?v=2`)).toBeNull();
    expect(providerTeamIdFromFlag("https://crests.football-data.org/bournemouth.png")).toBeNull();
    const crossHost = row("552000", "laliga_2025", ["FC Barcelona", espn(2686)], ["Real Madrid CF", fd(86)], "2026-03-01T20:00:00Z");
    expect(hostMatchedTeamId(crossHost, "home")).toBeNull();
    expect(hostMatchedTeamId(crossHost, "away")).toEqual({ provider: "football-data", id: "86" });
  });

  it("maps Lens FD 546 and ESPN 175 to the same API-Football id", () => {
    const matches = [
      row("559712", "ligue1_2025", ["Racing Club de Lens", fd(546)], ["AJ Auxerre", fd(519)], "2026-08-22T15:15:00Z"),
      row("559695", "ligue1_2025", ["Racing Club de Lens", fd(546)], ["FC Lorient", fd(525)], "2026-09-05T15:15:00Z"),
      row("espn:401915440", "champions_2025", ["Slavia Prague", espn(494)], ["Lens", espn(175)], "2026-09-10T19:00:00Z"),
      row("espn:401915441", "champions_2025", ["Lens", espn(175)], ["Club Brugge", espn(570)], "2026-10-21T19:00:00Z"),
    ];
    const afFixtures = [
      fixture(1, 61, "2026-08-22T15:15:00+00:00", [116, "Lens"], [108, "Auxerre"]),
      fixture(2, 61, "2026-09-05T15:15:00+00:00", [116, "Lens"], [97, "Lorient"]),
      fixture(3, 2, "2026-09-10T19:00:00+00:00", [560, "Slavia Praha"], [116, "Lens"]),
      fixture(4, 2, "2026-10-21T19:00:00+00:00", [116, "Lens"], [569, "Club Brugge KV"]),
    ];
    const { mappings } = buildCrosswalk({ matches, afFixtures });
    expect(find(mappings, "football-data", "546")?.af_team_id).toBe(116);
    expect(find(mappings, "espn", "175")?.af_team_id).toBe(116);
    const keys = keyMap(mappings);
    expect(rowTeamKey(matches[0], "home", keys)).toBe(rowTeamKey(matches[2], "away", keys));
  });

  it("never gives the 46 FD 'FC Barcelona' rows with the ESPN 2686 logo Barcelona SC identity", () => {
    const opponents: Array<[string, number, number, string]> = [
      ["Real Madrid CF", 86, 541, "Real Madrid"], ["Sevilla FC", 559, 536, "Sevilla"],
      ["Valencia CF", 95, 532, "Valencia"], ["Villarreal CF", 94, 533, "Villarreal"],
    ];
    const matches: Row[] = [];
    const afFixtures = [];
    for (let i = 0; i < 46; i++) {
      const [name, fdId, afId, afName] = opponents[i % opponents.length];
      const kickoff = new Date(Date.UTC(2025, 7, 16 + i * 5, 19, 0)).toISOString();
      matches.push(row(String(544000 + i), i % 2 ? "champions_2025" : "laliga_2025", ["FC Barcelona", espn(2686)], [name, fd(fdId)], kickoff));
      afFixtures.push(fixture(9000 + i, i % 2 ? 2 : 140, kickoff, [529, "Barcelona"], [afId, afName]));
    }
    // Barcelona SC nativo en Libertadores con su logo ESPN 2686 (dos saques).
    matches.push(row("espn:401700001", "libertadores_2026", ["Barcelona SC", espn(2686)], ["Palmeiras", espn(2029)], "2026-04-08T00:30:00Z"));
    matches.push(row("espn:401700002", "libertadores_2026", ["Palmeiras", espn(2029)], ["Barcelona SC", espn(2686)], "2026-05-14T22:00:00Z"));
    afFixtures.push(fixture(8001, 13, "2026-04-08T00:30:00+00:00", [1152, "Barcelona SC"], [121, "Palmeiras"]));
    afFixtures.push(fixture(8002, 13, "2026-05-14T22:00:00+00:00", [121, "Palmeiras"], [1152, "Barcelona SC"]));

    const { mappings, rejected } = buildCrosswalk({ matches, afFixtures });
    expect(rejected).toEqual([]);
    expect(find(mappings, "espn", "2686")?.af_team_id).toBe(1152);
    expect(mappings.filter((m) => m.af_team_id === 529)).toEqual([]);
    const keys = keyMap(mappings);
    const fdBarcelona = matches.filter((m) => m.home_team === "FC Barcelona");
    expect(fdBarcelona).toHaveLength(46);
    for (const m of fdBarcelona) expect(rowTeamKey(m, "home", keys)).toBe("n:barcelona");
    // Los rivales, con escudo FD del mismo host, sí se anclan.
    expect(find(mappings, "football-data", "86")?.af_team_id).toBe(541);
  });

  it("does not map the BetPlay kickoff swap", () => {
    const matches = [
      row("espn:401878001", "betplay_2026", ["Deportivo Cali", espn(2672)], ["Once Caldas", espn(2919)], "2026-09-19T18:00:00Z"),
      row("espn:401878002", "betplay_2026", ["América de Cali", espn(8109)], ["Deportes Tolima", espn(5489)], "2026-09-19T20:00:00Z"),
    ];
    const afFixtures = [
      fixture(1549801, 239, "2026-09-19T18:00:00+00:00", [1138, "America de Cali"], [1142, "Deportes Tolima"]),
      fixture(1549802, 239, "2026-09-19T20:00:00+00:00", [1127, "Deportivo Cali"], [1136, "Once Caldas"]),
    ];
    const { mappings, stats } = buildCrosswalk({ matches, afFixtures });
    expect(mappings).toEqual([]);
    expect(stats.anchored).toBe(0);
  });

  it("maps Celta only in the second pass, building on a mapping with two anchors", () => {
    const matches = [
      row("558001", "seriea_2025", ["FC Internazionale Milano", fd(108)], ["Juventus FC", fd(109)], "2026-09-12T18:45:00Z"),
      row("558002", "seriea_2025", ["AC Milan", fd(98)], ["FC Internazionale Milano", fd(108)], "2026-09-20T18:45:00Z"),
      row("575100", "champions_2025", ["RC Celta de Vigo", fd(558)], ["FC Internazionale Milano", fd(108)], "2026-10-21T19:00:00Z"),
    ];
    const afFixtures = [
      fixture(11, 135, "2026-09-12T18:45:00+00:00", [505, "Inter"], [496, "Juventus"]),
      fixture(12, 135, "2026-09-20T18:45:00+00:00", [489, "AC Milan"], [505, "Inter"]),
      fixture(13, 2, "2026-10-21T19:00:00+00:00", [538, "Celta Vigo"], [505, "Inter"]),
    ];
    const { mappings, passes } = buildCrosswalk({ matches, afFixtures });
    expect(find(mappings, "football-data", "108")).toMatchObject({ af_team_id: 505, strength: "strong", pass: 1 });
    expect(find(mappings, "football-data", "558")).toMatchObject({ af_team_id: 538, pass: 2 });
    expect(passes).toBeGreaterThanOrEqual(2);
  });

  it("requires two anchors or a shared name token, and rejects dissent", () => {
    const matches = [
      // Una sola ancla sin token común: no entra.
      row("espn:1", "betplay_2026", ["Millonarios", espn(5484)], ["Equipo Raro", espn(7777)], "2026-09-13T20:00:00Z"),
      // Disenso: el mismo id ESPN vota por dos clubes AF distintos.
      row("espn:2", "betplay_2026", ["Deportivo Pasto", espn(5485)], ["Club Dudoso", espn(8888)], "2026-09-14T20:00:00Z"),
      row("espn:3", "betplay_2026", ["Deportivo Pereira", espn(5486)], ["Club Dudoso", espn(8888)], "2026-09-21T20:00:00Z"),
    ];
    const afFixtures = [
      fixture(21, 239, "2026-09-13T20:00:00+00:00", [1125, "Millonarios"], [1470, "Cucuta"]),
      fixture(22, 239, "2026-09-14T20:00:00+00:00", [1126, "Deportivo Pasto"], [1133, "Jaguares"]),
      fixture(23, 239, "2026-09-21T20:00:00+00:00", [1462, "Deportivo Pereira"], [1144, "Aguilas Doradas"]),
    ];
    const { mappings, rejected } = buildCrosswalk({ matches, afFixtures });
    expect(find(mappings, "espn", "7777")).toBeUndefined();
    expect(find(mappings, "espn", "8888")).toBeUndefined();
    expect(rejected.find((r: { key: string }) => r.key === "espn|8888")).toMatchObject({ reason: "dissent" });
    expect(find(mappings, "espn", "5484")).toMatchObject({ af_team_id: 1125, strength: "single" });
    // La ancla sin nombre no entra, pero queda listada para revisión del dueño.
    expect(buildCrosswalk({ matches, afFixtures }).reviewCandidates).toContainEqual(
      expect.objectContaining({ key: "espn|7777", af_team_id: 1470, reason: "single_anchor_without_name_evidence" }));
  });

  it("counts anchors by kickoff instant: two rows at the same kickoff are one anchor", () => {
    const matches = [
      row("591001", "champions_2025", ["Theta Albion", fd(9101)], ["Iota Harriers", fd(9102)], "2026-10-01T19:00:00Z"),
      row("591002", "europa_2026", ["Theta Albion", fd(9101)], ["Mu Harriers", fd(9103)], "2026-10-01T19:00:00+00:00"),
    ];
    const afFixtures = [
      fixture(61, 2, "2026-10-01T19:00:00+00:00", [8101, "Theta Albion"], [8102, "Iota Harriers"]),
      fixture(62, 3, "2026-10-01T19:00:00+00:00", [8101, "Theta Albion"], [8103, "Mu Harriers"]),
    ];
    const { mappings } = buildCrosswalk({ matches, afFixtures });
    expect(find(mappings, "football-data", "9101")).toMatchObject({ af_team_id: 8101, strength: "single", anchors: 1 });
  });

  it("does not let a single-anchor mapping support later passes", () => {
    const matches = [
      // Zeta (ESPN 6001) queda con UNA ancla por nombre igual.
      row("espn:600001", "betplay_2026", ["Zeta Rangers", espn(6001)], ["Omega Town", espn(6002)], "2026-09-01T20:00:00Z"),
      // Dos saques de Zeta contra un club sin nombre en común: solo un vínculo
      // fuerte de Zeta los sostendría. Con uno "single" no deben anclar a 6003.
      row("espn:600002", "betplay_2026", ["Zeta", espn(6001)], ["Club Misterio", espn(6003)], "2026-09-08T20:00:00Z"),
      row("espn:600003", "betplay_2026", ["Club Misterio", espn(6003)], ["Zeta", espn(6001)], "2026-09-15T20:00:00Z"),
    ];
    const afFixtures = [
      fixture(31, 239, "2026-09-01T20:00:00+00:00", [7001, "Zeta Rangers"], [7002, "Omega Town"]),
      fixture(32, 239, "2026-09-08T20:00:00+00:00", [7001, "Zeta Rangers"], [7003, "Kappa Wanderers"]),
      fixture(33, 239, "2026-09-15T20:00:00+00:00", [7003, "Kappa Wanderers"], [7001, "Zeta Rangers"]),
    ];
    const { mappings } = buildCrosswalk({ matches, afFixtures });
    expect(find(mappings, "espn", "6001")).toMatchObject({ af_team_id: 7001, strength: "single", anchors: 1 });
    expect(find(mappings, "espn", "6003")).toBeUndefined();
  });

  it("poisons provider ids when one (tournament, raw name) derives two API-Football ids", () => {
    const matches = [
      row("espn:610001", "betplay_2026", ["Deportivo Xi", espn(6101)], ["Omicron FC", espn(6104)], "2026-09-02T20:00:00Z"),
      row("espn:610002", "betplay_2026", ["Deportivo Xi", espn(6102)], ["Pi Albion", espn(6105)], "2026-09-09T20:00:00Z"),
    ];
    const afFixtures = [
      fixture(41, 239, "2026-09-02T20:00:00+00:00", [7101, "Deportivo Xi"], [7104, "Omicron"]),
      fixture(42, 239, "2026-09-09T20:00:00+00:00", [7102, "Deportivo Xi"], [7105, "Pi Albion"]),
    ];
    const { mappings, rejected } = buildCrosswalk({ matches, afFixtures });
    expect(find(mappings, "espn", "6101")).toBeUndefined();
    expect(find(mappings, "espn", "6102")).toBeUndefined();
    for (const key of ["espn|6101", "espn|6102"]) {
      expect(rejected.find((r: { key: string }) => r.key === key)).toMatchObject({ reason: "name_conflict" });
    }
    expect(find(mappings, "espn", "6104")?.af_team_id).toBe(7104);
  });

  it("poisons two ids of the same provider that vote for the same API-Football team", () => {
    const matches = [
      row("espn:620001", "betplay_2026", ["Sigma Athletic", espn(6201)], ["Tau Albion", espn(6203)], "2026-09-03T20:00:00Z"),
      row("espn:620002", "betplay_2026", ["Upsilon Harriers", espn(6204)], ["Sigma Athletic", espn(6202)], "2026-09-10T20:00:00Z"),
    ];
    const afFixtures = [
      fixture(51, 239, "2026-09-03T20:00:00+00:00", [7201, "Sigma Athletic"], [7203, "Tau Albion"]),
      fixture(52, 239, "2026-09-10T20:00:00+00:00", [7204, "Upsilon Harriers"], [7201, "Sigma Athletic"]),
    ];
    const { mappings, rejected } = buildCrosswalk({ matches, afFixtures });
    expect(mappings.filter((m: { af_team_id: number }) => m.af_team_id === 7201)).toEqual([]);
    for (const key of ["espn|6201", "espn|6202"]) {
      expect(rejected.find((r: { key: string }) => r.key === key)).toMatchObject({ reason: "shared_af_team" });
    }
    expect(find(mappings, "espn", "6203")?.af_team_id).toBe(7203);
  });

  it("skips postponed/TBD provider fixtures and provisional rows as anchors", () => {
    const matches = [
      { ...row("espn:401877965", "betplay_2026", ["Deportivo Pereira", espn(5486)], ["Independiente Santa Fe", espn(5488)], "2026-09-15T20:00:00Z"), scheduled_at_confirmed: false },
      row("espn:401877966", "betplay_2026", ["Llaneros", espn(7915)], ["Deportivo Cali", espn(2672)], "2026-09-08T20:00:00Z"),
    ];
    const afFixtures = [
      fixture(1549712, 239, "2026-09-15T20:00:00+00:00", [1462, "Deportivo Pereira"], [1139, "Santa Fe"]),
      fixture(1549770, 239, "2026-09-08T20:00:00+00:00", [1464, "Llaneros"], [1127, "Deportivo Cali"], "PST"),
    ];
    expect(buildCrosswalk({ matches, afFixtures }).mappings).toEqual([]);
  });

  it("renders an idempotent insert plus the reviewed key refresh", () => {
    const sql = renderMigration({
      mappings: [{ provider: "espn", provider_team_id: "5", af_team_id: 451, strength: "single", anchors: 1, af_name: "Boca 'Juniors'\nX" }],
      rejected: [], passes: 1,
    }, { generatedAt: "2026-09-13T00:00:00Z", source: "test", afFixtureCount: 1 });
    expect(sql).toContain("('espn', '5', 451, 'seed-2026-09-13:single', 1, false) -- Boca 'Juniors' X");
    expect(sql).toContain("ON CONFLICT DO NOTHING;");
    expect(sql).toContain("refresh_match_team_keys(NULL, true, false)");
    expect(sql).not.toMatch(/DELETE|UPDATE public\.matches|predictions/i);
  });
});
