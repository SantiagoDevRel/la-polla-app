import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadFootballDate } from '@/lib/api-football/feed';
import { loadFootballDetail } from '@/lib/api-football/details';
import { linkedFixtureId, resolveResultFixture, type LinkedResultMatch } from '@/lib/api-football/results';

const NO_STORE = {headers:{'Cache-Control':'private, no-store'}};
const EMPTY = {summary:null,source:null};

/**
 * Detalle de un partido de `matches` (pollas y fichas por UUID), solo desde
 * API-Football (2026-09-13). Una fila vinculada ('apifootball:<id>') usa su id
 * de fixture; una fila sin vínculo pasa por la identidad estricta de nombres,
 * competición y hora. La respuesta es FootballDetail (con `summary`, que lee
 * LiveMatchPopup) o {summary:null} si no hay detalle confiable.
 */
export async function GET(_request: NextRequest,{params}:{params:Promise<{id:string}>}) {
  const {data:{user}}=await (await createClient()).auth.getUser();
  if (!user) return NextResponse.json({error:'No autorizado'},{status:401});
  const {id}=await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({error:'Partido inválido'},{status:400});
  const {data,error}=await createAdminClient().from('matches')
    .select('id,tournament,external_id,source_external_ids,scheduled_at,home_team,away_team')
    .eq('id',id).maybeSingle();
  if(error||!data) return NextResponse.json({error:'Partido no encontrado'},{status:error?500:404});
  const match=data as LinkedResultMatch&{id:string};
  try {
    const linked=linkedFixtureId(match);
    // Dos fixtures distintos en una fila = identidad duplicada: no se muestra nada.
    if(linked==='ambiguous') return NextResponse.json(EMPTY,NO_STORE);
    let detail=linked?await loadFootballDetail(linked):null;
    if(!detail){
      // El fixture aún no está en la caché compartida (o la fila no tiene vínculo):
      // el feed de su fecha (±7 días, cuota reservada en SQL) lo descubre.
      const feed=await loadFootballDate(new Date(match.scheduled_at).toISOString().slice(0,10));
      const fixture=feed?resolveResultFixture(match,feed.fixtures):null;
      detail=fixture?await loadFootballDetail(fixture.fixture.id):null;
    }
    if(detail && detail.match.tournament===match.tournament) return NextResponse.json(detail,NO_STORE);
  } catch { /* Sin detalle confiable: mismo contrato vacío que antes. */ }
  return NextResponse.json(EMPTY,NO_STORE);
}
