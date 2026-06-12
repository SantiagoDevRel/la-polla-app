// lib/espn/videos.ts — Clips de video del Mundial desde ESPN, con MP4
// DIRECTO reproducible inline (sin embed restrictions, sin salir del sitio).
//
// 🔑 Por qué ESPN y no YouTube: FIFA bloquea el embedding de buena parte de
// su contenido en YouTube ("Video unavailable on this website"). ESPN en
// cambio expone el .mp4 directo (media.video-cdn.espn.com), público, CORS
// '*', con range-requests (streaming) — se reproduce con un <video> nativo
// DENTRO de La Polla. Thumbnails en a.espncdn.com (ya en el CSP img-src).
//
// Fuente: el feed now.core (un solo call, ~25 clips con video) filtrado a
// contenido del torneo. Cacheado 30 min (Next Data Cache, global).
//
// ⚖️ Los .mp4 los sirve el CDN de ESPN directo al browser → cero bandwidth
// de Vercel, free-tier intacto.
import { ESPN_LEAGUE_BY_TOURNAMENT } from "./client";

const NOW_CORE = "https://now.core.api.espn.com/v1/sports/news";

// ── Raw (parcial) ──
interface RawVideoLinks {
  source?: {
    href?: string;
    HD?: { href?: string };
  };
  web?: { href?: string };
}
interface RawVideo {
  id?: number | string;
  headline?: string;
  caption?: string;
  description?: string;
  duration?: number;
  premium?: boolean;
  originalPublishDate?: string;
  lastModified?: string;
  thumbnail?: string;
  links?: RawVideoLinks;
}
interface RawHeadline {
  video?: RawVideo[];
}
interface RawNowResponse {
  headlines?: RawHeadline[];
}

// ── Normalizado ──
export interface VideoClip {
  id: string;
  headline: string;
  /** Segundos. */
  duration: number | null;
  /** MP4 directo (HD si existe, si no la versión estándar). */
  mp4: string;
  /** Poster (a.espncdn.com). */
  thumbnail: string | null;
  /** Página de ESPN, fallback "ver en ESPN". */
  webUrl: string | null;
  publishedAt: string | null;
}

// Señales de que un clip es del Mundial (el feed league=fifa.world igual
// mezcla algo de fichajes/clubes). Si el texto matchea, lo priorizamos.
const WC_RE = /\bworld cup|fifa|mundial\b/i;

function toClip(v: RawVideo): VideoClip | null {
  // Saltar premium (requieren auth) y los que no traen mp4 público.
  if (v.premium === true) return null;
  const mp4 = v.links?.source?.HD?.href ?? v.links?.source?.href ?? null;
  if (!mp4) return null;
  // Solo http**s** (el <video> en un sitio https no carga http).
  if (!mp4.startsWith("https://")) return null;
  return {
    id: String(v.id ?? mp4),
    headline: v.headline ?? v.caption ?? "",
    duration: typeof v.duration === "number" ? v.duration : null,
    mp4,
    thumbnail: v.thumbnail ?? null,
    webUrl: v.links?.web?.href ?? null,
    publishedAt: v.originalPublishDate ?? v.lastModified ?? null,
  };
}

function isWorldCupClip(c: VideoClip): boolean {
  return WC_RE.test(c.headline);
}

/**
 * Clips de video recientes del torneo, MP4 directo reproducible inline.
 * Prioriza contenido del Mundial; si quedan muy pocos, completa con el
 * resto del feed para no dejar el strip vacío. [] ante cualquier fallo.
 */
export async function fetchEspnVideoClips(tournamentSlug: string): Promise<VideoClip[]> {
  const league = ESPN_LEAGUE_BY_TOURNAMENT[tournamentSlug];
  if (!league) return [];
  const url = `${NOW_CORE}?limit=50&sport=soccer&league=${encodeURIComponent(league)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: "application/json" },
      next: { revalidate: 1800 },
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const raw = (await res.json()) as RawNowResponse;

  // Flatten: cada headline puede traer un array video[].
  const clips: VideoClip[] = [];
  const seen = new Set<string>();
  for (const h of raw.headlines ?? []) {
    for (const v of h.video ?? []) {
      const c = toClip(v);
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      clips.push(c);
    }
  }

  // Prioriza Mundial; si hay >=4 del Mundial, mostramos solo esos. Si no,
  // completamos con el resto (mejor un strip lleno de fútbol que vacío).
  const wc = clips.filter(isWorldCupClip);
  const ordered = wc.length >= 4 ? wc : [...wc, ...clips.filter((c) => !isWorldCupClip(c))];

  // Más reciente primero. Cap 12.
  ordered.sort((a, b) => {
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return tb - ta;
  });
  return ordered.slice(0, 12);
}
