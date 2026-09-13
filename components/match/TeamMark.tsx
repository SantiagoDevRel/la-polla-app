"use client";
import { TeamCrest } from './TeamCrest';
export function TeamMark({name,src}:{name:string;src:string|null}) {
 return <span className="mx-auto mb-3 flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-bg-elevated"><TeamCrest team={name} src={src} className="h-12 w-12" /></span>;
}
