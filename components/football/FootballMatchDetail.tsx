"use client";
import Link from 'next/link';
import { useState } from 'react';
import { useLocale } from 'next-intl';
import { BarChart3, ChevronDown, ChevronRight, List, MapPin, Users } from 'lucide-react';
import { TeamCrest } from '@/components/match/TeamCrest';
import { getTournamentName } from '@/lib/tournaments';
import { eventLabel, positionLabel, statLabel } from '@/lib/espn/labels-es';
import { isLiveStatus, type FootballDetail, type PlayerPerformance } from '@/lib/api-football/detail-model';
import { FootballBack, FootballEmpty, FootballLoading, FootballPhoto, FootballLeagueLogo, statusLabel, useFootballResource } from './shared';
import { FootballEventIcon, FootballStatIcon } from './FootballIcons';
import { FootballOptions } from './FootballOptions';
import { footballStatGroups } from '@/lib/football-stat-groups';

export function FootballPlayerRow({player}:{player:PlayerPerformance}) {
 const locale=useLocale(),en=locale==='en';
 const metrics=[{kind:'minutes',label:en?'Minutes':'Minutos',value:player.minutes},{kind:'goals',label:en?'Goals':'Goles',value:player.goals},
  {kind:'assists',label:en?'Assists':'Asistencias',value:player.assists},{kind:'rating',label:en?'Rating':'Calificación',value:player.rating},
  {kind:'yellow',label:en?'Yellow cards':'Amarillas',value:player.yellow},{kind:'red',label:en?'Red cards':'Rojas',value:player.red}];
 return <details className="group rounded-xl border border-border-subtle bg-bg-elevated/50 p-3">
  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-turf [&::-webkit-details-marker]:hidden">
   <FootballPhoto src={player.headshot} name={player.name} number={player.jersey}/>
   <div className="min-w-0 flex-1"><p className="text-[15px] font-semibold text-text-primary [overflow-wrap:anywhere]">{player.name}</p>
    <p className="text-[13px] text-text-secondary">{player.jersey!=null?`#${player.jersey} · `:''}{positionLabel(player.pos,locale)}</p>
   </div><ChevronDown className="h-4 w-4 shrink-0 text-text-muted transition-transform group-open:rotate-180"/>
  </summary>
  <dl className="mt-3 flex flex-wrap gap-3 border-t border-border-subtle pt-3">
   {metrics.map(m=><div key={m.label} className="min-w-fit flex-1 basis-[40%]"><dt className="flex items-center gap-1.5 text-[13px] text-text-secondary"><FootballStatIcon kind={m.kind}/>{m.label}</dt><dd className="text-[15px] font-semibold tabular-nums text-text-primary">{m.value??'—'}</dd></div>)}
  </dl>
 </details>;
}

export default function FootballMatchDetail({id,initialLineup=false,initialSide='home'}:{id:string;initialLineup?:boolean;initialSide?:'home'|'away'}) {
 const locale=useLocale(),en=locale==='en';
 const endpoint=/^\d+$/.test(id)?`/api/football/matches/${id}`:`/api/matches/${id}/live`;
 const {data,error,loading,reload}=useFootballResource<FootballDetail>(endpoint,30_000);
 const [view,setView]=useState<'summary'|'stats'|'lineup'>(initialLineup?'lineup':'stats'),[side,setSide]=useState<'home'|'away'>(initialSide);
 const [statGroup,setStatGroup]=useState('general'),[playersView,setPlayersView]=useState<'starters'|'bench'>('starters');
 if(loading)return <main className="space-y-4 px-4"><FootballBack/><FootballLoading/></main>;
 if(!data?.match)return <main className="space-y-4 px-4"><FootballBack/><FootballEmpty title={en?'Match information unavailable':'Información del partido no disponible'} message={en?'Try again shortly.':'Intenta de nuevo en unos momentos.'} onRetry={reload}/></main>;
 const m=data.match,lineup=data.summary.lineups.find(l=>l.side===side);
 const groups=footballStatGroups(data.summary.stats);
 const selectedStats=groups.find(g=>g.id===statGroup)??groups[0];
 return <main className="space-y-4 px-4 pb-4 [overflow-wrap:anywhere]">
  <FootballBack/>
  <section className="lp-card space-y-4 p-3" aria-label={en?'Score':'Marcador'}>
   <h1 className="flex items-center justify-center gap-2 text-center font-display text-[20px] tracking-wide text-text-primary"><FootballLeagueLogo tournament={m.tournament}/>{getTournamentName(m.tournament,locale)}</h1>
   <div className="grid grid-cols-[minmax(0,1fr)_4rem_minmax(0,1fr)] items-start gap-1 text-center" data-match-teams>
    {([m.home,m.away]).map((team,index)=><Link key={team.id} href={`/futbol/equipos/${team.id}`} aria-label={`${en?'View team':'Ver equipo'}: ${team.name}`} className={`flex min-w-0 flex-col items-center gap-2 rounded-xl border border-border-subtle bg-bg-elevated/50 py-3 text-text-primary transition-colors hover:bg-bg-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-turf ${index===0?'col-start-1 row-start-1':'col-start-3 row-start-1'}`}>
     <TeamCrest team={team.name} src={team.logo} className="h-12 w-12 shrink-0"/>
     <span data-match-team-name className="w-full text-center text-[15px] font-semibold leading-snug [overflow-wrap:anywhere]">{team.name}</span>
     <span className="flex flex-wrap items-center justify-center gap-0.5 text-center text-[13px] font-medium text-text-secondary">{en?'View team':'Ver equipo'}<ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true"/></span>
    </Link>)}
    <div className="col-start-2 row-start-1 space-y-1 pt-3 text-center">
     <p className="whitespace-nowrap font-display !text-[36px] leading-tight tabular-nums tracking-wide text-text-primary [-webkit-text-size-adjust:none]" aria-label={`${m.home.name} ${m.score.home??'—'}, ${m.away.name} ${m.score.away??'—'}`}>{m.score.home??'—'}–{m.score.away??'—'}</p>
    </div>
   </div>
   <p className={`text-center text-[13px] font-semibold ${isLiveStatus(m.status)?'text-turf':'text-text-secondary'}`}>{statusLabel(m,locale)}</p>
   {['ET','BT','P','AET','PEN'].includes(m.status)&&<div className="space-y-1 rounded-xl bg-bg-elevated p-3 text-center text-[13px] text-text-secondary">
    <p>{en?'90-minute score':'Marcador a los 90 minutos'}: {m.regulation.home??'—'}–{m.regulation.away??'—'}</p>
    {m.penalty.home!=null&&m.penalty.away!=null&&<p>{en?'Penalty shootout':'Tanda de penales'}: {m.penalty.home}–{m.penalty.away}</p>}
   </div>}
   <div className="space-y-2 border-t border-border-subtle pt-3 text-[13px] text-text-secondary">
    <p>{new Intl.DateTimeFormat(en?'en-US':'es-CO',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Bogota'}).format(new Date(m.date))} · {en?'Colombia time':'Hora de Colombia'}</p>
    {m.venue&&<p className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0"/>{m.venue}</p>}
   </div>
  </section>
  <div className="flex overflow-x-auto rounded-xl border border-border-subtle bg-bg-card/90 p-1" role="tablist" aria-label={en?'Match information':'Información del partido'}>
   {(['stats','lineup','summary'] as const).map((tab,i)=>{
    const Icon=[BarChart3,Users,List][i];
    return <button key={tab} id={`match-tab-${tab}`} type="button" role="tab" aria-selected={view===tab} aria-controls="match-panel" tabIndex={view===tab?0:-1}
     onClick={()=>setView(tab)} onFocus={e=>e.currentTarget.scrollIntoView({block:'nearest',inline:'nearest'})}
     onKeyDown={e=>{
      const direction=e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0;
      if(!direction&&e.key!=='Home'&&e.key!=='End')return;
      e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?2:(i+direction+3)%3;
      const button=e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next];button?.click();button?.focus();
     }}
     className={`flex min-h-16 min-w-max flex-1 flex-col items-center justify-center gap-1.5 rounded-lg px-1.5 py-2 text-[15px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-turf cursor-pointer ${view===tab?'bg-text-primary text-bg-base':'text-text-secondary hover:bg-bg-elevated'}`}>
     <Icon className="h-5 w-5 shrink-0" aria-hidden="true"/>
     {(en?['Statistics','Lineups','Summary']:['Estadísticas','Alineaciones','Resumen'])[i]}
    </button>;
   })}
  </div>
  <div id="match-panel" role="tabpanel" aria-labelledby={`match-tab-${view}`} tabIndex={0} className="rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-turf">
  {view==='summary'&&<section className="lp-card space-y-3 p-4">
   <h2 className="font-display text-[20px] tracking-wide text-text-primary">{en?'Summary':'Resumen'}</h2>
   {data.summary.timeline.length===0?<p className="text-[15px] leading-relaxed text-text-secondary">{en?'Events will appear here as they become available.':'Aquí aparecerán los goles, las tarjetas y los cambios cuando estén disponibles.'}</p>:
    <div role="region" aria-label={en?'Match events':'Jugadas del partido'} tabIndex={0} className="max-h-[min(55dvh,28rem)] overflow-y-auto rounded-lg pr-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-turf" data-match-timeline>
    <ol className="space-y-3">{[...data.summary.timeline].reverse().map((e,i)=><li key={i} className="flex items-start gap-3 border-b border-border-subtle pb-3 last:border-0">
     <span className="flex min-w-10 shrink-0 flex-col items-center gap-2 text-[13px] font-semibold tabular-nums text-text-secondary"><FootballEventIcon type={e.type} isGoal={e.isGoal}/>{e.minute}</span><div className="min-w-0 space-y-1">
      <p className={`text-[15px] font-semibold [overflow-wrap:anywhere] ${e.isGoal?'text-turf':'text-text-primary'}`}>{e.scorer??e.player??eventLabel(e.type,locale)}</p>
      <p className="text-[13px] text-text-secondary">{eventLabel(e.type,locale)} · {e.side==='home'?m.home.name:e.side==='away'?m.away.name:''}</p>
      {e.assist&&<p className="text-[13px] text-text-secondary">{en?'Assist':'Asistencia'}: {e.assist}</p>}{e.text&&<p className="text-[13px] text-text-secondary">{e.text}</p>}
     </div>
    </li>)}</ol></div>}
  </section>}
  {view==='stats'&&<section className="lp-card space-y-5 p-4">
   <h2 className="font-display text-[20px] tracking-wide text-text-primary">{en?'Statistics':'Estadísticas'}</h2>
   {groups.length>0&&<FootballOptions label={en?'Statistics category':'Categoría de estadísticas'} value={selectedStats.id} onChange={setStatGroup} options={groups.map(g=>({value:g.id,label:en?g.en:g.es}))}/>}
   <div className="grid grid-cols-2 gap-4 border-b border-border-subtle pb-3 text-[13px] font-medium text-text-secondary">{[m.home,m.away].map(team=><div key={team.id} className="flex min-w-0 flex-col items-center gap-1 text-center"><TeamCrest team={team.name} src={team.logo}/><span>{team.name}</span></div>)}</div>
   {data.summary.stats.length===0?<p className="text-[15px] text-text-secondary">{en?'Statistics are not available yet.':'Las estadísticas aún no están disponibles.'}</p>:
    selectedStats.stats.map(s=>{
     const h=Number.parseFloat(s.home),a=Number.parseFloat(s.away);
     return <div key={s.key} className="space-y-2"><div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 text-[15px]">
      <span className="font-semibold tabular-nums text-text-primary">{s.home}</span><span className="flex min-w-0 flex-col items-center gap-1 text-center text-text-secondary"><FootballStatIcon kind={s.key}/>{statLabel(s.key,s.label,locale)}</span><span className="font-semibold tabular-nums text-text-primary">{s.away}</span>
     </div>{Number.isFinite(h)&&Number.isFinite(a)&&<progress aria-label={statLabel(s.key,s.label,locale)} value={h} max={Math.max(h+a,1)} className="block h-1.5 w-full overflow-hidden rounded-full accent-turf [&::-webkit-progress-bar]:bg-bg-elevated [&::-webkit-progress-value]:bg-turf"/>}
     {s.key==='expectedGoals'&&<p className="text-[13px] text-text-muted">{en?'Estimates the quality of scoring chances.':'Estima la calidad de las oportunidades de gol.'}</p>}</div>;
    })}
  </section>}
  {view==='lineup'&&<section className="lp-card space-y-4 p-4">
   <h2 className="font-display text-[20px] tracking-wide text-text-primary">{en?'Lineups':'Alineaciones'}</h2>
   <div className="grid grid-cols-2 gap-2">{(['home','away'] as const).map(s=><button key={s} type="button" aria-pressed={side===s} onClick={()=>setSide(s)} className={`min-h-11 rounded-xl p-3 text-[15px] font-semibold [overflow-wrap:anywhere] cursor-pointer ${side===s?'bg-text-primary text-bg-base':'bg-bg-elevated text-text-secondary hover:text-text-primary'}`}>{m[s].name}</button>)}</div>
   {!lineup?<p className="text-[15px] leading-relaxed text-text-secondary">{en?'The lineup is not available yet. It is usually confirmed shortly before kickoff.':'La alineación aún no está disponible. Normalmente se confirma poco antes de comenzar.'}</p>:<>
    <div className="space-y-1 text-[13px] text-text-secondary">{lineup.formation&&<p>{en?'Formation':'Formación'}: <strong className="text-text-primary">{lineup.formation}</strong></p>}{data.coaches[side]&&<p>{en?'Coach':'Director técnico'}: {data.coaches[side]}</p>}</div>
    <FootballOptions label={en?'Players':'Jugadores'} value={playersView} onChange={value=>setPlayersView(value as 'starters'|'bench')} options={[{value:'starters',label:en?'Starting XI':'Titulares'},{value:'bench',label:en?'Substitutes':'Suplentes'}]}/>
    {[playersView==='starters'].map(starter=><div key={String(starter)} className="space-y-3"><h3 className="font-display text-[20px] tracking-wide text-text-primary">{starter?(en?'Starting lineup':'Titulares'):(en?'Substitutes':'Suplentes')}</h3>
     {data.players[side].filter(p=>p.starter===starter).map(p=><FootballPlayerRow key={p.id} player={p}/>)}</div>)}
   </>}
  </section>}
  </div>
  <p className={`text-center text-[13px] leading-relaxed ${error||data.stale?'text-amber':'text-text-muted'}`}>
   {error||data.stale?(en?'Waiting for an update. ':'Esperando una actualización. '):''}
   API-Football · {new Intl.DateTimeFormat(en?'en-US':'es-CO',{hour:'numeric',minute:'2-digit',timeZone:'America/Bogota'}).format(new Date(data.fetchedAt))}
  </p>
 </main>;
}
