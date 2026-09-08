// lib/pollitos.ts — Pollito avatar system helpers
// Keep the historical avatar_url IDs: existing users keep their chick identity.
// The club collection changes only the shirts; no profile migration is needed.

export const POLLITO_TYPES = [
  { id: 'verde', label: 'Atlético Nacional' },
  { id: 'millos', label: 'Millonarios' },
  { id: 'capitan', label: 'América de Cali' },
  { id: 'costeno', label: 'Junior' },
  { id: 'dim', label: 'Independiente Medellín' },
  { id: 'rolo', label: 'Santa Fe' },
  { id: 'gambeteador', label: 'Deportivo Cali' },
  { id: 'goleador', label: 'Deportes Tolima' },
  { id: 'arbitro', label: 'Once Caldas' },
  { id: 'negro', label: 'Deportivo Pereira' },
  { id: 'arquero', label: 'Atlético Bucaramanga' },
  { id: 'pasto', label: 'Deportivo Pasto' },
  { id: 'tigre', label: 'Cúcuta Deportivo' },
  { id: 'pibe', label: 'Unión Magdalena' },
  { id: 'rasta', label: 'Real Cartagena' },
  { id: 'paisa', label: 'Atlético Huila' },
  { id: 'envigado', label: 'Envigado' },
  { id: 'chico', label: 'Boyacá Chicó' },
  { id: 'equidad', label: 'La Equidad' },
  { id: 'aguilas', label: 'Águilas Doradas' },
] as const;

export const DEFAULT_POLLITO = 'goleador';

export type PollitoState = 'base' | 'lider' | 'peleando' | 'triste';

export function getPollitoImage(pollitoType: string | null | undefined, state: PollitoState): string {
  const type = POLLITO_TYPES.find((pollito) => pollito.id === pollitoType)?.id ?? DEFAULT_POLLITO;
  // Versioned path avoids stale browser/service-worker images after the shirt change.
  return `/pollitos/clubes-v1/pollito_${type}_${state}.webp`;
}

// Use everywhere OUTSIDE the leaderboard (profile, nav, cards)
export function getPollitoBase(pollitoType: string | null | undefined): string {
  return getPollitoImage(pollitoType, 'base');
}

// Use ONLY inside polla leaderboard
export function getPollitoByPosition(
  pollitoType: string | null | undefined,
  position: number,
  totalParticipants: number
): string {
  if (position === 1) return getPollitoImage(pollitoType, 'lider');
  if (position === totalParticipants) return getPollitoImage(pollitoType, 'triste');
  return getPollitoImage(pollitoType, 'peleando');
}
