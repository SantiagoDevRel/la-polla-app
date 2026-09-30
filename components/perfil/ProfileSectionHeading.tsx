import type { LucideIcon } from "lucide-react";

const tones = {
  money: { badge: "bg-gold/10", text: "text-gold" },
  security: { badge: "bg-profile-security/20", text: "text-profile-security" },
  gifts: { badge: "bg-turf/10", text: "text-turf" },
  text: { badge: "bg-profile-text/10", text: "text-profile-text" },
  whatsapp: { badge: "bg-whatsapp/10", text: "text-whatsapp" },
  tickets: { badge: "bg-amber/10", text: "text-amber" },
} as const;

export default function ProfileSectionHeading({ icon: Icon, tone, title, id, meta }: {
  icon: LucideIcon;
  tone: keyof typeof tones;
  title: string;
  id?: string;
  meta?: string;
}) {
  return <div className="flex flex-wrap items-center gap-3">
    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tones[tone].badge} ${tones[tone].text}`} aria-hidden="true">
      <Icon className="h-6 w-6" />
    </span>
    <div className="min-w-0 flex-1 basis-36">
      <h2 id={id} className={`text-base font-semibold leading-snug [overflow-wrap:anywhere] ${tones[tone].text}`}>{title}</h2>
      {meta && <p className="text-sm leading-normal text-text-secondary">{meta}</p>}
    </div>
  </div>;
}
