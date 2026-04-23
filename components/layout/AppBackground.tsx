// components/layout/AppBackground.tsx — Ambient stadium background
//
// Fixed, pointer-events-none layer rendered once per root layout. Five
// composited parts, all pure CSS:
//
//   1. Base fill          — flat bg-base so the layer never flashes white
//                            on first paint.
//   2. Spotlight A (gold) — large soft radial that pans slowly, giving
//                            the impression of a stadium floodlight.
//   3. Spotlight B (turf) — second, cooler spotlight panning in reverse
//                            so the two never overlap on the same beat.
//   4. Fog A              — slow-drifting warm haze.
//   5. Fog B              — slower, cooler haze for depth.
//   6. Grain              — faint SVG-turbulence noise that keeps the
//                            gradients from looking banded on OLED.
//
// The whole layer sits at `-z-10` so every authenticated + auth page
// renders on top without any further changes. Accessibility: animations
// auto-disable via the existing prefers-reduced-motion block in
// globals.css.

import { cn } from "@/lib/cn";

// Encoded once — tiny SVG turbulence square tiled over the screen.
const NOISE_SVG =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='4'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.5 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>";

export interface AppBackgroundProps {
  /** Tighten the spotlight intensity on cinematic screens (hero card,
   *  post-match moments). Default = standard ambient. */
  intensity?: "default" | "strong";
  className?: string;
}

export function AppBackground({
  intensity = "default",
  className,
}: AppBackgroundProps) {
  const spotA = intensity === "strong" ? 0.22 : 0.14;
  const spotB = intensity === "strong" ? 0.12 : 0.07;

  return (
    <div
      aria-hidden="true"
      className={cn(
        "fixed inset-0 -z-10 overflow-hidden pointer-events-none bg-bg-base",
        className,
      )}
    >
      {/* Spotlight A — gold, top center */}
      <div
        className="absolute left-1/2 top-[-10%] w-[140vmax] h-[80vmax] -translate-x-1/2 will-change-transform"
        style={{
          background: `radial-gradient(closest-side, rgba(255, 215, 0, ${spotA}), transparent 70%)`,
          animation: "spotlight-pan-a 32s ease-in-out infinite",
        }}
      />

      {/* Spotlight B — turf, bottom right */}
      <div
        className="absolute right-[-20%] bottom-[-10%] w-[110vmax] h-[70vmax] will-change-transform"
        style={{
          background: `radial-gradient(closest-side, rgba(31, 216, 127, ${spotB}), transparent 70%)`,
          animation: "spotlight-pan-b 48s ease-in-out infinite",
        }}
      />

      {/* Fog A — warm haze, center-left */}
      <div
        className="absolute inset-0 will-change-transform"
        style={{
          backgroundImage:
            "radial-gradient(45% 35% at 35% 55%, rgba(255, 215, 0, 0.05), transparent 60%), " +
            "radial-gradient(55% 45% at 65% 25%, rgba(255, 159, 28, 0.04), transparent 60%)",
          filter: "blur(18px)",
          animation: "fog-drift-a 42s ease-in-out infinite",
        }}
      />

      {/* Fog B — cool shadow, lower right */}
      <div
        className="absolute inset-0 will-change-transform"
        style={{
          backgroundImage:
            "radial-gradient(55% 40% at 65% 75%, rgba(0, 0, 0, 0.45), transparent 65%), " +
            "radial-gradient(40% 30% at 20% 20%, rgba(79, 195, 247, 0.03), transparent 60%)",
          filter: "blur(28px)",
          animation: "fog-drift-b 60s ease-in-out infinite",
        }}
      />

      {/* Grain — static, non-animated. Kills gradient banding on OLED
          without raising contrast enough to be visible as texture. */}
      <div
        className="absolute inset-0 opacity-[0.04] mix-blend-overlay"
        style={{
          backgroundImage: `url("${NOISE_SVG}")`,
          backgroundSize: "160px 160px",
        }}
      />

      {/* Bottom vignette so BottomNav floats over something, not into it. */}
      <div
        className="absolute bottom-0 left-0 right-0 h-[160px]"
        style={{
          background:
            "linear-gradient(180deg, transparent 0%, rgba(8, 12, 16, 0.55) 60%, rgba(8, 12, 16, 0.85) 100%)",
        }}
      />
    </div>
  );
}

export default AppBackground;
