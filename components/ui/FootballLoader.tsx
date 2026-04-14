// components/ui/FootballLoader.tsx — Bouncing football loader, no external libs.
"use client";

interface FootballLoaderProps {
  size?: number;
  className?: string;
}

export default function FootballLoader({ size = 48, className = "" }: FootballLoaderProps) {
  return (
    <div
      className={`inline-block ${className}`}
      style={{ width: size, height: size + 12 }}
      role="status"
      aria-label="Cargando"
    >
      <style>{`
        @keyframes football-bounce {
          0%   { transform: translateY(0)   scaleX(1)    scaleY(1);    animation-timing-function: cubic-bezier(0.55, 0, 1, 0.45); }
          50%  { transform: translateY(60%) scaleX(1.15) scaleY(0.85); animation-timing-function: ease-out; }
          55%  { transform: translateY(60%) scaleX(1.15) scaleY(0.85); }
          100% { transform: translateY(0)   scaleX(1)    scaleY(1);    animation-timing-function: cubic-bezier(0, 0.55, 0.45, 1); }
        }
        @keyframes football-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        .football-bouncer {
          width: 100%;
          height: 100%;
          animation: football-bounce 0.85s infinite;
          transform-origin: 50% 100%;
        }
        .football-spinner {
          width: 100%;
          height: 100%;
          animation: football-spin 1.7s linear infinite;
        }
      `}</style>
      <div className="football-bouncer">
        <div className="football-spinner">
          <svg viewBox="0 0 64 64" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <circle cx="32" cy="32" r="30" fill="#ffffff" stroke="#0a0a0a" strokeWidth="2" />
            <polygon
              points="32,18 38.6,22.8 36.1,30.6 27.9,30.6 25.4,22.8"
              fill="#0a0a0a"
            />
            <polygon points="32,18 25.4,22.8 19.5,18.5 24.4,12.5 32,12" fill="#0a0a0a" opacity="0.85" />
            <polygon points="32,18 38.6,22.8 44.5,18.5 39.6,12.5 32,12" fill="#0a0a0a" opacity="0.85" />
            <polygon points="25.4,22.8 27.9,30.6 21.4,35.5 15.5,30.4 19.5,22.5" fill="#0a0a0a" opacity="0.85" />
            <polygon points="38.6,22.8 36.1,30.6 42.6,35.5 48.5,30.4 44.5,22.5" fill="#0a0a0a" opacity="0.85" />
            <polygon points="27.9,30.6 36.1,30.6 39.5,38.6 32,44 24.5,38.6" fill="#0a0a0a" opacity="0.85" />
            <line x1="32" y1="12" x2="32" y2="6"  stroke="#0a0a0a" strokeWidth="1.5" />
            <line x1="19.5" y1="18.5" x2="14" y2="14" stroke="#0a0a0a" strokeWidth="1.5" />
            <line x1="44.5" y1="18.5" x2="50" y2="14" stroke="#0a0a0a" strokeWidth="1.5" />
            <line x1="21.4" y1="35.5" x2="14" y2="40" stroke="#0a0a0a" strokeWidth="1.5" />
            <line x1="42.6" y1="35.5" x2="50" y2="40" stroke="#0a0a0a" strokeWidth="1.5" />
            <line x1="32" y1="44" x2="32" y2="52" stroke="#0a0a0a" strokeWidth="1.5" />
          </svg>
        </div>
      </div>
    </div>
  );
}
