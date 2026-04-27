// lib/font-scale.ts — Per-device user preference for global font size.
//
// We store one of three labels in localStorage and translate to a root
// font-size at apply time. The trade-off vs. CSS `zoom`: root
// font-size only scales `rem`-based units (every Tailwind text size
// is `rem`-based, so the bulk of the UI follows). Pixel-based inline
// `fontSize: 14` styles stay fixed — that's intentional. Users asked
// for "text scaling" without the layout shrinking on small zoom: with
// `zoom` the whole body became half the viewport at sm, leaving empty
// gutters; with root font-size the layout keeps its full width and
// only the text grows or shrinks.
//
// Storage is per-device (localStorage). A user might want bigger text
// on phone and default on desktop, and not having to round-trip the
// preference to the DB keeps things snappy with no extra endpoint.

export type FontScale = "sm" | "md" | "lg";

const STORAGE_KEY = "la_polla_font_scale";

// Numeric multipliers applied via CSS `zoom`. md=1 stays the canonical
// design baseline. sm/lg are deliberately aggressive (−50% / +60%)
// because users wanted the buttons to feel like real "zoom out / zoom
// in" on mobile, not just a small bump. If the small end breaks
// layouts on a particular page, raise sm closer to 0.7.
export const FONT_SCALE_VALUES: Record<FontScale, number> = {
  sm: 0.5,
  md: 1.0,
  lg: 1.6,
};

export function getStoredScale(): FontScale {
  if (typeof window === "undefined") return "md";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "sm" || raw === "md" || raw === "lg") return raw;
  } catch {
    // localStorage unavailable (private mode, quota, etc.) — fall through.
  }
  return "md";
}

export function setStoredScale(scale: FontScale): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, scale);
  } catch {
    // Ignore quota / privacy-mode errors. The current session still
    // applies the new scale; only persistence is lost.
  }
}

// Browser default root font-size.
const DEFAULT_ROOT_PX = 16;

export function applyScale(scale: FontScale): void {
  if (typeof document === "undefined") return;
  const value = FONT_SCALE_VALUES[scale];
  // Scale rem-based text via the root element's font-size. Layout
  // (cards, paddings in px) stays put; only typography grows/shrinks.
  document.documentElement.style.fontSize = `${DEFAULT_ROOT_PX * value}px`;
  // Defensive cleanup: previous builds applied `zoom` to body, which
  // shrank everything including widths and left empty gutters at sm.
  // Clear it so users upgrading don't keep the broken state.
  if (document.body.style.zoom) {
    document.body.style.zoom = "";
  }
}
