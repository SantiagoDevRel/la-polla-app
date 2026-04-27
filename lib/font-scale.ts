// lib/font-scale.ts — Per-device user preference for global text size.
//
// Goal: a true accessibility text-zoom (mobile-first) — text grows or
// shrinks, layout (cards, gutters, fixed positioning) stays put. The
// codebase mixes two text styling shapes:
//
//   • Tailwind classes like `text-sm` → `font-size: 0.875rem`
//     (rem-based, scales with the root font-size).
//   • Inline `style={{ fontSize: 14 }}` → `font-size: 14px`
//     (pixel-fixed, ignores root font-size entirely).
//
// To cover both, we apply scale in TWO steps:
//
//   1. Set <html style="font-size: BASE × scale px">. Every Tailwind
//      `text-*` class scales with this — that's the bulk of the UI.
//
//   2. Walk all elements with inline `style.fontSize` ending in `px`
//      and rewrite them to `original × scale`. We stash the original
//      on `data-lp-fs` so subsequent calls (e.g. user toggles to a
//      different scale) compute from the canonical value, not the
//      currently-scaled one. A MutationObserver in
//      FontScaleApplier.tsx re-runs this for nodes added by React
//      after the initial mount.
//
// Storage is per-device (localStorage). A user might want bigger text
// on phone and default on desktop, and not having to round-trip the
// preference to the DB keeps things snappy with no extra endpoint.

export type FontScale = "sm" | "md" | "lg";

const STORAGE_KEY = "la_polla_font_scale";

// Numeric multipliers. Aggressive on purpose — the user wanted real
// "zoom out / zoom in" feel, not a token bump. md=1 stays the canonical
// design baseline.
export const FONT_SCALE_VALUES: Record<FontScale, number> = {
  sm: 0.5,
  md: 1.0,
  lg: 1.6,
};

const DEFAULT_ROOT_PX = 16;
const ORIG_ATTR = "data-lp-fs"; // marker for the captured original

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

  // 1. Root font-size — covers Tailwind rem-based text (text-sm,
  //    text-xl, etc.) and any explicit em/rem inline values.
  document.documentElement.style.fontSize = `${DEFAULT_ROOT_PX * value}px`;

  // 2. Inline pixel font-sizes — walk the DOM and rewrite. Stored
  //    original on `data-lp-fs` so we always compute from the
  //    canonical value, never from the already-scaled current.
  scaleInlineFontSizes(value);

  // Defensive: previous deploys briefly used `body.zoom`, which
  // shrank widths and left empty gutters. Clear any leftover so users
  // upgrading don't keep the broken state.
  if (document.body.style.zoom) document.body.style.zoom = "";
}

// Re-scan the DOM and rewrite inline pixel font-sizes. Exported so the
// MutationObserver in FontScaleApplier can call it cheaply when React
// adds new nodes.
export function scaleInlineFontSizes(value: number): void {
  if (typeof document === "undefined") return;

  // Two cohorts: elements that already have an inline font-size (new
  // nodes) and elements we've already touched (data-lp-fs set). The
  // selector union covers both.
  const els = document.querySelectorAll<HTMLElement>(
    `[style*="font-size"], [${ORIG_ATTR}]`,
  );
  els.forEach((el) => {
    let origPx = parseFloat(el.getAttribute(ORIG_ATTR) ?? "");
    if (!Number.isFinite(origPx) || origPx <= 0) {
      // First time on this node. Capture the inline value (must be
      // px to be meaningful — em/rem/percent already follow root).
      const inline = el.style.fontSize;
      if (!inline.endsWith("px")) return;
      origPx = parseFloat(inline);
      if (!Number.isFinite(origPx) || origPx <= 0) return;
      el.setAttribute(ORIG_ATTR, String(origPx));
    }
    const next = `${(origPx * value).toFixed(2)}px`;
    if (el.style.fontSize !== next) el.style.fontSize = next;
  });
}
