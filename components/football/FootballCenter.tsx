"use client";
import { useState } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { CalendarDays, ChevronDown, ChevronRight, Search, X } from 'lucide-react';
import { TeamCrest } from '@/components/match/TeamCrest';
import { TOURNAMENTS, getTournamentName } from '@/lib/tournaments';
import { RESULT_LEAGUES } from '@/lib/api-football/results';
import { isLiveStatus, type FootballMatch } from '@/lib/api-football/detail-model';
import { teamNameKey } from '@/lib/teams/team-name-key';
import { TEAM_SEARCH_MIN_LENGTH, searchTeams, type CatalogTeam } from '@/lib/teams/team-search';
import { FootballEmpty, FootballLoading, FootballMatchCard, FootballLeagueLogo, useFootballResource } from './shared';

interface CalendarResponse {matches:FootballMatch[];date:string;fetchedAt:string;stale:boolean}
const bogotaToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota'}).format(new Date());
const offsetDate=(date:string,days:number)=>new Date(Date.parse(date)+days*86400000).toISOString().slice(0,10);
const TEAM_RESULTS=6;

export default function FootballCenter({teams}:{teams:readonly CatalogTeam[]}) {
 const locale=useLocale(),en=locale==='en';
 const [today]=useState(bogotaToday),[date,setDate]=useState(bogotaToday),[league,setLeague]=useState('all'),[live,setLive]=useState(false),[query,setQuery]=useState('');
 const {data,error,loading,reload}=useFootballResource<CalendarResponse>(`/api/football?date=${date}`);
 const tournaments=TOURNAMENTS.filter(t=>RESULT_LEAGUES[t.slug]);
 const search=query.trim(),searchKey=teamNameKey(search);
 const matches=(data?.matches??[]).filter(m=>(league==='all'||m.tournament===league)&&(!live||isLiveStatus(m.status))&&(!searchKey||[m.home,m.away].some(team=>teamNameKey(team.name).includes(searchKey))));
 const teamResults=searchKey.length>=TEAM_SEARCH_MIN_LENGTH?searchTeams(teams,search,league,TEAM_RESULTS):null;
 const teamStatus=!teamResults?'':teamResults.total===0?(en?`No teams found for «${search}».`:`No encontramos equipos con «${search}».`):
  teamResults.total>TEAM_RESULTS?(en?`Showing ${TEAM_RESULTS} of ${teamResults.total}`:`Mostrando ${TEAM_RESULTS} de ${teamResults.total}`):
  `${teamResults.total} ${en?(teamResults.total===1?'result':'results'):(teamResults.total===1?'resultado':'resultados')}`;
 const emptyMessage=!search?(en?'Choose another date or competition.':'Prueba otra fecha o elige otro torneo.'):
  (en?`No matches for «${search}» on this date.`:`No hay partidos de «${search}» en esta fecha.`)+(teamResults?.total?(en?' Tap a team to see its upcoming matches.':' Toca un equipo para ver sus próximos partidos.'):'');
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
   {/* Side by side only while both controls fit at the current text size (em tracks), so 200% text stacks them. */}
   <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12.5em),1fr))] gap-4 text-[15px]">
    <label className="block min-w-0 space-y-1 text-[13px] text-text-secondary"><span>{en?'Competitions':'Torneos'}</span>
     <select value={league} onChange={e=>setLeague(e.target.value)} className="lp-input block min-h-11 w-full text-[15px]">
      <option value="all">{en?'All':'Todos'}</option>
      {tournaments.map(t=><option key={t.slug} value={t.slug}>{getTournamentName(t.slug,locale).replace('Champions League','Champions').replace('Premier League','Premier').replace('Copa ','').replace('Liga BetPlay','BetPlay')}</option>)}
     </select>
    </label>
    <div className="min-w-0 space-y-1">
     <label htmlFor="futbol-buscar-equipo" className="block text-[13px] text-text-secondary">{en?'Teams':'Equipos'}</label>
     <span className="relative block">
      <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary"/>
      {/* Own clear button instead of the native one: Chrome paints it blue and it is tiny on phones. */}
      <input id="futbol-buscar-equipo" type="search" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}
       placeholder={en?'Search a team':'Busca un equipo'} enterKeyHint="search" autoComplete="off" spellCheck={false} className="lp-input block min-h-11 w-full !pl-11 !pr-12 text-[15px] [&::-webkit-search-cancel-button]:hidden"/>
      {query&&<button type="button" onClick={()=>setQuery('')} aria-label={en?'Clear search':'Borrar búsqueda'}
       className="absolute inset-y-0 right-1 my-auto flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-bg-card hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">
       <X aria-hidden="true" className="h-5 w-5"/>
      </button>}
     </span>
    </div>
   </div>
   <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px] text-text-primary">
    <input type="checkbox" checked={live} onChange={e=>setLive(e.target.checked)} className="h-5 w-5 shrink-0 accent-turf"/>{en?'Only live matches':'Solo partidos en vivo'}
   </label>
  </div>
  <p role="status" className="sr-only">{teamStatus}</p>
  {teamResults&&<section aria-labelledby="futbol-equipos-titulo" className="lp-card space-y-3 p-4">
   <div className="space-y-1">
    <h2 id="futbol-equipos-titulo" className="font-display text-[20px] tracking-wide text-text-primary">{en?'Teams':'Equipos'}</h2>
    <p aria-hidden="true" className="text-[13px] leading-relaxed text-text-secondary [overflow-wrap:anywhere]">{teamStatus}</p>
   </div>
   {teamResults.results.length>0&&<ul className="-mx-2 space-y-1">
    {teamResults.results.map(team=><li key={team.id}>
     <Link href={`/futbol/equipos/${team.id}`} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-bg-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-turf">
      <TeamCrest team={team.name} src={team.logo} className="h-8 w-8"/>
      <span className="min-w-0 flex-1">
       <span className="block text-[15px] font-semibold text-text-primary [overflow-wrap:anywhere]">{team.name}</span>
       <span className="block text-[13px] leading-relaxed text-text-secondary [overflow-wrap:anywhere]">{tournaments.filter(t=>team.tournaments.includes(t.slug)).map(t=>getTournamentName(t.slug,locale)).join(' · ')}</span>
      </span>
      <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-text-secondary"/>
     </Link>
    </li>)}
   </ul>}
  </section>}
  {loading?<FootballLoading/>:error&&!data?<FootballEmpty title={en?'Unable to load':'No pudimos cargar los partidos'} message={en?'Check your connection and try again.':'Revisa tu conexión e intenta de nuevo.'} onRetry={reload}/>:
   matches.length===0?<FootballEmpty title={en?'No matches here':'No hay partidos para esta selección'} message={emptyMessage} onRetry={()=>{setLive(false);setLeague('all');setDate(today);setQuery('');}}/>:
   tournaments.map(t=>{
    const group=matches.filter(m=>m.tournament===t.slug);if(!group.length)return null;
    return <section key={t.slug} className="space-y-3" aria-label={getTournamentName(t.slug,locale)}>
     <h2 className="flex items-center gap-3 font-display text-[20px] tracking-wide text-text-primary"><FootballLeagueLogo tournament={t.slug}/><span className="min-w-0 [overflow-wrap:anywhere]">{getTournamentName(t.slug,locale)}</span></h2>
     {group.map(m=><FootballMatchCard key={m.id} match={m}/>)}
    </section>;
   })}
  {/* (2026-09-17) Sin letrero de hora de consulta: solo avisamos si no se pudo actualizar. */}
  {data&&(error||data.stale)&&<p className="text-center text-[13px] leading-relaxed text-amber">{error?(en?'Unable to refresh. Showing the last available information.':'No pudimos actualizar. Mostramos la última información disponible.'):(en?'Waiting for an update.':'Esperando una actualización.')}</p>}
 </main>;
}
