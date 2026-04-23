// components/layout/SplashScreen.tsx — Stadium splash screen
//
// Plays the stadium loop over a fullscreen layer with the LA POLLA
// wordmark, then cross-fades into the app. Fires:
//   - On the very first navigation of a session (anywhere in the app).
//   - Every time the user navigates INTO /inicio or /perfil from another
//     route. Staying on the route does not replay (pathname has to
//     change).
//
// Respects prefers-reduced-motion by bailing instantly (no splash, no
// fade). Blocks pointer events while visible so taps during playback
// never reach underlying UI.

"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

const TOTAL_MS = 3200;
const FADE_MS = 500;
const REPLAY_ROUTES = ["/inicio", "/perfil"];

type Phase = "idle" | "playing" | "fading";

function shouldReplayOn(path: string | null): boolean {
  if (!path) return false;
  return REPLAY_ROUTES.some((r) => path === r || path.startsWith(`${r}/`));
}

export function SplashScreen() {
  const pathname = usePathname();
  const prevPath = useRef<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [mediaOk, setMediaOk] = useState(true);

  // Check prefers-reduced-motion once. Users who opted out skip the
  // splash entirely (no flash, no fade).
  useEffect(() => {
    if (typeof window === "undefined") return;
    setMediaOk(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (!mediaOk) {
      prevPath.current = pathname;
      return;
    }

    const firstMount = prevPath.current === null;
    const enteringReplayRoute =
      prevPath.current !== pathname && shouldReplayOn(pathname);

    if (!firstMount && !enteringReplayRoute) {
      prevPath.current = pathname;
      return;
    }

    setPhase("playing");
    const fadeTimer = window.setTimeout(
      () => setPhase("fading"),
      TOTAL_MS - FADE_MS,
    );
    const doneTimer = window.setTimeout(() => {
      setPhase("idle");
    }, TOTAL_MS);

    prevPath.current = pathname;
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(doneTimer);
    };
  }, [pathname, mediaOk]);

  if (phase === "idle") return null;

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-[9999] bg-bg-base transition-opacity"
      style={{
        opacity: phase === "fading" ? 0 : 1,
        transitionDuration: `${FADE_MS}ms`,
      }}
    >
      <video
        autoPlay
        muted
        playsInline
        preload="auto"
        poster="/videos/la-polla-background-poster.webp"
        className="absolute inset-0 w-full h-full object-cover"
        key={pathname /* restart video each replay */}
      >
        <source src="/videos/la-polla-background.webm" type="video/webm" />
        <source src="/videos/la-polla-background-lite.mp4" type="video/mp4" />
      </video>
      {/* Wordmark positioned to match the /inicio header exactly: same
          top offset (pt-4 + small pollito image block), same font size,
          so when the splash fades out the text stays in place visually
          and the app reveals underneath without the title jumping. */}
      <div className="absolute top-4 left-0 right-0 flex items-center justify-center gap-3 px-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/pollitos/pollito_pibe_lider.webp"
          alt=""
          width={52}
          height={52}
          style={{ objectFit: "contain" }}
        />
        <span
          className="font-display leading-none tracking-[0.04em] flex items-baseline gap-[5px]"
          style={{
            fontSize: 22,
            WebkitTextStroke: "1px #000",
            textShadow: "0 2px 6px rgba(0,0,0,0.55)",
            paintOrder: "stroke fill",
          }}
        >
          <span style={{ color: "#FFD700" }}>LA</span>
          <span style={{ color: "#2F6DF4" }}>POLLA</span>
          <span style={{ color: "#E4463A" }}>COLOMBIANA</span>
        </span>
      </div>
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(80% 80% at 50% 50%, transparent 60%, rgba(8,12,16,0.6) 100%)",
        }}
      />
    </div>
  );
}

export default SplashScreen;
