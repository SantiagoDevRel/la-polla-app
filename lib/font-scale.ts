// lib/font-scale.ts — Per-device user preference for global font size.
//
// We store one of three labels in localStorage and translate to a CSS
// `zoom` factor at apply time. `zoom` was chosen over root font-size
// because the codebase mixes Tailwind classes with pixel-based inline
// styles (`fontSize: 12`) — only `zoom` scales both uniformly. It is
// supported in Chrome/Edge/Safari and Firefox 126+ (May 2025); older
// Firefox falls back silently to 100%, which is the desired behavior.
//
// Storage is per-device (localStorage). A user might want bigger text
// on phone and default on desktop, and not having to round-trip the
// preference to the DB keeps things snappy with no extra endpoint.

export type FontScale = "sm" | "md" | "lg";

const STORAGE_KEY = "la_polla_font_scale";

// Numeric multipliers applied via CSS `zoom`. md=1 stays the canonical
// design baseline; sm/lg are tuned to be noticeable but not break the
// layout in obvious ways.
export const FONT_SCALE_VALUES: Record<FontScale, number> = {
  sm: 0.9,
  md: 1.0,
  lg: 1.15,
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

export function applyScale(scale: FontScale): void {
  if (typeof document === "undefined") return;
  const value = FONT_SCALE_VALUES[scale];
  // Apply to body so the viewport height calculations on html stay
  // unscaled (avoids surprises with sticky/fixed positioning relative
  // to the viewport).
  document.body.style.zoom = String(value);
}
