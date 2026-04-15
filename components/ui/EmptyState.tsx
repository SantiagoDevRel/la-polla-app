// components/ui/EmptyState.tsx — Pollito-themed empty state for any tab/section
// that has no data yet. Keeps the UX from looking like a black/blank screen.
"use client";

interface EmptyStateProps {
  title: string;
  subtitle?: string;
  size?: number; // pollito image size
  className?: string;
}

export default function EmptyState({
  title,
  subtitle,
  size = 96,
  className = "",
}: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center text-center py-8 px-4 gap-3 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/pollitos/Pollito_esperando.webp"
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size, objectFit: "contain" }}
        draggable={false}
      />
      <p className="text-sm font-medium text-text-primary">{title}</p>
      {subtitle && <p className="text-xs text-text-muted max-w-xs">{subtitle}</p>}
    </div>
  );
}
