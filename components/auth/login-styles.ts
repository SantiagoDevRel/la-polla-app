// components/auth/login-styles.ts — Clases compartidas de las tarjetas y
// botones del login (/login y /login/telegram), para que la página del enlace
// de Telegram se vea igual que el resto del ingreso. Tokens del sistema; nada
// de colores sueltos.

export const LOGIN_CARD =
  "w-full max-w-md rounded-2xl p-6 space-y-5 bg-bg-card/80 backdrop-blur-sm border border-border-subtle";

export const LOGIN_TITLE = "font-display text-2xl text-gold tracking-wide outline-none break-words";

export const PRIMARY_BTN =
  "w-full min-h-[48px] bg-gold text-bg-base font-bold py-3 px-4 rounded-xl hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-base leading-snug inline-flex items-center justify-center gap-2 text-center break-words cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card";

// Secundario del sistema: borde sutil, sin oro, objetivo táctil ≥ 44 px.
export const SECONDARY_BTN =
  "w-full min-h-[44px] rounded-xl border border-border-subtle bg-transparent px-4 py-3 text-sm leading-snug font-medium text-text-primary hover:border-gold/30 hover:bg-bg-card-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold/40 transition-all duration-200 cursor-pointer inline-flex items-center justify-center gap-2 text-center break-words";

export const GHOST_BTN =
  "w-full min-h-[44px] text-text-secondary font-medium py-2 px-4 rounded-xl hover:text-gold hover:bg-bg-card-hover transition-colors flex items-center justify-center gap-1.5 text-sm leading-snug text-center cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold/40";

export const PRIMARY_GLOW = { boxShadow: "0 0 20px rgba(255, 215, 0, 0.15)" } as const;
