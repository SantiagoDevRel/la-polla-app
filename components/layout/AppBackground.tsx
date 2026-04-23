// components/layout/AppBackground.tsx — Ambient stadium background
//
// Fixed, pointer-events-none layer rendered once per root layout.
// A 1080x1920 video drives the atmosphere; a black overlay keeps
// copy readable on top. The first-frame WebP acts as the late-loader
// poster so the background paints instantly (~80kb) while the video
// decodes (~1 MB mp4/webm). Reduced-motion users see the poster as
// a static image instead of an autoplay video.
//
// Composition, bottom-to-top:
//   1. bg-base flat fill (no first-paint flash).
//   2. <video> loop (muted, autoplay, playsInline). Hidden for
//      prefers-reduced-motion.
//   3. Static poster <img> — only visible under prefers-reduced-motion.
//   4. Black overlay at ~60% opacity for text readability.
//   5. Faint noise grain (mix-blend overlay) to kill OLED banding.
//   6. Bottom vignette so BottomNav never merges into the gradient.

import { cn } from "@/lib/cn";

const NOISE_SVG =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='4'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.5 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>";

export interface AppBackgroundProps {
  className?: string;
  /** Opacity of the black overlay on top of the video (0–1). Default
   *  0.6, which keeps the drifting motion visible while guaranteeing
   *  text contrast. Bump to 0.75 for text-heavy screens. */
  overlayOpacity?: number;
}

export function AppBackground({
  className,
  overlayOpacity = 0.6,
}: AppBackgroundProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "fixed inset-0 -z-10 overflow-hidden pointer-events-none bg-bg-base",
        className,
      )}
    >
      {/* Loop video. Hidden under prefers-reduced-motion (Tailwind
          "motion-reduce" variant) so the static poster below takes over. */}
      <video
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        poster="/videos/la-polla-background-poster.webp"
        className="absolute inset-0 w-full h-full object-cover motion-reduce:hidden"
      >
        <source src="/videos/la-polla-background.webm" type="video/webm" />
        <source src="/videos/la-polla-background-lite.mp4" type="video/mp4" />
      </video>

      {/* Static fallback image for users who opted out of motion. Hidden
          by default; motion-reduce:block promotes it when the user
          prefers reduced motion. Keeps the layer looking intentional
          instead of falling back to a flat color. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/videos/la-polla-background-poster.webp"
        alt=""
        className="absolute inset-0 w-full h-full object-cover hidden motion-reduce:block"
      />

      {/* Black overlay — keeps every surface legible over the moving
          footage. Tuned via the overlayOpacity prop per-surface. */}
      <div
        className="absolute inset-0 bg-bg-base"
        style={{ opacity: overlayOpacity }}
      />

      {/* Noise grain — static, non-animated. Kills banding on OLED. */}
      <div
        className="absolute inset-0 opacity-[0.04] mix-blend-overlay"
        style={{
          backgroundImage: `url("${NOISE_SVG}")`,
          backgroundSize: "160px 160px",
        }}
      />

      {/* Bottom vignette so BottomNav floats over something. */}
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
