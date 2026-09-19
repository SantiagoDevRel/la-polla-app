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
// (2026-09-19) Hay una TERCERA forma, y en Casa es la mayoría: clases de
// Tailwind en px (`text-[15px]`). Ni la raíz ni el barrido inline las tocan, así
// que el control casi no cambiaba nada en esas pantallas. En el teléfono se
// resuelve con `text-size-adjust` en <html>: el navegador multiplica TODO el
// texto (px, rem e inline) y deja quieto el layout — el mismo mecanismo del
// «Tamaño del texto» de Chrome en iPhone, contra el que la app ya está
// endurecida (las celdas con `[-webkit-text-size-adjust:none]` no crecen, a
// propósito). En escritorio los navegadores ignoran esa propiedad: se mide con
// una sonda y, si no aplica, queda el camino de siempre (raíz + inline). Nunca
// los dos a la vez: sería escalar dos veces.
//
// Storage is per-device (localStorage). A user might want bigger text
// on phone and default on desktop, and not having to round-trip the
// preference to the DB keeps things snappy with no extra endpoint.

export type FontScale = "sm" | "md" | "lg";

const STORAGE_KEY = "la_polla_font_scale";

// Numeric multipliers. md=1 is the canonical design baseline.
// sm at 0.5 was "zoom out too much" — Tailwind paddings/gaps are
// rem-based, so at 50% the layout collapsed inside cards (visually
// the screen looked like it had blank columns on the sides). 0.7
// scales the text noticeably without breaking the structure.
// lg stays aggressive because the user explicitly asked for +60%
// and didn't flag any layout issues there.
export const FONT_SCALE_VALUES: Record<FontScale, number> = {
  sm: 0.7,
  md: 1.0,
  lg: 1.6,
};

const DEFAULT_ROOT_PX = 16;
const ORIG_ATTR = "data-lp-fs"; // marker for the captured original

// true = este navegador obedece `text-size-adjust` y applyScale lo está usando;
// el barrido inline deja entonces los px en su valor original.
let adjustActive = false;
let adjustHonored: boolean | null = null;

// Sonda: dos bloques de 10 px, uno al 100 % y otro al 200 %. Si el segundo no
// mide más ancho, el navegador ignora la propiedad (escritorio, iPad en modo
// escritorio, algunos WebView). Se mide una sola vez por carga.
function textSizeAdjustHonored(): boolean {
  if (adjustHonored !== null) return adjustHonored;
  adjustHonored = false;
  try {
    const body = document.body;
    if (!body || typeof document.createElement !== "function") return false;
    const measure = (pct: string) => {
      const probe = document.createElement("div");
      probe.setAttribute("aria-hidden", "true");
      probe.style.cssText = `position:absolute;visibility:hidden;left:-9999px;top:0;white-space:nowrap;font-size:10px;line-height:1;-webkit-text-size-adjust:${pct};text-size-adjust:${pct}`;
      probe.textContent = "MMMMMMMMMM";
      body.appendChild(probe);
      const width = probe.getBoundingClientRect().width;
      probe.remove();
      return width;
    };
    const base = measure("100%");
    adjustHonored = base > 0 && measure("200%") > base * 1.5;
  } catch {
    adjustHonored = false;
  }
  return adjustHonored;
}

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
  const html = document.documentElement;

  adjustActive = textSizeAdjustHonored();
  if (adjustActive) {
    // Teléfono: el navegador escala todo el texto. La raíz se queda en su
    // tamaño base para no escalar dos veces lo que va en rem.
    const pct = `${Math.round(value * 100)}%`;
    html.style.fontSize = `${DEFAULT_ROOT_PX}px`;
    html.style.setProperty("-webkit-text-size-adjust", pct);
    html.style.setProperty("text-size-adjust", pct);
  } else {
    // 1. Root font-size — covers Tailwind rem-based text (text-sm,
    //    text-xl, etc.) and any explicit em/rem inline values.
    html.style.fontSize = `${DEFAULT_ROOT_PX * value}px`;
  }

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
  // Con text-size-adjust activo el navegador ya agranda los px inline: se
  // devuelven a su valor original (factor 1) en vez de multiplicarlos otra vez.
  const factor = adjustActive ? 1 : value;

  // Two cohorts: elements that already have an inline font-size (new
  // nodes) and elements we've already touched (data-lp-fs set). The
  // selector union covers both.
  const els = document.querySelectorAll<HTMLElement>(
    `[style*="font-size"], [${ORIG_ATTR}]`,
  );
  els.forEach((el) => {
    // (2026-09-19) <html> NO entra: su font-size inline es el que acaba de poner
    // applyScale (paso 1). Reescribirlo aquí lo escalaba DOS veces: «+60 %» daba
    // 16 × 1,6 × 1,6 = 40,96 px (2,56×) y «−30 %» 7,84 px (0,49×). Si una versión
    // anterior ya lo marcó, se limpia la marca para que no vuelva a pasar.
    if (el === document.documentElement) {
      if (el.hasAttribute(ORIG_ATTR)) el.removeAttribute(ORIG_ATTR);
      return;
    }
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
    const next = `${(origPx * factor).toFixed(2)}px`;
    if (el.style.fontSize !== next) el.style.fontSize = next;
  });
}
