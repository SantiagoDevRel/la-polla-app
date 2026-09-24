import { cn } from "@/lib/cn";

/** A decorative hat on the first P; the accessible title stays unchanged. */
export function SantaHatTitle({ children, className }: { children: string; className?: string }) {
  const initial = children.search(/p/i);
  if (initial === -1) return <span className={className}>{children}</span>;

  return (
    <span className={className}>
      {children.slice(0, initial)}
      <span className="relative inline-block">
        {children[initial]}
        <svg
          viewBox="0 0 40 28"
          aria-hidden="true"
          focusable="false"
          className="pointer-events-none absolute -left-[0.14em] -top-[0.35em] h-[0.65em] w-[0.9em] max-w-none"
        >
          <path d="M6 21C8 15 9 7 17 4c8-3 14 1 17 8l-6 2c-2-4-5-5-7-4 4 3 7 7 8 12Z" fill="var(--red-alert)" />
          <path d="M6 21c2-6 3-14 11-17-3 4-3 10-2 17Z" fill="var(--bg-base)" opacity="0.15" />
          <path d="M5 19c7-2 17-1 24 1 2 1 2 5-1 6-7-2-16-3-23-1-3-1-3-5 0-6Z" fill="var(--text-primary)" />
          <circle cx="33" cy="13" r="4.5" fill="var(--text-primary)" />
        </svg>
      </span>
      {children.slice(initial + 1)}
    </span>
  );
}

/** A neutral planning placeholder, never a replacement crest for a known team. */
export function UnknownTeamCrest({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 48"
      role="img"
      aria-label="Equipo por confirmar"
      focusable="false"
      className={cn("h-9 w-9 max-w-none shrink-0", className)}
    >
      <path d="M20 3 35 8v14c0 10-7 17-15 22C12 39 5 32 5 22V8Z" fill="var(--bg-elevated)" stroke="var(--text-muted)" strokeWidth="1.5" />
      <path d="M14.5 17a5.5 5.5 0 0 1 11 0c0 4-5.5 4.5-5.5 9" fill="none" stroke="var(--text-primary)" strokeWidth="2.7" strokeLinecap="round" />
      <circle cx="20" cy="32.5" r="1.7" fill="var(--text-primary)" />
    </svg>
  );
}
