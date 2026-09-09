import { ArrowDownUp, BarChart3, CircleX, Clock3, Flag, Hand, MonitorCheck, RectangleVertical, Target } from 'lucide-react';

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
