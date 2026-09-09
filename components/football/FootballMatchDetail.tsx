"use client";
import Link from 'next/link';
import { useState } from 'react';
import { useLocale } from 'next-intl';
import { ChevronDown, MapPin } from 'lucide-react';
import { TeamCrest } from '@/components/match/TeamCrest';
import { getTournamentName } from '@/lib/tournaments';
import { eventLabel, positionLabel, statLabel } from '@/lib/espn/labels-es';
import { isLiveStatus, type FootballDetail, type PlayerPerformance } from '@/lib/api-football/detail-model';
import { FootballBack, FootballEmpty, FootballLoading, FootballPhoto, FootballLeagueLogo, statusLabel, useFootballResource } from './shared';

export function FootballPlayerRow({player}:{player:PlayerPerformance}) {
 const locale=useLocale(),en=locale==='en';
 const metrics=[{label:en?'Minutes':'Minutos',value:player.minutes},{label:en?'Goals':'Goles',value:player.goals},
  {label:en?'Assists':'Asistencias',value:player.assists},{label:en?'Rating':'Calificación',value:player.rating},
  {label:en?'Yellow cards':'Amarillas',value:player.yellow},{label:en?'Red cards':'Rojas',value:player.red}];
 return <details className="group rounded-xl border border-border-subtle bg-bg-elevated/50 p-3">
  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-turf [&::-webkit-details-marker]:hidden">
   <FootballPhoto src={player.headshot} name={player.name} number={player.jersey}/>
   <div className="min-w-0 flex-1"><p className="text-[15px] font-semibold text-text-primary [overflow-wrap:anywhere]">{player.name}</p>
    <p className="text-[13px] text-text-secondary">{player.jersey!=null?`#${player.jersey} · `:''}{positionLabel(player.pos,locale)}</p>
   </div><ChevronDown className="h-4 w-4 shrink-0 text-text-muted transition-transform group-open:rotate-180"/>
  </summary>
  <dl className="mt-3 flex flex-wrap gap-3 border-t border-border-subtle pt-3">
   {metrics.map(m=><div key={m.label} className="min-w-fit flex-1 basis-[40%]"><dt className="text-[13px] text-text-secondary">{m.label}</dt><dd className="text-[15px] font-semibold tabular-nums text-text-primary">{m.value??'—'}</dd></div>)}
  </dl>
 </details>;
}

export default function FootballMatchDetail({id,initialLineup=false,initialSide='home'}:{id:string;initialLineup?:boolean;initialSide?:'home'|'away'}) {
 const locale=useLocale(),en=locale==='en';
 const endpoint=/^\d+$/.test(id)?`/api/football/matches/${id}`:`/api/matches/${id}/live`;
 const {data,error,loading,reload}=useFootballResource<FootballDetail>(endpoint,30_000);
 const [view,setView]=useState<'summary'|'stats'|'lineup'>(initialLineup?'lineup':'summary'),[side,setSide]=useState<'home'|'away'>(initialSide);
 if(loading)return <main className="space-y-4 px-4"><FootballBack/><FootballLoading/></main>;
 if(!data?.match)return <main className="space-y-4 px-4"><FootballBack/><FootballEmpty title={en?'Match information unavailable':'Información del partido no disponible'} message={en?'Try again shortly.':'Intenta de nuevo en unos momentos.'} onRetry={reload}/></main>;
 const m=data.match,goals=data.summary.timeline.filter(e=>e.isGoal),lineup=data.summary.lineups.find(l=>l.side===side);
 return <main className="space-y-4 px-4 pb-4 [overflow-wrap:anywhere]">
  <FootballBack/>
  <section className="lp-card space-y-4 p-4" aria-label={en?'Score':'Marcador'}>
   <div className="space-y-2 text-center"><h1 className="flex flex-col items-center gap-2 font-display text-[24px] tracking-wide text-text-primary"><FootballLeagueLogo tournament={m.tournament}/>{getTournamentName(m.tournament,locale)}</h1>
    <p className={`text-[13px] font-semibold ${isLiveStatus(m.status)?'text-turf':'text-text-secondary'}`}>{statusLabel(m,locale)}</p>
   </div>
   <p className="text-center font-display text-[40px] tabular-nums tracking-wide text-text-primary" aria-label={`${m.home.name} ${m.score.home??'—'}, ${m.away.name} ${m.score.away??'—'}`}>{m.score.home??'—'} – {m.score.away??'—'}</p>
   <div className="flex items-center justify-between gap-3 px-3">
    <Link href={`/futbol/equipos/${m.home.id}`} aria-label={`${en?'View team':'Ver equipo'}: ${m.home.name}`} className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full hover:bg-bg-elevated"><TeamCrest team={m.home.name} src={m.home.logo} className="h-12 w-12"/></Link>
    <Link href={`/futbol/equipos/${m.away.id}`} aria-label={`${en?'View team':'Ver equipo'}: ${m.away.name}`} className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full hover:bg-bg-elevated"><TeamCrest team={m.away.name} src={m.away.logo} className="h-12 w-12"/></Link>
   </div>
   <div className="grid grid-cols-2 gap-6 text-center text-[15px] font-semibold text-text-primary">
    <Link href={`/futbol/equipos/${m.home.id}`} className="min-h-11 [overflow-wrap:anywhere] hover:underline">{m.home.name}</Link>
    <Link href={`/futbol/equipos/${m.away.id}`} className="min-h-11 [overflow-wrap:anywhere] hover:underline">{m.away.name}</Link>
   </div>
   {['ET','BT','P','AET','PEN'].includes(m.status)&&<div className="space-y-1 rounded-xl bg-bg-elevated p-3 text-center text-[13px] text-text-secondary">
    <p>{en?'90-minute score':'Marcador a los 90 minutos'}: {m.regulation.home??'—'}–{m.regulation.away??'—'}</p>
    {m.penalty.home!=null&&m.penalty.away!=null&&<p>{en?'Penalty shootout':'Tanda de penales'}: {m.penalty.home}–{m.penalty.away}</p>}
   </div>}
   <div className="space-y-2 border-t border-border-subtle pt-3 text-[13px] text-text-secondary">
    <p>{new Intl.DateTimeFormat(en?'en-US':'es-CO',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Bogota'}).format(new Date(m.date))} · {en?'Colombia time':'Hora de Colombia'}</p>
    {m.venue&&<p className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0"/>{m.venue}</p>}
   </div>
  </section>
  {goals.length>0&&<section className="lp-card space-y-3 p-4" aria-label={en?'Goals':'Goles'}>
   <h2 className="font-display text-[20px] tracking-wide text-text-primary">{en?'Goals':'Goles'}</h2>
   {goals.map((g,i)=><div key={i} className="flex items-start gap-3"><span className="min-w-10 shrink-0 text-[15px] font-semibold tabular-nums text-turf">{g.minute}</span><div className="min-w-0"><p className="text-[15px] font-semibold text-text-primary [overflow-wrap:anywhere]">{g.scorer??eventLabel(g.type,locale)}</p><p className="text-[13px] text-text-secondary">{g.side==='home'?m.home.name:g.side==='away'?m.away.name:''}{g.type==='Own Goal'?` · ${en?'Own goal':'Autogol'}`:''}</p></div></div>)}
  </section>}
  <div className="grid grid-cols-1 gap-2" role="group" aria-label={en?'Match information':'Información del partido'}>
   {(['summary','stats','lineup'] as const).map((tab,i)=><button key={tab} type="button" aria-pressed={view===tab} onClick={()=>setView(tab)} className={`min-h-11 rounded-full px-4 py-3 text-[15px] font-semibold transition-colors cursor-pointer ${view===tab?'bg-text-primary text-bg-base':'border border-border-subtle bg-bg-card/80 text-text-secondary hover:bg-bg-elevated'}`}>
    {(en?['Goals and events','View statistics','View lineups']:['Goles y jugadas','Ver estadísticas','Ver alineaciones'])[i]}
   </button>)}
  </div>
  {view==='summary'&&<section className="lp-card space-y-3 p-4">
   <h2 className="font-display text-[20px] tracking-wide text-text-primary">{en?'Match events':'Minuto a minuto'}</h2>
   {data.summary.timeline.length===0?<p className="text-[15px] leading-relaxed text-text-secondary">{en?'Events will appear here as they become available.':'Aquí aparecerán los goles, las tarjetas y los cambios cuando estén disponibles.'}</p>:
    <ol className="space-y-3">{[...data.summary.timeline].reverse().map((e,i)=><li key={i} className="flex items-start gap-3 border-b border-border-subtle pb-3 last:border-0">
     <span className="min-w-10 shrink-0 text-[13px] font-semibold tabular-nums text-text-secondary">{e.minute}</span><div className="min-w-0 space-y-1">
      <p className={`text-[15px] font-semibold [overflow-wrap:anywhere] ${e.isGoal?'text-turf':'text-text-primary'}`}>{e.scorer??e.player??eventLabel(e.type,locale)}</p>
      <p className="text-[13px] text-text-secondary">{eventLabel(e.type,locale)} · {e.side==='home'?m.home.name:e.side==='away'?m.away.name:''}</p>
      {e.assist&&<p className="text-[13px] text-text-secondary">{en?'Assist':'Asistencia'}: {e.assist}</p>}{e.text&&<p className="text-[13px] text-text-secondary">{e.text}</p>}
     </div>
    </li>)}</ol>}
  </section>}
  {view==='stats'&&<section className="lp-card space-y-5 p-4">
   <h2 className="font-display text-[20px] tracking-wide text-text-primary">{en?'Statistics':'Estadísticas'}</h2>
   {data.summary.stats.length===0?<p className="text-[15px] text-text-secondary">{en?'Statistics are not available yet.':'Las estadísticas aún no están disponibles.'}</p>:
    data.summary.stats.map(s=>{
     const h=Number.parseFloat(s.home),a=Number.parseFloat(s.away);
     return <div key={s.key} className="space-y-2"><div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 text-[15px]">
      <span className="font-semibold tabular-nums text-text-primary">{s.home}</span><span className="text-center text-text-secondary">{statLabel(s.key,s.label,locale)}</span><span className="font-semibold tabular-nums text-text-primary">{s.away}</span>
     </div>{Number.isFinite(h)&&Number.isFinite(a)&&<progress aria-label={statLabel(s.key,s.label,locale)} value={h} max={Math.max(h+a,1)} className="block h-1.5 w-full overflow-hidden rounded-full accent-turf [&::-webkit-progress-bar]:bg-bg-elevated [&::-webkit-progress-value]:bg-turf"/>}
     {s.key==='expectedGoals'&&<p className="text-[13px] text-text-muted">{en?'Estimates the quality of scoring chances.':'Estima la calidad de las oportunidades de gol.'}</p>}</div>;
    })}
  </section>}
  {view==='lineup'&&<section className="lp-card space-y-4 p-4">
   <h2 className="font-display text-[20px] tracking-wide text-text-primary">{en?'Lineups':'Alineaciones'}</h2>
   <div className="grid grid-cols-2 gap-2">{(['home','away'] as const).map(s=><button key={s} type="button" aria-pressed={side===s} onClick={()=>setSide(s)} className={`min-h-11 rounded-xl p-3 text-[15px] font-semibold [overflow-wrap:anywhere] cursor-pointer ${side===s?'bg-text-primary text-bg-base':'bg-bg-elevated text-text-secondary hover:text-text-primary'}`}>{m[s].name}</button>)}</div>
   {!lineup?<p className="text-[15px] leading-relaxed text-text-secondary">{en?'The lineup is not available yet. It is usually confirmed shortly before kickoff.':'La alineación aún no está disponible. Normalmente se confirma poco antes de comenzar.'}</p>:<>
    <div className="space-y-1 text-[13px] text-text-secondary">{lineup.formation&&<p>{en?'Formation':'Formación'}: <strong className="text-text-primary">{lineup.formation}</strong></p>}{data.coaches[side]&&<p>{en?'Coach':'Director técnico'}: {data.coaches[side]}</p>}</div>
    {[true,false].map(starter=><div key={String(starter)} className="space-y-3"><h3 className="font-display text-[20px] tracking-wide text-text-primary">{starter?(en?'Starting lineup':'Titulares'):(en?'Substitutes':'Suplentes')}</h3>
     {data.players[side].filter(p=>p.starter===starter).map(p=><FootballPlayerRow key={p.id} player={p}/>)}</div>)}
   </>}
  </section>}
  <p className={`text-center text-[13px] leading-relaxed ${error||data.stale?'text-amber':'text-text-muted'}`}>
   {error||data.stale?(en?'Waiting for an update. ':'Esperando una actualización. '):''}
   API-Football · {new Intl.DateTimeFormat(en?'en-US':'es-CO',{hour:'numeric',minute:'2-digit',timeZone:'America/Bogota'}).format(new Date(data.fetchedAt))}
  </p>
 </main>;
}
