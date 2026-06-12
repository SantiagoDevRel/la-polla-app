// lib/youtube/highlights.ts — Highlights/goles/resúmenes del Mundial que se
// REPRODUCEN INLINE dentro de La Polla.
//
// 🔑 El truco (validado 2026-06-12 embebiendo iframes reales en localhost):
// el canal oficial de FIFA BLOQUEA el embed ("Video unavailable on this
// website"), pero los canales de BROADCASTERS (Gol Caracol, ESPN Deportes,
// etc.) SÍ permiten embed → reproducen dentro del sitio. Bonus: son en
// español, perfecto para la audiencia es-CO.
//
// Fuente: RSS por canal (youtube.com/feeds/videos.xml?channel_id=…) — sin
// API key, sin cuota. Filtramos a resúmenes/goles del Mundial. Cacheado con
// Next Data Cache (revalidate 30 min) → pocos hits a YouTube global. El
// video lo sirve YouTube → cero bandwidth de Vercel.

const RSS_BASE = "https://www.youtube.com/feeds/videos.xml";

// Canales de broadcasters que publican highlights del Mundial Y permiten
// embed inline (validados reproduciendo iframes reales). channel_id estable.
//
// Gol Caracol es la fuente principal: resúmenes/goles VOD en español que
// embeban 100% (validado 2026-06-12). Descartamos ESPN Deportes (publica
// "Live stream offline" — VODs de transmisiones que quedan sin reproducir)
// y ESPN Fans (mezcla F1/otros deportes). Para agregar un canal nuevo:
// validar que (a) embeba inline y (b) postee VODs de resumen, no streams.
const BROADCASTER_CHANNELS: ReadonlyArray<{ id: string; name: string }> = [
  { id: "UCXXOzmyYvDtaijm5i303Tng", name: "Gol Caracol" },
];

export interface HighlightVideo {
  videoId: string;
  title: string;
  channel: string;
  publishedAt: string | null;
  thumbnail: string;
  /** Embed inline (reproduce dentro del sitio). */
  embedUrl: string;
  /** Fallback "ver en YouTube". */
  watchUrl: string;
}

// Decodifica las entidades HTML que YouTube mete en <title>.
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)));
}

function pick(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? m[1] : null;
}

interface RawEntry {
  videoId: string;
  title: string;
  publishedAt: string | null;
}

/** Parser Atom mínimo — sin dependencias. */
export function parseYoutubeFeed(xml: string): RawEntry[] {
  const out: RawEntry[] = [];
  const entries = xml.split("<entry>").slice(1);
  for (const raw of entries) {
    const block = raw.split("</entry>")[0];
    const videoId = pick(block, "yt:videoId");
    const title = pick(block, "title");
    if (!videoId || !title) continue;
    out.push({ videoId, title: decodeEntities(title), publishedAt: pick(block, "published") });
  }
  return out;
}

// SIEMPRE mostramos las JUGADAS del partido: goles/resumen + momentos clave
// (roja, VAR, penal, expulsión, autogol). Excluimos contenido off-field
// (previas, entrenamientos, debates, análisis de cabezas parlantes,
// celebraciones) que NO matchea estas palabras, y los "EN VIVO" (que son
// transmisiones que quedan offline). Fuente: Gol Caracol (fútbol, enfocado
// en el Mundial jun-jul 2026) → es contenido del torneo.
const HIGHLIGHT_RE =
  /\b(resumen|resumo|highlights?|golazos?|goles?|goals?|gol\b|gol de|autogol|todos los goles|all goals|penal(es|ti|tis)?|expuls\w+|tarjeta roja|roja\b|var\b)\b/i;

// Excluye transmisiones en vivo / replays de stream (quedan "offline").
const LIVE_RE = /\b(en vivo|en directo|live stream|en\s+directo|live:)\b/i;

function isHighlight(title: string): boolean {
  return HIGHLIGHT_RE.test(title) && !LIVE_RE.test(title);
}

// Construye el objeto de video desde un row guardado en la pila
// (worldcup_highlights). Los URLs se derivan del videoId.
export function buildHighlightVideo(row: {
  video_id: string;
  title: string;
  channel: string;
  published_at: string | null;
}): HighlightVideo {
  return {
    videoId: row.video_id,
    title: row.title,
    channel: row.channel,
    publishedAt: row.published_at,
    thumbnail: `https://i.ytimg.com/vi/${row.video_id}/hqdefault.jpg`,
    embedUrl: `https://www.youtube.com/embed/${row.video_id}`,
    watchUrl: `https://www.youtube.com/watch?v=${row.video_id}`,
  };
}

async function fetchChannelFeed(channelId: string): Promise<RawEntry[]> {
  try {
    const res = await fetch(`${RSS_BASE}?channel_id=${channelId}`, {
      headers: { accept: "application/atom+xml, application/xml" },
      // 15 min: queremos descubrir un resumen nuevo rápido (antes de que se
      // entierre en las 15 del RSS); el Data Cache lo comparte global.
      next: { revalidate: 900 },
    });
    if (!res.ok) return [];
    return parseYoutubeFeed(await res.text());
  } catch {
    return [];
  }
}

/**
 * Highlights/resúmenes/goles del Mundial desde los canales de broadcasters,
 * embebibles inline, más recientes primero. [] ante cualquier fallo.
 */
export async function fetchWorldCupHighlights(): Promise<HighlightVideo[]> {
  const perChannel = await Promise.all(
    BROADCASTER_CHANNELS.map(async (ch) => {
      const entries = await fetchChannelFeed(ch.id);
      return entries
        .filter((e) => isHighlight(e.title))
        .map<HighlightVideo>((e) => ({
          videoId: e.videoId,
          title: e.title,
          channel: ch.name,
          publishedAt: e.publishedAt,
          thumbnail: `https://i.ytimg.com/vi/${e.videoId}/hqdefault.jpg`,
          embedUrl: `https://www.youtube.com/embed/${e.videoId}`,
          watchUrl: `https://www.youtube.com/watch?v=${e.videoId}`,
        }));
    }),
  );

  // Aplanar + dedupe por videoId + ordenar por fecha desc.
  const seen = new Set<string>();
  const all: HighlightVideo[] = [];
  for (const list of perChannel) {
    for (const v of list) {
      if (seen.has(v.videoId)) continue;
      seen.add(v.videoId);
      all.push(v);
    }
  }
  all.sort((a, b) => {
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return tb - ta;
  });
  return all.slice(0, 12);
}
