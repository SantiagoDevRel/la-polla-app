import { ArrowDownUp, BarChart3, CircleX, Clock3, Flag, Hand, MonitorCheck, RectangleVertical, Target } from 'lucide-react';

/** Classic white football with dark pentagonal panels, legible at navigation size. */
export function FootballNavigationBall({className='h-7 w-7'}:{className?:string}) {
 return <svg viewBox="0 0 32 32" className={className} aria-hidden="true" data-football-icon="classic-ball">
  <circle cx="16" cy="16" r="14" className="fill-text-primary stroke-text-secondary" strokeWidth="1"/>
  <path d="m16 9.2 6.5 4.7-2.5 7.6h-8l-2.5-7.6Z" className="fill-bg-base"/>
  {[0,72,144,216,288].map(angle=><g key={angle} transform={`rotate(${angle} 16 16)`}>
   <path d="M11.7 2.7a14 14 0 0 1 8.6 0l.7 2.8-5 2.7-5-2.7Z" className="fill-bg-base"/>
   <path d="M16 8v1.3M11 5.5l-4.2 4" className="stroke-bg-base" strokeWidth=".8" fill="none"/>
  </g>)}
 </svg>;
}

export function FootballBall({className='h-5 w-5'}:{className?:string}) {
 return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" className={className} aria-hidden="true" data-football-icon="ball">
  <circle cx="12" cy="12" r="10"/><path fill="currentColor" d="m12 7 4.8 3.5-1.8 5.6H9l-1.8-5.6Z"/>
  <path d="M12 7V2m4.8 8.5 4.7-1.7M15 16.1l3 4M9 16.1l-3 4m1.2-9.6L2.5 8.8"/>
 </svg>;
}

/** Text labels stay visible; icons add meaning without relying on color alone. */
export function FootballEventIcon({type,isGoal}:{type:string;isGoal:boolean}) {
 const classes='h-5 w-5 shrink-0';
 if(isGoal)return <FootballBall className={`${classes} text-turf`}/>;
 if(/red/i.test(type))return <RectangleVertical className={`${classes} fill-red-alert text-red-alert`} aria-hidden="true" data-football-icon="red-card"/>;
 if(/yellow/i.test(type))return <RectangleVertical className={`${classes} fill-amber text-amber`} aria-hidden="true" data-football-icon="yellow-card"/>;
 if(/substitution/i.test(type))return <ArrowDownUp className={`${classes} text-turf`} aria-hidden="true" data-football-icon="substitution"/>;
 if(/var|disallowed/i.test(type))return <MonitorCheck className={classes} aria-hidden="true" data-football-icon="var"/>;
 if(/missed|saved/i.test(type))return <CircleX className={classes} aria-hidden="true" data-football-icon="missed"/>;
 return <Clock3 className={classes} aria-hidden="true" data-football-icon="event"/>;
}

export function FootballStatIcon({kind}:{kind:string}) {
 const classes='h-4 w-4 shrink-0';
 if(/yellow/i.test(kind))return <RectangleVertical className={`${classes} fill-amber text-amber`} aria-hidden="true"/>;
 if(/red/i.test(kind))return <RectangleVertical className={`${classes} fill-red-alert text-red-alert`} aria-hidden="true"/>;
 if(/goal|possession/i.test(kind))return <FootballBall className={classes}/>;
 const Icon=/minute/i.test(kind)?Clock3:/shot/i.test(kind)?Target:/pass|assist/i.test(kind)?ArrowDownUp:/corner|offside/i.test(kind)?Flag:/save/i.test(kind)?Hand:BarChart3;
 return <Icon className={classes} aria-hidden="true"/>;
}
