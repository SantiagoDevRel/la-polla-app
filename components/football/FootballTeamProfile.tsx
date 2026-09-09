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
 const [view,setView]=useState<'matches'|'squad'|'info'>('matches'),[venueFailed,setVenueFailed]=useState(false);
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
  <div className="grid grid-cols-1 gap-2" role="group" aria-label={en?'Team information':'Información del equipo'}>
   {(['matches','squad','info'] as const).map((tab,i)=><button key={tab} type="button" aria-pressed={view===tab} onClick={()=>setView(tab)} className={`min-h-11 rounded-full px-4 py-3 text-[15px] font-semibold transition-colors cursor-pointer ${view===tab?'bg-text-primary text-bg-base':'border border-border-subtle bg-bg-card/80 text-text-secondary hover:bg-bg-elevated'}`}>
    {(en?['View matches','View squad','About the club']:['Ver partidos','Ver plantel','Conocer el club'])[i]}
   </button>)}
  </div>
  {view==='matches'&&<div className="space-y-5">
   {upcoming.length>0&&<section className="space-y-3"><h2 className="font-display text-[20px] tracking-wide text-text-primary">{en?'Upcoming and live':'Próximos y en juego'}</h2>{upcoming.map(m=><FootballMatchCard key={m.id} match={m} showDate/>)}</section>}
   {results.length>0&&<section className="space-y-3"><h2 className="font-display text-[20px] tracking-wide text-text-primary">{en?'Recent results':'Resultados recientes'}</h2>{[...results].reverse().map(m=><FootballMatchCard key={m.id} match={m} showDate/>)}</section>}
   <p className="text-[13px] leading-relaxed text-text-secondary">{en?'Recent and upcoming matches in the competitions we cover.':'Partidos recientes y próximos en los torneos que seguimos.'}</p>
  </div>}
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
  {error&&<p className="text-[13px] text-amber">{en?'Unable to refresh. Showing the last available information.':'No pudimos actualizar. Mostramos la última información disponible.'}</p>}
 </main>;
}
