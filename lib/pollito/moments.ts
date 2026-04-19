/**
 * Pollito scripted moments
 * Only these 8 moments trigger a pollito appearance.
 * See docs/design-system.md section 5.3 for full spec.
 */

import type { PollitoEstado } from "./state";

export type MomentKey = "M1" | "M2" | "M3" | "M4" | "M5" | "M6" | "M7" | "M8";

export interface Moment {
  key: MomentKey;
  estado: PollitoEstado;
  title: string;
  dialog: (vars: Record<string, string | number>) => string;
  display: "sheet" | "inline";
}

export const MOMENTS: Record<MomentKey, Moment> = {
  M1: {
    key: "M1",
    estado: "base",
    title: "Onboarding",
    dialog: () => "¿Primera polla? Dale. Yo te acompaño.",
    display: "sheet",
  },
  M2: {
    key: "M2",
    estado: "lider",
    title: "Polla creada",
    dialog: () => "¡Listo! Tu polla está viva. Invita a los panas.",
    display: "sheet",
  },
  M3: {
    key: "M3",
    estado: "lider",
    title: "Marcador exacto",
    dialog: (v) => `¡Pegaste el ${v.home}-${v.away} exacto! +5 puntos.`,
    display: "inline",
  },
  M4: {
    key: "M4",
    estado: "lider",
    title: "Subiste posiciones",
    dialog: (v) => `Subiste ${v.n} puestos. ${v.rank === 1 ? "Cima." : "Seguí así."}`,
    display: "inline",
  },
  M5: {
    key: "M5",
    estado: "peleando",
    title: "Cabeza a cabeza",
    dialog: (v) => `Estás a ${v.diff} pts de ${v.rival}. Un exacto y te despegás.`,
    display: "inline",
  },
  M6: {
    key: "M6",
    estado: "triste",
    title: "Racha mala",
    dialog: () => "Uff. Tres seguidas. Pero un exacto vale 5. Todavía.",
    display: "inline",
  },
  M7: {
    key: "M7",
    estado: "lider",
    title: "Ganaste la polla",
    dialog: (v) => `¡Ganaste la polla ${v.nombre}! Cobrá tu premio.`,
    display: "sheet",
  },
  M8: {
    key: "M8",
    estado: "triste",
    title: "Polla terminada",
    dialog: () => "Polla terminada. No te fue. La próxima es tuya.",
    display: "sheet",
  },
};

// Dismissal store — use localStorage, 24h TTL per moment key
const DISMISS_KEY = "pollito_dismissed";
const TTL_HOURS = 24;

export function isDismissed(moment: MomentKey): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const map = JSON.parse(raw) as Record<string, number>;
    const when = map[moment];
    if (!when) return false;
    const ageHours = (Date.now() - when) / 3_600_000;
    return ageHours < TTL_HOURS;
  } catch {
    return false;
  }
}

export function markDismissed(moment: MomentKey): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    map[moment] = Date.now();
    localStorage.setItem(DISMISS_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}
