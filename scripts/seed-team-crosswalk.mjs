// scripts/seed-team-crosswalk.mjs — genera la migración 111 (semilla del
// crosswalk de equipos football-data/ESPN → API-Football). SOLO LECTURA.
//
// Uso:
//   # 1) Foto de prod (lee matches + api_football_cache por REST, nunca escribe):
//   node scripts/seed-team-crosswalk.mjs --from-prod --env /abs/.env.local \
//        --write-snapshot C:/Users/STZTR/Downloads/la-polla-crosswalk-snapshot.json
//   # 2) Generar offline desde la foto (reproducible, 0 llamadas):
//   node scripts/seed-team-crosswalk.mjs --snapshot <foto.json> \
//        [--af-fixtures <fixtures-extra.json>] \
//        --out supabase/migrations/111_seed_team_provider_ids.sql \
//        --review C:/Users/STZTR/Downloads/la-polla-crosswalk-review.json
//
// Por qué así (críticas del plan 2026-09-13):
// - El id de un equipo se saca de la URL de su bandera SOLO si el host coincide
//   con el proveedor que escribió la fila (escudo FD en fila numérica, logo
//   ESPN en fila espn:). 46 filas FD "FC Barcelona" traen el logo ESPN 2686,
//   que es Barcelona SC: una bandera de otro host es "desconocida".
// - Anclaje estricto: un vínculo proveedor→AF se acepta con ≥2 anclas de
//   saques distintos, o 1 ancla + token de nombre compartido / override de
//   escudo revisado. Cero disenso. Las vueltas siguientes solo se apoyan en
//   vínculos con ≥2 anclas. Un id de proveedor por equipo AF.
// - Por (torneo, nombre crudo) debe salir un único af_team_id.
// - La identidad canónica vive en SQL (migración 110). El normalizador de acá
//   es un espejo de normalize_team_name usado solo para anclar la semilla.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Espejo de lib/api-football/leagues.ts (el test verifica que no diverja).
export const RESULT_LEAGUES = {
  betplay_2026: 239, libertadores_2026: 13, sudamericana_2026: 11,
  champions_2025: 2, europa_2026: 3, premier_2025: 39, ligue1_2025: 61,
  bundesliga_2025: 78, laliga_2025: 140, seriea_2025: 135,
};

// Un saque de AF en estos estados no ancla: la hora no es real.
const UNANCHORED_AF_STATUS = new Set(["TBD", "PST", "CANC", "ABD", "AWD", "WO", "SUSP", "INT"]);
const ANCHOR_WINDOW_MS = 5 * 60 * 1000;
const MAX_PASSES = 8;

// Palabras que comparten clubes distintos: no cuentan como "token compartido".
const GENERIC_TOKENS = new Set([
  "fc", "afc", "ac", "cf", "sc", "cd", "rcd", "club", "de", "del", "la", "el", "the", "and",
  "real", "atletico", "athletic", "deportivo", "deportes", "sporting", "sport", "sports",
  "united", "city", "town", "county", "rovers", "wanderers", "racing", "union", "universidad",
  "universitario", "independiente", "nacional", "internacional", "inter", "olimpia", "america",
  "santa", "san", "sao", "saint", "st", "clube", "esporte", "futebol", "football", "calcio",
  "association", "asociacion", "sociedad", "social", "cultural", "sv", "vfb", "vfl", "tsg",
  "fsv", "bsc", "rb", "rc", "as", "us", "ss", "ssc", "acf", "ogc", "stade", "olympique",
  "borussia", "hellas", "cp", "sad", "ca", "cs", "csd", "ld", "se", "ec", "fbc", "kv", "kaa",
  "fk", "nk", "sk", "if", "bk", "ik", "aik", "pfc", "hnk", "gnk", "az", "cfr",
  "catolica", "chile", "juniors", "junior", "central", "argentinos", "estudiantes",
  "tolima", "fe", "atletico-mg", "mineiro", "paranaense", "goianiense", "unidos", "libertad",
]);

const TRANSLIT = { "ø": "o", "Ø": "o", "æ": "ae", "Æ": "ae", "ß": "ss", "ł": "l", "Ł": "l", "đ": "d", "Đ": "d", "ı": "i", "œ": "oe" };

/** Espejo de public.normalize_team_name (migración 062). */
export function normalizeTeamName(name) {
  if (name == null) return null;
  let v = String(name).replace(/[øØæÆßłŁđĐıœ]/g, (c) => TRANSLIT[c])
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  v = v.replace(/\b(fc|afc|ac|cf|sc|cd|rcd|club|de|the)\b/g, " ");
  v = v.replace(/munchen/g, "munich");
  v = v.replace(/paris saint germain|paris saintgermain|paris saint-germain/g, "psg");
  const words = [
    [/\bunited states of america\b/g, "united states"], [/\busa\b/g, "united states"],
    [/\bczechia\b/g, "czech republic"], [/\bbosnia and herzegovina\b/g, "bosnia herzegovina"],
    [/\bbosnia & herzegovina\b/g, "bosnia herzegovina"], [/\bbosnia-herzegovina\b/g, "bosnia herzegovina"],
    [/\bcote d'ivoire\b/g, "ivory coast"], [/\bcote divoire\b/g, "ivory coast"],
    [/\bcape verde islands\b/g, "cape verde"], [/\bcabo verde\b/g, "cape verde"],
    [/\bsouth korea\b/g, "korea republic"], [/\brepublic of korea\b/g, "korea republic"],
    [/\bnorth korea\b/g, "korea dpr"], [/\bir iran\b/g, "iran"], [/\bchina pr\b/g, "china"],
    [/\bcongo dr\b/g, "dr congo"], [/\bcongo-kinshasa\b/g, "dr congo"],
    [/\bdemocratic republic of congo\b/g, "dr congo"],
  ];
  for (const [re, to] of words) v = v.replace(re, to);
  v = v.replace(/curazao/g, "curacao").replace(/turkiye/g, "turkey");
  return v.replace(/\s+/g, " ").trim();
}

export function nameTokens(name) {
  const n = normalizeTeamName(name) ?? "";
  return new Set(n.split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !GENERIC_TOKENS.has(t)));
}

/** Mismos patrones que lib/matches/is-placeholder.ts relevantes a identidad. */
export function isPlaceholderTeam(name) {
  if (name == null || String(name).trim() === "") return true;
  const n = String(name);
  return /^TB[DAC]\b/i.test(n) || /^[0-9][A-Z]([/][A-Z])*$/.test(n) || /^[WL][0-9]+$/.test(n)
    || /(Winner|Loser)$/i.test(n) || /Place\b/i.test(n);
}

// Mismas expresiones que public.provider_team_id_from_flag (migración 110):
// host y ruta exactos, sin query ni fragmento.
const FLAG_PATTERNS = [
  ["football-data", /^https:\/\/crests\.football-data\.org\/([0-9]{1,9})\.(?:png|svg)$/],
  ["espn", /^https:\/\/a\.espncdn\.com\/i\/teamlogos\/soccer\/[0-9]+\/([0-9]{1,9})\.png$/],
  ["api-football", /^https:\/\/media\.api-sports\.io\/football\/teams\/([0-9]{1,9})\.png$/],
];

/** (proveedor, id) desde el HOST de la URL; nunca desde el texto. */
export function providerTeamIdFromFlag(url) {
  if (!url || typeof url !== "string") return null;
  for (const [provider, re] of FLAG_PATTERNS) {
    const m = url.match(re);
    if (m) return { provider, id: String(Number(m[1])) };
  }
  return null;
}

/** Proveedor que escribió la fila, por el prefijo de external_id. */
export function rowProvider(externalId) {
  if (!externalId) return null;
  if (/^[0-9]+$/.test(externalId)) return "football-data";
  if (/^espn:[0-9]+$/.test(externalId)) return "espn";
  if (/^apifootball:[0-9]+$/.test(externalId)) return "api-football";
  return null;
}

/** Id de equipo solo si la bandera es del mismo proveedor que escribió la fila. */
export function hostMatchedTeamId(row, side) {
  const writer = rowProvider(row.external_id);
  const flag = providerTeamIdFromFlag(row[`${side}_team_flag`]);
  return writer && flag && flag.provider === writer ? flag : null;
}

const afTeam = (fixture, side) => fixture?.teams?.[side];
const afKickoff = (fixture) => Date.parse(fixture?.fixture?.date ?? "");

function overrideAgreements(overrides) {
  // Override revisado a mano: AF source ↔ referencia FD/ESPN del mismo club.
  const pairs = new Set();
  for (const entry of Object.values(overrides ?? {})) {
    const urls = [entry.source, entry.reference].map(providerTeamIdFromFlag).filter(Boolean);
    const af = urls.find((u) => u.provider === "api-football");
    for (const other of urls.filter((u) => u.provider !== "api-football")) {
      if (af) pairs.add(`${other.provider}|${other.id}|${af.id}`);
    }
  }
  return pairs;
}

/**
 * Construye el crosswalk con anclaje estricto.
 * @param {{matches: object[], afFixtures: object[], overrides?: object, afNames?: Map<string,string>}} input
 */
export function buildCrosswalk({ matches, afFixtures, overrides = {}, afNames = new Map() }) {
  const tournamentByLeague = new Map(Object.entries(RESULT_LEAGUES).map(([slug, id]) => [id, slug]));
  const agreements = overrideAgreements(overrides);
  const fixturesByTournament = new Map();
  const seenFixture = new Set();
  for (const f of afFixtures) {
    const id = f?.fixture?.id;
    const tournament = tournamentByLeague.get(f?.league?.id);
    if (!id || !tournament || seenFixture.has(id)) continue;
    seenFixture.add(id);
    if (UNANCHORED_AF_STATUS.has(f?.fixture?.status?.short)) continue;
    if (!Number.isFinite(afKickoff(f)) || !afTeam(f, "home")?.id || !afTeam(f, "away")?.id) continue;
    if (!fixturesByTournament.has(tournament)) fixturesByTournament.set(tournament, []);
    fixturesByTournament.get(tournament).push(f);
  }

  const eligibleRows = matches.filter((row) =>
    rowProvider(row.external_id) && rowProvider(row.external_id) !== "api-football"
    && row.scheduled_at_confirmed !== false
    && !isPlaceholderTeam(row.home_team) && !isPlaceholderTeam(row.away_team)
    && fixturesByTournament.has(row.tournament));

  const poisoned = new Map(); // clave → motivo; solo crece.
  const nearMisses = new Map(); // clave → una ancla sin evidencia de nombre (solo reporte)
  let strong = new Map();     // clave "prov|id" → af id (≥2 anclas, sin disenso)
  let accepted = new Map();
  let passes = 0;
  let lastVotes = new Map();
  let stats = { rows: 0, noCandidate: 0, ambiguous: 0, contradicted: 0, anchored: 0 };

  for (passes = 1; passes <= MAX_PASSES; passes++) {
    const votes = new Map();
    const hits = new Map(); // "prov|fixture" → filas (unicidad inversa)
    stats = { rows: eligibleRows.length, noCandidate: 0, ambiguous: 0, contradicted: 0, anchored: 0 };
    for (const row of eligibleRows) {
      const provider = rowProvider(row.external_id);
      const kickoff = Date.parse(row.scheduled_at);
      const ids = { home: hostMatchedTeamId(row, "home"), away: hostMatchedTeamId(row, "away") };
      let contradicted = false;
      const candidates = (fixturesByTournament.get(row.tournament) ?? []).filter((f) => {
        if (Math.abs(afKickoff(f) - kickoff) > ANCHOR_WINDOW_MS) return false;
        // Soporte: un lado con nombre normalizado igual o id ya fuerte, o los
        // DOS lados con token de nombre compartido. Nunca solo por horario
        // (el swap de BetPlay comparte saque pero no equipos).
        let supported = false;
        let tokenSides = 0;
        for (const side of ["home", "away"]) {
          const af = afTeam(f, side);
          const key = ids[side] ? `${provider}|${ids[side].id}` : null;
          const known = key ? strong.get(key) : undefined;
          if (known !== undefined && known !== af.id) { contradicted = true; return false; }
          if (known === af.id) supported = true;
          const dbName = normalizeTeamName(row[`${side}_team`]);
          if (dbName && dbName === normalizeTeamName(af.name)) supported = true;
          const dbTokens = nameTokens(row[`${side}_team`]);
          if ([...nameTokens(af.name)].some((t) => dbTokens.has(t))) tokenSides++;
        }
        return supported || tokenSides === 2;
      });
      if (candidates.length === 0) { if (contradicted) stats.contradicted++; else stats.noCandidate++; continue; }
      if (candidates.length > 1) { stats.ambiguous++; continue; }
      const fixture = candidates[0];
      const hitKey = `${provider}|${fixture.fixture.id}`;
      if (!hits.has(hitKey)) hits.set(hitKey, []);
      hits.get(hitKey).push({ row, fixture, ids, provider });
    }
    for (const list of hits.values()) {
      if (list.length !== 1) { stats.ambiguous += list.length; continue; }
      const { row, fixture, ids, provider } = list[0];
      stats.anchored++;
      for (const side of ["home", "away"]) {
        if (!ids[side]) continue;
        const af = afTeam(fixture, side);
        const key = `${provider}|${ids[side].id}`;
        const tokensDb = nameTokens(row[`${side}_team`]);
        const tokenShare = [...nameTokens(af.name)].some((t) => tokensDb.has(t));
        if (!votes.has(key)) votes.set(key, []);
        votes.get(key).push({
          af: af.id, afName: af.name, kickoff: row.scheduled_at, matchId: row.id,
          externalId: row.external_id, tournament: row.tournament, dbName: row[`${side}_team`],
          afFixture: fixture.fixture.id, tokenShare,
          nameEqual: normalizeTeamName(row[`${side}_team`]) === normalizeTeamName(af.name),
          overrideAgree: agreements.has(`${key}|${af.id}`),
        });
      }
    }

    const nextStrong = new Map();
    const nextAccepted = new Map();
    for (const [key, list] of votes) {
      const afIds = new Set(list.map((v) => v.af));
      if (afIds.size > 1) { poisoned.set(key, { reason: "dissent", afIds: [...afIds] }); continue; }
      if (poisoned.has(key)) continue;
      const af = list[0].af;
      // Saques distintos por INSTANTE, no por texto: "…Z" y "…+00:00" son el mismo.
      const kickoffs = distinctKickoffs(list);
      if (kickoffs >= 2) {
        nextStrong.set(key, af);
        nextAccepted.set(key, { af, strength: "strong", votes: list, pass: accepted.get(key)?.pass ?? passes });
      } else if (list.some((v) => v.tokenShare || v.nameEqual || v.overrideAgree)) {
        nextAccepted.set(key, { af, strength: "single", votes: list, pass: accepted.get(key)?.pass ?? passes });
      } else {
        // Una ancla sin nombre ni escudo que la respalde: no entra; queda para revisión.
        nearMisses.set(key, { af, reason: "single_anchor_without_name_evidence", votes: list });
      }
    }
    for (const key of nextAccepted.keys()) nearMisses.delete(key);
    // Un id por proveedor por equipo AF: dos ids del mismo proveedor al mismo
    // club son sospechosos → ninguno entra.
    const byProviderAf = new Map();
    for (const [key, value] of nextAccepted) {
      const group = `${key.split("|")[0]}|${value.af}`;
      if (!byProviderAf.has(group)) byProviderAf.set(group, []);
      byProviderAf.get(group).push(key);
    }
    for (const keys of byProviderAf.values()) {
      if (keys.length < 2) continue;
      for (const key of keys) {
        poisoned.set(key, { reason: "shared_af_team", keys });
        nextAccepted.delete(key); nextStrong.delete(key);
      }
    }
    const same = nextStrong.size === strong.size && [...nextStrong].every(([k, v]) => strong.get(k) === v)
      && nextAccepted.size === accepted.size && [...nextAccepted.keys()].every((k) => accepted.has(k));
    strong = nextStrong; accepted = nextAccepted; lastVotes = votes;
    if (same) break;
  }

  // Aserción: por (torneo, nombre crudo) un único af_team_id derivado.
  const nameAssertion = assertSingleAfPerName(matches, accepted);
  for (const conflict of nameAssertion.conflicts) {
    for (const key of conflict.keys) { poisoned.set(key, { reason: "name_conflict", conflict }); accepted.delete(key); }
  }
  const finalAssertion = assertSingleAfPerName(matches, accepted);
  if (finalAssertion.conflicts.length) {
    throw new Error(`Crosswalk name assertion failed: ${JSON.stringify(finalAssertion.conflicts.slice(0, 3))}`);
  }

  const mappings = [...accepted].map(([key, value]) => {
    const [provider, providerTeamId] = key.split("|");
    return {
      provider, provider_team_id: providerTeamId, af_team_id: value.af, strength: value.strength, pass: value.pass,
      anchors: distinctKickoffs(value.votes),
      af_name: afNames.get(String(value.af)) ?? value.votes[0].afName,
      db_names: [...new Set(value.votes.map((v) => v.dbName))],
      evidence: value.votes.map((v) => ({ tournament: v.tournament, external_id: v.externalId, kickoff: v.kickoff, af_fixture: v.afFixture })),
    };
  }).sort((a, b) => a.provider.localeCompare(b.provider) || Number(a.provider_team_id) - Number(b.provider_team_id));
  const rejected = [...poisoned].map(([key, value]) => ({ key, ...value, votes: (lastVotes.get(key) ?? []).map((v) => ({ af: v.af, afName: v.afName, dbName: v.dbName, external_id: v.externalId })) }));
  // Para revisión del dueño (no entran a la migración): una sola ancla sin nombre
  // compartido. Aprobarlas es decisión humana, igual que los alias.
  const reviewCandidates = [...nearMisses].filter(([key]) => !poisoned.has(key) && !accepted.has(key))
    .map(([key, value]) => ({ key, af_team_id: value.af, reason: value.reason,
      votes: value.votes.map((v) => ({ afName: v.afName, dbName: v.dbName, tournament: v.tournament, external_id: v.externalId, kickoff: v.kickoff })) }));
  return { mappings, rejected, reviewCandidates, passes, stats };
}

function distinctKickoffs(votes) {
  return new Set(votes.map((v) => Date.parse(v.kickoff))).size;
}

/** Clave derivada de una fila con el crosswalk aceptado (espejo de canonical_team_key sin alias). */
export function rowTeamKey(row, side, mappingByKey) {
  if (isPlaceholderTeam(row[`${side}_team`])) return null;
  const id = hostMatchedTeamId(row, side);
  if (id?.provider === "api-football") return `af:${id.id}`;
  const mapped = id ? mappingByKey.get(`${id.provider}|${id.id}`) : undefined;
  return mapped !== undefined ? `af:${mapped}` : `n:${normalizeTeamName(row[`${side}_team`])}`;
}

function assertSingleAfPerName(matches, accepted) {
  const byKey = new Map([...accepted].map(([k, v]) => [k, v.af]));
  const groups = new Map();
  for (const row of matches) {
    for (const side of ["home", "away"]) {
      const key = rowTeamKey(row, side, byKey);
      if (!key?.startsWith("af:")) continue;
      const id = hostMatchedTeamId(row, side);
      const group = `${row.tournament}|${row[`${side}_team`]}`;
      if (!groups.has(group)) groups.set(group, new Map());
      const bucket = groups.get(group);
      if (!bucket.has(key)) bucket.set(key, new Set());
      if (id && id.provider !== "api-football") bucket.get(key).add(`${id.provider}|${id.id}`);
    }
  }
  const conflicts = [];
  for (const [group, bucket] of groups) {
    if (bucket.size < 2) continue;
    conflicts.push({ group, keys: [...new Set([...bucket.values()].flatMap((s) => [...s]))], afKeys: [...bucket.keys()] });
  }
  return { conflicts };
}

export function coverageReport(matches, mappings, now = Date.now(), days = 60) {
  const byKey = new Map(mappings.map((m) => [`${m.provider}|${m.provider_team_id}`, m.af_team_id]));
  const report = {};
  for (const row of matches) {
    const t = Date.parse(row.scheduled_at);
    if (t < now || t > now + days * 86400000) continue;
    if (isPlaceholderTeam(row.home_team) || isPlaceholderTeam(row.away_team)) continue;
    const r = (report[row.tournament] ??= { rows: 0, both_af: 0, missing: {}, reasons: {} });
    r.rows++;
    const keys = ["home", "away"].map((side) => rowTeamKey(row, side, byKey));
    if (keys.every((k) => k?.startsWith("af:"))) r.both_af++;
    ["home", "away"].forEach((side, i) => {
      if (keys[i]?.startsWith("af:")) return;
      const name = row[`${side}_team`];
      r.missing[name] = (r.missing[name] ?? 0) + 1;
      // Por qué falta: sin id en la bandera (alias revisado), bandera de otro
      // host (por diseño desconocida; suele ser la fila duplicada) o id sin anclar.
      const flag = providerTeamIdFromFlag(row[`${side}_team_flag`]);
      const reason = !flag ? "no_team_id" : hostMatchedTeamId(row, side) ? "unmapped_id" : "cross_host_flag";
      r.reasons[reason] = (r.reasons[reason] ?? 0) + 1;
    });
  }
  for (const r of Object.values(report)) r.pct = r.rows ? Math.round((1000 * r.both_af) / r.rows) / 10 : 100;
  return report;
}

const sqlText = (v) => `'${String(v).replace(/'/g, "''")}'`;

export function renderMigration(result, { generatedAt, source, afFixtureCount }) {
  const lines = [
    "-- Semilla del crosswalk de equipos football-data/ESPN → API-Football (2026-09-13).",
    "-- GENERADO por scripts/seed-team-crosswalk.mjs; no editar a mano: regenerar.",
    `-- Fuente: ${source}. Generado: ${generatedAt}.`,
    `-- Anclas: ${afFixtureCount ?? "?"} fixtures API-Football distintos (caché diaria + temporadas guardadas;`,
    "-- el generador no llama a la API).",
    `-- Vínculos: ${result.mappings.length} (fuertes ${result.mappings.filter((m) => m.strength === "strong").length},`
      + ` una ancla + nombre ${result.mappings.filter((m) => m.strength === "single").length}); rechazados: ${result.rejected.length}; vueltas: ${result.passes}.`,
    "-- Requiere la migración 110. Solo inserta en team_provider_ids y recalcula",
    "-- claves NULL/n: → af: (sin re-key de claves af: existentes). No toca",
    "-- nombres, horarios, resultados ni pronósticos.",
    "",
  ];
  if (result.mappings.length) {
    lines.push("INSERT INTO public.team_provider_ids (provider, provider_team_id, af_team_id, source, anchors, reviewed) VALUES");
    result.mappings.forEach((m, i) => {
      const comma = i < result.mappings.length - 1 ? "," : "";
      const label = String(m.af_name ?? "").replace(/[\r\n]/g, " ");
      lines.push(`  (${sqlText(m.provider)}, ${sqlText(m.provider_team_id)}, ${Number(m.af_team_id)}, ${sqlText(`seed-2026-09-13:${m.strength}`)}, ${m.anchors}, false)${comma} -- ${label}`);
    });
    lines.push("ON CONFLICT DO NOTHING;", "");
  }
  lines.push(
    "DO $$",
    "DECLARE v_changes integer;",
    "BEGIN",
    "  SELECT count(*) INTO v_changes FROM public.refresh_match_team_keys(NULL, true, false) WHERE applied;",
    "  RAISE NOTICE 'Claves de equipo actualizadas: %', v_changes;",
    "END $$;",
    "",
  );
  return lines.join("\n");
}

async function readEnv(file) {
  const env = {};
  for (const line of (await readFile(file, "utf8")).split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

async function fetchProdSnapshot(envFile) {
  const env = await readEnv(envFile);
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase URL or service key in env file.");
  const headers = { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" };
  async function page(table, select, order) {
    const rows = [];
    // PostgREST topa en 1000 filas por request: paginar SIEMPRE.
    for (let offset = 0; ; offset += 1000) {
      const response = await fetch(`${url}/rest/v1/${table}?select=${select}&order=${order}`, {
        headers: { ...headers, Range: `${offset}-${offset + 999}` }, signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`Read ${table} failed: HTTP ${response.status}`);
      const data = await response.json();
      rows.push(...data);
      if (data.length < 1000) return rows;
    }
  }
  const matches = await page("matches",
    "id,external_id,espn_id,source_external_ids,tournament,phase,match_day,home_team,away_team,home_team_flag,away_team_flag,scheduled_at,scheduled_at_confirmed,status",
    "scheduled_at.asc,id.asc");
  const cache = await page("api_football_cache", "fixture_date,fixtures", "fixture_date.asc");
  return { fetchedAt: new Date().toISOString(), source: "prod REST (read-only)", matches, afCache: cache };
}

const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };

async function main() {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  let snapshot;
  if (process.argv.includes("--from-prod")) {
    snapshot = await fetchProdSnapshot(arg("--env") ?? path.join(repo, ".env.local"));
    const out = arg("--write-snapshot");
    if (out) await writeFile(out, JSON.stringify(snapshot));
  } else {
    const file = arg("--snapshot");
    if (!file) throw new Error("Use --from-prod or --snapshot <file>.");
    snapshot = JSON.parse(await readFile(file, "utf8"));
  }
  const afFixtures = (snapshot.afCache ?? []).flatMap((c) => c.fixtures ?? []);
  const extra = arg("--af-fixtures");
  if (extra) afFixtures.push(...JSON.parse(await readFile(extra, "utf8")));
  const coverage = JSON.parse(await readFile(path.join(repo, "lib/teams/crest-coverage.json"), "utf8"));
  const overrides = JSON.parse(await readFile(path.join(repo, "lib/teams/crest-overrides.json"), "utf8"));
  const afNames = new Map(coverage.leagues.flatMap((l) => l.teams.map((t) => [String(t.id), t.name])));
  const result = buildCrosswalk({ matches: snapshot.matches, afFixtures, overrides, afNames });
  const generatedAt = new Date().toISOString();
  const coverageUpcoming = coverageReport(snapshot.matches, result.mappings);
  const out = arg("--out");
  const afFixtureCount = new Set(afFixtures.map((f) => f?.fixture?.id).filter(Boolean)).size;
  if (out) await writeFile(out, renderMigration(result, { generatedAt, source: `${snapshot.source} ${snapshot.fetchedAt}`, afFixtureCount }));
  const review = arg("--review");
  if (review) {
    await writeFile(review, JSON.stringify({ generatedAt, snapshotFetchedAt: snapshot.fetchedAt, afFixtures: afFixtures.length, ...result, coverageUpcoming }, null, 2));
  }
  console.log(JSON.stringify({ passes: result.passes, stats: result.stats, mappings: result.mappings.length, rejected: result.rejected.length,
    reviewCandidates: result.reviewCandidates.length,
    coverageUpcoming: Object.fromEntries(Object.entries(coverageUpcoming).map(([t, r]) => [t, `${r.both_af}/${r.rows} (${r.pct}%) ${JSON.stringify(r.reasons)}`])) }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
