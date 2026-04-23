// components/ui/Skeleton.tsx — Skeleton loaders para estados de carga
// Usa animate-pulse con colores del sistema "estadio de noche"

interface SkeletonProps {
  className?: string;
  width?: string;
  height?: string;
}

export function Skeleton({ className = "", width, height }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-xl bg-bg-card-hover ${className}`}
      style={{ width, height }}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-2xl p-4 lp-card space-y-3">
      <div className="flex items-center gap-3">
        <Skeleton className="flex-1" height="16px" />
        <Skeleton width="60px" height="16px" />
      </div>
      <div className="flex gap-2">
        <Skeleton width="80px" height="20px" />
        <Skeleton width="60px" height="20px" />
      </div>
      <Skeleton width="100%" height="12px" />
    </div>
  );
}

export function SkeletonText({ width = "100%" }: { width?: string }) {
  return <Skeleton height="16px" width={width} />;
}

export function SkeletonAvatar({ size = 40 }: { size?: number }) {
  return (
    <div
      className="animate-pulse rounded-full bg-bg-card-hover"
      style={{ width: size, height: size }}
    />
  );
}
