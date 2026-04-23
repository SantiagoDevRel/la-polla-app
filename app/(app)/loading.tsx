// app/(app)/loading.tsx — Route-level loading UI for the authenticated
// shell. Rendered by Next while a server component in the (app) group
// is fetching. Renders a centered pollito + "Cargando..." label over
// the ambient video background (AppBackground is already mounted in
// the layout, so it paints through this transparent loader).
//
// Kept intentionally small: no cards, no gradients, just a single
// motion cue so the user knows the app is alive mid-fetch.

import Image from "next/image";

export default function AppLoading() {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="relative w-24 h-24 animate-pulse-live">
          <Image
            src="/pollitos/pollito_pibe_lider.webp"
            alt=""
            fill
            sizes="96px"
            className="object-contain"
            priority
          />
        </div>
        <p className="font-body text-[13px] uppercase tracking-[0.18em] text-text-primary">
          Cargando
        </p>
      </div>
    </div>
  );
}
