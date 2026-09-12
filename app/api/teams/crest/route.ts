import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
const MAX_BYTES = 512 * 1024;
const fail = (status: number) => new Response(null, {status, headers: {'Cache-Control':'no-store'}});

/** Public club image only: no session, DB, arbitrary URLs, redirects or API keys. */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('espn');
  if (request.nextUrl.searchParams.size !== 1 || !id || !/^[1-9]\d{0,7}$/.test(id)) return fail(400);
  try {
    const upstream = await fetch(`https://a.espncdn.com/i/teamlogos/soccer/500/${id}.png`, {
      redirect: 'error', signal: AbortSignal.timeout(8000), next: {revalidate: 604800},
    });
    if (!upstream.ok) return fail(502);
    if (upstream.headers.get('content-type')?.split(';')[0] !== 'image/png'
      || Number(upstream.headers.get('content-length')) > MAX_BYTES) {
      await upstream.body?.cancel();
      return fail(502);
    }
    const reader = upstream.body?.getReader();
    if (!reader) return fail(502);
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) { await reader.cancel(); return fail(502); }
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks);
    if (!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return fail(502);
    return new Response(bytes, {headers: {
      'Content-Type':'image/png', 'X-Content-Type-Options':'nosniff',
      'Cache-Control':'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
    }});
  } catch { return fail(502); }
}
