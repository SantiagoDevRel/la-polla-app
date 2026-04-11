// lib/pollitos.ts — Pollito avatar system helpers
// avatar_url in users table stores the pollito type string (e.g. "arbitro", "goleador")

export const POLLITO_TYPES = [
  { id: 'arbitro', label: 'Árbitro' },
  { id: 'arquero', label: 'Arquero' },
  { id: 'capitan', label: 'Capitán' },
  { id: 'costeno', label: 'Costeño' },
  { id: 'gambeteador', label: 'Gambeteador' },
  { id: 'goleador', label: 'Goleador' },
  { id: 'negro', label: 'Chocoano' },
  { id: 'paisa', label: 'Mexicano' },
  { id: 'pibe', label: 'El Pibe' },
  { id: 'rasta', label: 'Bob Marley' },
  { id: 'rolo', label: 'Rolo' },
  { id: 'tigre', label: 'El Tigre' },
  { id: 'dim', label: 'Hincha Rojo' },
  { id: 'envigado', label: 'Hincha Naranja' },
  { id: 'millos', label: 'Hincha Azul' },
  { id: 'verde', label: 'Hincha Verde' },
] as const;

export const DEFAULT_POLLITO = 'goleador';

// Use everywhere OUTSIDE the leaderboard (profile, nav, cards)
export function getPollitoBase(pollitoType: string | null | undefined): string {
  const type = pollitoType || DEFAULT_POLLITO;
  return `/pollitos/pollito_${type}_base.webp`;
}

// Use ONLY inside polla leaderboard
export function getPollitoByPosition(
  pollitoType: string | null | undefined,
  position: number,
  totalParticipants: number
): string {
  const type = pollitoType || DEFAULT_POLLITO;
  if (position === 1) return `/pollitos/pollito_${type}_lider.webp`;
  if (position === totalParticipants) return `/pollitos/pollito_${type}_triste.webp`;
  return `/pollitos/pollito_${type}_peleando.webp`;
}
