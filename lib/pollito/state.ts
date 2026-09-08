/**
 * Pollito state resolver
 * Given user context, returns which of 4 emotional states the pollito should wear.
 * Assets resolve through the shared versioned club-avatar catalog.
 */

import { getPollitoImage, type PollitoState } from "../pollitos";

export type PollitoEstado = PollitoState;

export interface PollitoContext {
  rank?: number;
  totalPlayers?: number;
  recentDelta?: number;
  wrongStreak?: number;
  isOnboarding?: boolean;
  isEmptyState?: boolean;
}

export function resolvePollitoState(ctx: PollitoContext): PollitoEstado {
  const { rank, totalPlayers, wrongStreak, isOnboarding, isEmptyState } = ctx;

  if (isOnboarding || isEmptyState) return "base";
  if (rank === 1) return "lider";
  if (wrongStreak && wrongStreak >= 3) return "triste";
  if (rank && totalPlayers && rank === totalPlayers) return "triste";
  if (rank && rank >= 2 && rank <= 4) return "peleando";
  return "base";
}

export function getPollitoAssetPath(type: string, estado: PollitoEstado): string {
  return getPollitoImage(type, estado);
}
