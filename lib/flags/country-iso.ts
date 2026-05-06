// lib/flags/country-iso.ts — Mapeo de nombres de selecciones del Mundial
// (en cualquier alias razonable EN/ES/local) a su ISO 3166-1 alpha-2
// code, mas algunos sub-codes que la libreria flag-icons soporta para
// las "naciones constituyentes" de UK (Inglaterra, Escocia, Gales,
// Irlanda del Norte).
//
// Devolvemos el code para que el componente arme la URL del CDN
// (flag-icons via jsDelivr). Si no hay match, devolvemos null y el
// caller cae al fallback de iniciales / logo del provider.

const ISO_BY_NAME: Record<string, string> = {
  // Sudamerica
  argentina: "ar",
  brazil: "br",
  brasil: "br",
  bolivia: "bo",
  chile: "cl",
  colombia: "co",
  ecuador: "ec",
  paraguay: "py",
  peru: "pe",
  uruguay: "uy",
  venezuela: "ve",
  // Norteamerica + Caribe + Centroamerica
  canada: "ca",
  mexico: "mx",
  méxico: "mx",
  panama: "pa",
  panamá: "pa",
  "united states": "us",
  usa: "us",
  "estados unidos": "us",
  haiti: "ht",
  haití: "ht",
  jamaica: "jm",
  curacao: "cw",
  curaçao: "cw",
  "costa rica": "cr",
  honduras: "hn",
  guatemala: "gt",
  "el salvador": "sv",
  // Europa
  austria: "at",
  belgium: "be",
  bélgica: "be",
  belgica: "be",
  "bosnia & herzegovina": "ba",
  "bosnia-herzegovina": "ba",
  "bosnia y herzegovina": "ba",
  croatia: "hr",
  croacia: "hr",
  "czech republic": "cz",
  czechia: "cz",
  republicachecha: "cz",
  denmark: "dk",
  dinamarca: "dk",
  england: "gb-eng",
  inglaterra: "gb-eng",
  finland: "fi",
  finlandia: "fi",
  france: "fr",
  francia: "fr",
  germany: "de",
  alemania: "de",
  greece: "gr",
  grecia: "gr",
  hungary: "hu",
  hungria: "hu",
  hungría: "hu",
  iceland: "is",
  islandia: "is",
  ireland: "ie",
  irlanda: "ie",
  italy: "it",
  italia: "it",
  netherlands: "nl",
  holanda: "nl",
  "países bajos": "nl",
  "paises bajos": "nl",
  "northern ireland": "gb-nir",
  norway: "no",
  noruega: "no",
  poland: "pl",
  polonia: "pl",
  portugal: "pt",
  romania: "ro",
  rumania: "ro",
  rumanía: "ro",
  russia: "ru",
  rusia: "ru",
  scotland: "gb-sct",
  escocia: "gb-sct",
  serbia: "rs",
  slovakia: "sk",
  eslovaquia: "sk",
  slovenia: "si",
  eslovenia: "si",
  spain: "es",
  españa: "es",
  espana: "es",
  sweden: "se",
  suecia: "se",
  switzerland: "ch",
  suiza: "ch",
  turkey: "tr",
  turquia: "tr",
  turquía: "tr",
  türkiye: "tr",
  turkiye: "tr",
  ukraine: "ua",
  ucrania: "ua",
  wales: "gb-wls",
  gales: "gb-wls",
  // Africa
  algeria: "dz",
  argelia: "dz",
  cameroon: "cm",
  camerun: "cm",
  camerún: "cm",
  "cape verde": "cv",
  "cabo verde": "cv",
  "congo dr": "cd",
  "dr congo": "cd",
  "rep dem congo": "cd",
  "republica democratica del congo": "cd",
  egypt: "eg",
  egipto: "eg",
  ghana: "gh",
  "ivory coast": "ci",
  "cote d'ivoire": "ci",
  "côte d'ivoire": "ci",
  "costa de marfil": "ci",
  morocco: "ma",
  marruecos: "ma",
  nigeria: "ng",
  senegal: "sn",
  "south africa": "za",
  sudafrica: "za",
  sudáfrica: "za",
  tunisia: "tn",
  tunez: "tn",
  túnez: "tn",
  // Asia + Oceania
  australia: "au",
  iran: "ir",
  irán: "ir",
  iraq: "iq",
  irak: "iq",
  japan: "jp",
  japon: "jp",
  japón: "jp",
  jordan: "jo",
  jordania: "jo",
  "new zealand": "nz",
  "nueva zelanda": "nz",
  qatar: "qa",
  "saudi arabia": "sa",
  "arabia saudita": "sa",
  "south korea": "kr",
  "corea del sur": "kr",
  "korea republic": "kr",
  uzbekistan: "uz",
};

/**
 * Devuelve el ISO code para usar en la CDN de banderas, o null si el
 * teamName no matchea ninguna seleccion conocida (placeholder tipo
 * "1A", "Group B Winner", "TBD", clubes con nombre que no es pais, etc).
 */
export function countryIsoForTeam(teamName: string | null | undefined): string | null {
  if (!teamName) return null;
  const key = teamName.trim().toLowerCase();
  return ISO_BY_NAME[key] ?? null;
}

/**
 * URL de la bandera en la CDN de jsDelivr (usa el repo lipis/flag-icons,
 * que tiene SVGs en aspect ratio 4x3 y soporta sub-codes como gb-eng).
 * Cero rate limits, jsDelivr CDN.
 *
 * Tag 7.0.0 verificado en 2026-05-06 — la 7.5.4 que use originalmente
 * NO existe en jsdelivr (404), por eso las banderas no cargaban.
 */
export function flagUrlForTeam(teamName: string | null | undefined): string | null {
  const iso = countryIsoForTeam(teamName);
  if (!iso) return null;
  return `https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.0.0/flags/4x3/${iso}.svg`;
}
