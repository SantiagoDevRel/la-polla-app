import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { loadFootballDate } from '@/lib/api-football/feed';
import { footballMatch } from '@/lib/api-football/detail-model';

export async function GET(request: NextRequest) {
  const {data:{user}}=await (await createClient()).auth.getUser();
  if (!user) return NextResponse.json({error:'No autorizado'},{status:401});
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota'}).format(new Date());
  const date=request.nextUrl.searchParams.get('date')??today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))
    || new Date(date).toISOString().slice(0,10)!==date || Math.abs(Date.parse(date)-Date.parse(today))>6*86400000) {
    return NextResponse.json({error:'Fecha fuera del calendario disponible'},{status:400});
  }
  // A Colombian calendar day spans TWO UTC feeds; fixtures at 00:30 UTC belong to yesterday here.
  const nextDate=new Date(Date.parse(date)+86400000).toISOString().slice(0,10);
  const feeds=await Promise.all([loadFootballDate(date),loadFootballDate(nextDate)]);
  if (feeds.every(f=>!f)) return NextResponse.json({error:'No pudimos actualizar los partidos. Intenta de nuevo.'},{status:503});
  const from=Date.parse(`${date}T05:00:00Z`),to=from+86400000;
  const matches=feeds.flatMap(f=>f?.fixtures??[]).filter(f=>Date.parse(f.fixture.date)>=from&&Date.parse(f.fixture.date)<to).map(footballMatch);
  return NextResponse.json({matches:matches.sort((a,b)=>a.date.localeCompare(b.date)),
    fetchedAt:feeds.filter(f=>f!==null).map(f=>f.fetchedAt).sort()[0],
    stale:feeds.some(f=>!f||f.stale),date},{headers:{'Cache-Control':'private, no-store'}});
}
