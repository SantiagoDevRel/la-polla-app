"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CalendarDays, RefreshCw, UserRound, Trophy } from 'lucide-react';
import { useLocale } from 'next-intl';
import { TeamCrest } from '@/components/match/TeamCrest';
import { isLiveStatus, type FootballMatch } from '@/lib/api-football/detail-model';
import { RESULT_LEAGUES } from '@/lib/api-football/results';
import { TOURNAMENTS } from '@/lib/tournaments';
import leagueLogos from '@/lib/teams/league-logos.json';

/** Public provider image URLs need no API request or client-side key. */
export function FootballLeagueLogo({tournament}:{tournament:string}) {
 const [failed,setFailed]=useState(false),[fallbackFailed,setFallbackFailed]=useState(false);
 const id=RESULT_LEAGUES[tournament],local=(leagueLogos as Record<string,string>)[tournament]??TOURNAMENTS.find(t=>t.slug===tournament)?.smallLogoPath;
 const src=!failed?local:id?`https://media.api-sports.io/football/leagues/${id}.png`:undefined;
 return <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-text-primary p-1.5" aria-hidden="true">
  {src&&!fallbackFailed?
   // eslint-disable-next-line @next/next/no-img-element
   <img src={src} alt="" width={32} height={32} loading="lazy" onError={()=>failed?setFallbackFailed(true):setFailed(true)} className="h-full w-full object-contain"/>:
   <Trophy className="h-6 w-6 text-bg-base"/>}
 </span>;
}

export function useFootballResource<T>(url:string,poll=60_000) {
 const [data,setData]=useState<T|null>(null),[error,setError]=useState(false),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0);
 useEffect(()=>{
  let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined,inflight=false;
  setData(null);setLoading(true);setError(false);
  async function load() {
   if(stopped||inflight)return;
   if(document.hidden){timer=setTimeout(load,poll);return;}
   inflight=true;controller=new AbortController();
   try {
    const res=await fetch(url,{cache:'no-store',signal:controller.signal});
    if(!res.ok)throw new Error('Unavailable');
    const json=await res.json();if(!stopped){setData(json);setError(false);}
   }catch{if(!stopped)setError(true);}finally{
    inflight=false;if(!stopped){setLoading(false);timer=setTimeout(load,poll);}
   }
  }
  void load();
  const visible=()=>{if(!document.hidden){clearTimeout(timer);void load();}};
  document.addEventListener('visibilitychange',visible);
  return()=>{stopped=true;clearTimeout(timer);controller?.abort();document.removeEventListener('visibilitychange',visible);};
 },[url,poll,retry]);
 return {data,error,loading,reload:()=>setRetry(x=>x+1)};
}

export function FootballBack({label}:{label?:string}) {
 const router=useRouter(),locale=useLocale();
 return <button type="button" onClick={()=>window.history.length>1?router.back():router.push('/futbol')}
  className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-[15px] font-medium text-text-secondary transition-colors hover:bg-bg-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-turf cursor-pointer">
  <ArrowLeft className="h-4 w-4 shrink-0"/>{label??(locale==='en'?'Back':'Volver')}
 </button>;
}

export function FootballLoading() {
 return <div role="status" aria-label="Cargando" className="space-y-3" >{[0,1,2].map(n=><div key={n} className="h-36 animate-pulse rounded-[18px] bg-bg-elevated/80"/>)}</div>;
}
export function FootballEmpty({title,message,onRetry}:{title:string;message:string;onRetry?:()=>void}) {
 const locale=useLocale();
 return <div className="lp-card space-y-3 p-6 text-center">
  <CalendarDays className="mx-auto h-8 w-8 text-text-muted" aria-hidden="true"/>
  <h2 className="font-display text-[24px] tracking-wide text-text-primary">{title}</h2>
  <p className="text-[15px] leading-relaxed text-text-secondary">{message}</p>
  {onRetry&&<button type="button" onClick={onRetry} className="lp-btn lp-btn-ghost min-h-11 gap-2"><RefreshCw className="h-4 w-4"/>{locale==='en'?'Try again':'Intentar de nuevo'}</button>}
 </div>;
}

export function FootballPhoto({src,name,number,className='h-12 w-12'}:{src:string|null|undefined;name:string;number?:number|string|null;className?:string}) {
 const [failed,setFailed]=useState(false);
 useEffect(()=>setFailed(false),[src]);
 return <span className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-bg-elevated ${className}`}>
  {src&&!failed?
   // eslint-disable-next-line @next/next/no-img-element
   <img src={src} alt={name} width={96} height={96} loading="lazy" onError={()=>setFailed(true)} className="h-full w-full object-cover"/>:
   number!=null?<span className="font-display text-[24px] tracking-wide text-text-secondary">{number}</span>:<UserRound className="h-6 w-6 text-text-muted" aria-label={name}/>}
 </span>;
}

export function statusLabel(match:FootballMatch,locale:string) {
 const en=locale==='en',s=match.status;
 const labels:Record<string,string>={HT:en?'Half-time':'Descanso',FT:en?'Finished':'Finalizado',AET:en?'After extra time':'Final con alargue',PEN:en?'After penalties':'Final por penales',P:en?'Penalties':'Penales',ET:en?'Extra time':'Alargue',BT:en?'Break':'Descanso',PST:en?'Postponed':'Aplazado',CANC:en?'Cancelled':'Cancelado',ABD:en?'Abandoned':'Abandonado',SUSP:en?'Suspended':'Suspendido',INT:en?'Interrupted':'Interrumpido',TBD:en?'Time to be confirmed':'Hora por confirmar',AWD:en?'Awarded':'Resultado administrativo',WO:en?'Walkover':'No presentado'};
 return labels[s]??(isLiveStatus(s)?`${en?'Live':'En vivo'}${match.minute!=null?` · ${match.minute}′`:''}`:
  new Intl.DateTimeFormat(en?'en-US':'es-CO',{hour:'numeric',minute:'2-digit',timeZone:'America/Bogota'}).format(new Date(match.date)));
}

export function FootballMatchCard({match,showDate=false}:{match:FootballMatch;showDate?:boolean}) {
 const locale=useLocale(),en=locale==='en';
 return <article className="lp-card overflow-hidden p-4" data-football-match={match.id}>
  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[13px] text-text-secondary">
   <span className={isLiveStatus(match.status)?'inline-flex items-center gap-1.5 font-semibold text-turf':''}>
    {isLiveStatus(match.status)&&<span className="h-1.5 w-1.5 rounded-full bg-turf motion-safe:animate-pulse"/>}{statusLabel(match,locale)}
   </span>
   {showDate&&<span>{new Intl.DateTimeFormat(en?'en-US':'es-CO',{day:'numeric',month:'short',timeZone:'America/Bogota'}).format(new Date(match.date))}</span>}
  </div>
  <div className="space-y-2">
   {(['home','away'] as const).map(side=><div key={side} className="flex items-start gap-2">
    <Link href={`/futbol/equipos/${match[side].id}`} aria-label={`${en?'View team':'Ver equipo'}: ${match[side].name}`}
     className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-bg-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-turf">
     <TeamCrest team={match[side].name} src={match[side].logo} className="h-8 w-8"/>
    </Link>
    <Link href={`/futbol/partidos/${match.id}`} className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-3 rounded-lg px-1 text-[15px] font-semibold text-text-primary transition-colors hover:bg-bg-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-turf">
     <span className="min-w-0 [overflow-wrap:anywhere]">{match[side].name}</span>
     <span className="shrink-0 font-display text-[28px] tabular-nums tracking-wide">{match.score[side]??'—'}</span>
    </Link>
   </div>)}
  </div>
  <Link href={`/futbol/partidos/${match.id}`} className="mt-2 flex min-h-11 items-center justify-center rounded-full border border-border-subtle text-[13px] font-medium text-text-secondary transition-colors hover:bg-bg-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-turf">
   {en?'View match':'Ver partido'}
  </Link>
 </article>;
}
