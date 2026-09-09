"use client";
import { useState } from 'react';
import { useLocale } from 'next-intl';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { TOURNAMENTS, getTournamentName } from '@/lib/tournaments';
import { RESULT_LEAGUES } from '@/lib/api-football/results';
import { isLiveStatus, type FootballMatch } from '@/lib/api-football/detail-model';
import { FootballEmpty, FootballLoading, FootballMatchCard, FootballLeagueLogo, useFootballResource } from './shared';

interface CalendarResponse {matches:FootballMatch[];date:string;fetchedAt:string;stale:boolean}
const bogotaToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota'}).format(new Date());
const offsetDate=(date:string,days:number)=>new Date(Date.parse(date)+days*86400000).toISOString().slice(0,10);

export default function FootballCenter() {
 const locale=useLocale(),en=locale==='en';
 const [today]=useState(bogotaToday),[date,setDate]=useState(bogotaToday),[league,setLeague]=useState('all'),[live,setLive]=useState(false);
 const {data,error,loading,reload}=useFootballResource<CalendarResponse>(`/api/football?date=${date}`);
 const tournaments=TOURNAMENTS.filter(t=>RESULT_LEAGUES[t.slug]);
 const matches=(data?.matches??[]).filter(m=>(league==='all'||m.tournament===league)&&(!live||isLiveStatus(m.status)));
 const dateOptions=Array.from({length:13},(_,i)=>offsetDate(today,i-6)).map(value=>{
  const parts=new Intl.DateTimeFormat(en?'en-US':'es-CO',{month:'long',day:'2-digit',timeZone:'UTC'}).formatToParts(new Date(value));
  const month=parts.find(p=>p.type==='month')!.value,day=parts.find(p=>p.type==='day')!.value.padStart(2,'0');
  return {value,label:`${month.charAt(0).toUpperCase()+month.slice(1)} ${day}`};
 });
 return <main className="space-y-5 px-4 pb-4">
  <header className="space-y-1">
   <h1 className="font-display text-[32px] leading-tight tracking-wide text-text-primary hyphens-auto [overflow-wrap:anywhere]">{en?'Football statistics':'Estadísticas de fútbol'}</h1>
   <p className="text-[15px] leading-relaxed text-text-secondary">{en?'Scores, goals and your teams.':'Resultados, goles y tus equipos.'}</p>
  </header>
  <div className="lp-card space-y-4 p-4">
   <label className="block space-y-2 text-[13px] text-text-secondary">
    <span className="flex items-center gap-2"><CalendarDays className="h-4 w-4" aria-hidden="true"/>{en?'Date':'Fecha'}</span>
    <span className="lp-input relative flex min-h-11 w-full items-center gap-2 text-[15px] focus-within:ring-1 focus-within:ring-gold/40">
     <span aria-hidden="true" className="min-w-0 flex-1 [overflow-wrap:anywhere]">{dateOptions.find(option=>option.value===date)?.label}</span>
     <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0"/>
     <select aria-label={en?'Date':'Fecha'} value={date} onChange={e=>setDate(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
      {dateOptions.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
     </select>
    </span>
   </label>
   <label className="block space-y-1 text-[13px] text-text-secondary"><span>{en?'Competition':'Torneo'}</span>
    <select value={league} onChange={e=>setLeague(e.target.value)} className="lp-input block min-h-11 w-full text-[15px]">
     <option value="all">{en?'All':'Todos'}</option>
     {tournaments.map(t=><option key={t.slug} value={t.slug}>{getTournamentName(t.slug,locale).replace('Champions League','Champions').replace('Premier League','Premier').replace('Copa ','').replace('Liga BetPlay','BetPlay')}</option>)}
    </select>
   </label>
   <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px] text-text-primary">
    <input type="checkbox" checked={live} onChange={e=>setLive(e.target.checked)} className="h-5 w-5 shrink-0 accent-turf"/>{en?'Only live matches':'Solo partidos en vivo'}
   </label>
  </div>
  {loading?<FootballLoading/>:error&&!data?<FootballEmpty title={en?'Unable to load':'No pudimos cargar los partidos'} message={en?'Check your connection and try again.':'Revisa tu conexión e intenta de nuevo.'} onRetry={reload}/>:
   matches.length===0?<FootballEmpty title={en?'No matches here':'No hay partidos para esta selección'} message={en?'Choose another date or competition.':'Prueba otra fecha o elige otro torneo.'} onRetry={()=>{setLive(false);setLeague('all');setDate(today);}}/>:
   tournaments.map(t=>{
    const group=matches.filter(m=>m.tournament===t.slug);if(!group.length)return null;
    return <section key={t.slug} className="space-y-3" aria-label={getTournamentName(t.slug,locale)}>
     <h2 className="flex items-center gap-3 font-display text-[20px] tracking-wide text-text-primary"><FootballLeagueLogo tournament={t.slug}/><span className="min-w-0 [overflow-wrap:anywhere]">{getTournamentName(t.slug,locale)}</span></h2>
     {group.map(m=><FootballMatchCard key={m.id} match={m}/>)}
    </section>;
   })}
  {data&&<p className={`text-center text-[13px] leading-relaxed ${error||data.stale?'text-amber':'text-text-muted'}`}>
   {error?(en?'Unable to refresh. ':'No pudimos actualizar. '):''}
   {en?'Last checked':'Última consulta'}: {new Intl.DateTimeFormat(en?'en-US':'es-CO',{hour:'numeric',minute:'2-digit',timeZone:'America/Bogota'}).format(new Date(data.fetchedAt))} · {en?'Colombia time':'Hora de Colombia'}
  </p>}
 </main>;
}
