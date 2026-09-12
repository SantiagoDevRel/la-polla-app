"use client";
import { useState } from 'react';
import { useLocale } from 'next-intl';
import Link from 'next/link';
import { countryIsoForTeam } from '@/lib/flags/country-iso';
import { TeamCrest } from '@/components/match/TeamCrest';
import type { FootballTeam } from '@/lib/api-football/team-model';
import { FootballBack, FootballEmpty, FootballLoading, FootballMatchCard, FootballPhoto, useFootballResource } from './shared';

const POSITIONS=[['Goalkeeper','Arqueros','Goalkeepers'],['Defender','Defensas','Defenders'],['Midfielder','Mediocampistas','Midfielders'],['Attacker','Delanteros','Forwards']] as const;

export default function FootballTeamProfile({id}:{id:string}) {
 const locale=useLocale(),en=locale==='en';
 const {data,error,loading,reload}=useFootballResource<FootballTeam>(`/api/football/teams/${id}`,300_000);
 const [view,setView]=useState<'upcoming'|'results'|'squad'|'info'>('upcoming'),[venueFailed,setVenueFailed]=useState(false);
 if(loading)return <main className="space-y-4 px-4"><FootballBack/><FootballLoading/></main>;
 if(!data)return <main className="space-y-4 px-4"><FootballBack/><FootballEmpty title={en?'Team unavailable':'Equipo no disponible'} message={en?'Try opening the team from a recent match.':'Intenta abrir el equipo desde un partido reciente.'} onRetry={reload}/></main>;
 const positions=[...POSITIONS.map(([key,es,label])=>({key,label:en?label:es})),{key:'Other',label:en?'Other players':'Otros jugadores'}];
 const results=data.matches.filter(m=>['FT','AET','PEN'].includes(m.status));
 const lastMatch=results.at(-1);
 const iso=countryIsoForTeam(data.team.country);
 const country=iso?.length===2?new Intl.DisplayNames([locale],{type:'region'}).of(iso.toUpperCase()):data.team.country;
 const upcoming=data.matches.filter(m=>!['FT','AET','PEN','CANC','ABD','AWD','WO'].includes(m.status));
 return <main className="space-y-4 px-4 pb-4 [overflow-wrap:anywhere]">
  <FootballBack/>
  <header className="lp-card space-y-3 p-5 text-center">
   <TeamCrest team={data.team.name} src={data.team.logo} className="h-16 w-16"/>
   <h1 className="font-display text-[32px] leading-tight tracking-wide text-text-primary [overflow-wrap:anywhere]">{data.team.name}</h1>
   {country&&<p className="text-[15px] text-text-secondary">{country}</p>}
  </header>
  <div className="flex overflow-x-auto rounded-xl border border-border-subtle bg-bg-card/90 p-1" role="tablist" aria-label={en?'Team information':'Información del equipo'}>
   {(['upcoming','results','squad','info'] as const).map((tab,i)=><button key={tab} id={`team-tab-${tab}`} type="button" role="tab" aria-selected={view===tab} aria-controls="team-panel" tabIndex={view===tab?0:-1} onClick={()=>setView(tab)}
    onFocus={e=>e.currentTarget.scrollIntoView({block:'nearest',inline:'nearest'})}
    onKeyDown={e=>{
     const direction=e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0;
     if(!direction&&e.key!=='Home'&&e.key!=='End')return;
     e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?3:(i+direction+4)%4;
     const button=e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next];button?.click();button?.focus();
    }} className={`min-h-11 min-w-max flex-1 rounded-lg px-2 py-2 text-[15px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-turf cursor-pointer ${view===tab?'bg-text-primary text-bg-base':'text-text-secondary hover:bg-bg-elevated'}`}>
    {(en?['Upcoming','Results','Squad','Club']:['Próximos','Pasados','Plantel','Club'])[i]}
   </button>)}
  </div>
  <div id="team-panel" role="tabpanel" aria-labelledby={`team-tab-${view}`} tabIndex={0} className="rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-turf">
  {(view==='upcoming'||view==='results')&&<section className="space-y-3">
   <h2 className="font-display text-[20px] tracking-wide text-text-primary">{view==='upcoming'?(en?'Upcoming and live':'Próximos partidos'):(en?'Recent results':'Partidos pasados')}</h2>
   {(view==='upcoming'?upcoming:[...results].reverse()).map(m=><FootballMatchCard key={m.id} match={m} showDate/>)}
   {(view==='upcoming'?upcoming:results).length===0&&<FootballEmpty title={view==='upcoming'?(en?'No upcoming matches yet':'Aún no hay próximos partidos'):(en?'No recent results':'Aún no hay resultados')} message={en?'Matches in the competitions we cover will appear here.':'Aquí aparecerán los partidos de los torneos que seguimos.'} onRetry={reload}/>}
  </section>}
  {view==='squad'&&<section className="space-y-4">
   <p className="text-[13px] leading-relaxed text-text-secondary">{en?'Club squad. Open a match to see its starting lineup.':'Plantel del club. Para ver quiénes son titulares, abre la alineación de un partido.'}</p>
   {lastMatch&&<Link href={`/futbol/partidos/${lastMatch.id}?vista=alineaciones&equipo=${lastMatch.home.id===data.team.id?'home':'away'}`} className="flex min-h-11 items-center justify-center rounded-full border border-border-subtle px-4 py-3 text-center text-[15px] font-semibold text-text-primary transition-colors hover:bg-bg-elevated">{en?'View the last match lineup':'Ver alineación del último partido'}</Link>}
   {data.players.length===0?<FootballEmpty title={en?'Squad not available yet':'Plantel aún no disponible'} message={en?'Player information will appear here when available.':'Aquí aparecerán los jugadores cuando la información esté disponible.'} onRetry={reload}/>:
    positions.map(group=>{
     const players=data.players.filter(p=>group.key==='Other'?!POSITIONS.some(g=>g[0]===p.position):p.position===group.key);
     if(!players.length)return null;
     return <section key={group.key} className="space-y-3"><h2 className="font-display text-[20px] tracking-wide text-text-primary">{group.label}</h2>
      {players.sort((a,b)=>(a.number??999)-(b.number??999)).map(player=><div key={player.id} className="lp-card p-3" data-squad-player={player.id}>
       <div className="flex min-h-11 items-center gap-3">
        <FootballPhoto src={player.photo} name={player.name} number={player.number}/>
        <div className="min-w-0 flex-1"><p className="text-[15px] font-semibold text-text-primary [overflow-wrap:anywhere]">{player.name}</p><p className="text-[13px] text-text-secondary">{player.number!=null?`#${player.number}`:en?'Number unavailable':'Sin dorsal'}{player.age!=null?` · ${player.age} ${en?'years':'años'}`:''}</p></div>
       </div>
      </div>)}
     </section>;
    })}
  </section>}
  {view==='info'&&<section className="lp-card space-y-4 overflow-hidden p-4">
   <h2 className="font-display text-[20px] tracking-wide text-text-primary">{en?'About the club':'Información del club'}</h2>
   <dl className="space-y-3">{[
    [en?'Founded':'Fundación',data.team.founded], [en?'Country':'País',country],
    [en?'Stadium':'Estadio',data.venue?.name],[en?'City':'Ciudad',data.venue?.city],
    [en?'Capacity':'Capacidad',data.venue?.capacity?`${new Intl.NumberFormat(locale).format(data.venue.capacity)} ${en?'spectators':'espectadores'}`:null],
   ].map(([label,value])=><div key={label}><dt className="text-[13px] text-text-secondary">{label}</dt><dd className="text-[15px] font-semibold text-text-primary">{value??(en?'Not available':'No disponible')}</dd></div>)}</dl>
   {data.venue?.image&&!venueFailed&&
    // eslint-disable-next-line @next/next/no-img-element
    <img src={data.venue.image} alt={data.venue.name??(en?'Stadium':'Estadio')} width={480} height={270} onError={()=>setVenueFailed(true)} loading="lazy" className="aspect-video w-full rounded-xl object-cover"/>}
  </section>}
  </div>
  {error&&<p className="text-[13px] text-amber">{en?'Unable to refresh. Showing the last available information.':'No pudimos actualizar. Mostramos la última información disponible.'}</p>}
 </main>;
}
