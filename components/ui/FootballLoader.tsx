// components/ui/FootballLoader.tsx — Bouncing pollito loader, no external libs.
"use client";

interface FootballLoaderProps {
  size?: number;
  className?: string;
}

export default function FootballLoader({ size = 56, className = "" }: FootballLoaderProps) {
  return (
    <div
      className={`inline-block ${className}`}
      style={{ width: size, height: size + 14 }}
      role="status"
      aria-label="Cargando"
    >
      <style>{`
        @keyframes pollito-bounce {
          0%   { transform: translateY(0)   scaleX(1)    scaleY(1);    animation-timing-function: cubic-bezier(0.55, 0, 1, 0.45); }
          50%  { transform: translateY(40%) scaleX(1.12) scaleY(0.88); animation-timing-function: ease-out; }
          55%  { transform: translateY(40%) scaleX(1.12) scaleY(0.88); }
          100% { transform: translateY(0)   scaleX(1)    scaleY(1);    animation-timing-function: cubic-bezier(0, 0.55, 0.45, 1); }
        }
        .pollito-bouncer {
          width: 100%;
          height: 100%;
          animation: pollito-bounce 0.9s infinite;
          transform-origin: 50% 100%;
          display: block;
          object-fit: contain;
        }
      `}</style>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/pollitos/logo_realistic.webp"
        alt=""
        className="pollito-bouncer"
        draggable={false}
      />
    </div>
  );
}
