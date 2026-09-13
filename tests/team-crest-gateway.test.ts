import {afterEach, expect, it, vi} from 'vitest';
import {NextRequest} from 'next/server';
import {GET} from '@/app/api/teams/crest/route';
import {crestFallbackSource} from '@/lib/teams/crest-source';
const png = Buffer.from([137,80,78,71,13,10,26,10,0]);
afterEach(()=>vi.unstubAllGlobals());
it('uses the same-origin fallback for new ESPN clubs',()=>{
  expect(crestFallbackSource('https://a.espncdn.com/i/teamlogos/soccer/500/83.png')).toBe('/api/teams/crest?espn=83');
  expect(crestFallbackSource('https://a.espncdn.com/i/teamlogos/soccer/500/21922.png')).toBe('/api/teams/crest?espn=21922');
  expect(crestFallbackSource('/team-crests/local.webp')).toBe('/team-crests/local.webp');
});
it.each(['url=http://127.0.0.1','espn=../secret','espn=83&url=https://evil.test','espn=83&espn=84','espn=0','espn=083','espn=999999999','espn=83.png'])('rejects arbitrary targets: %s',async(query)=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  expect((await GET(new NextRequest(`http://localhost/api/teams/crest?${query}`))).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});
it('fetches only the fixed CDN URL without cookies or credentials and returns a cacheable PNG',async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response(png,{headers:{'Content-Type':'image/png'}}));vi.stubGlobal('fetch',fetch);
  const r=await GET(new NextRequest('http://localhost/api/teams/crest?espn=83'));
  expect(r.status).toBe(200);expect(r.headers.get('Content-Type')).toBe('image/png');expect(r.headers.get('Cache-Control')).toContain('s-maxage=604800');
  expect(fetch).toHaveBeenCalledWith('https://a.espncdn.com/i/teamlogos/soccer/500/83.png',expect.objectContaining({redirect:'error'}));
  expect(fetch.mock.calls[0][1].headers).toBeUndefined();
});
it.each([
  ()=>new Response('<html>error</html>',{headers:{'Content-Type':'text/html'}}),
  ()=>new Response('fake PNG',{headers:{'Content-Type':'image/png'}}),
  ()=>new Response(new Uint8Array(512*1024+1),{headers:{'Content-Type':'image/png'}}),
  ()=>new Response(null,{status:404}),
])('fails without caching errors or excessive responses',async(makeResponse)=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(makeResponse()));
  const r=await GET(new NextRequest('http://localhost/api/teams/crest?espn=83'));
  expect(r.status).toBe(502);expect(r.headers.get('Cache-Control')).toBe('no-store');
});
