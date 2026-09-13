import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { loadFootballDetail } from '@/lib/api-football/details';

export async function GET(_request: Request,{params}:{params:Promise<{id:string}>}) {
  const {data:{user}}=await (await createClient()).auth.getUser();
  if (!user) return NextResponse.json({error:'No autorizado'},{status:401});
  const {id}=await params;
  if (!/^\d{1,10}$/.test(id)||Number(id)<=0) return NextResponse.json({error:'Partido inválido'},{status:400});
  const detail=await loadFootballDetail(Number(id));
  return NextResponse.json(detail??{error:'El detalle aún no está disponible. Intenta de nuevo.'},
    {status:detail?200:503,headers:{'Cache-Control':'private, no-store'}});
}
