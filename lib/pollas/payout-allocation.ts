// lib/pollas/payout-allocation.ts
// Pure-function payout settlement. No I/O, no Date.now() — deterministic
// given the inputs, so it tests cleanly and runs the same on the server,
// the client, or in unit tests.
//
// Given:
//   - participants[] (each with rank from RANK() — ties share a rank,
//     next rank skips: 1,1,3,...)
//   - prize_distribution (mode percentage|cop, list of {position,value})
//   - pot (integer COP — usually buy_in * approved+paid count)
//   - buy_in (integer COP per participant)
//   - payment_mode ('admin_collects' or 'pay_winner')
//   - admin_user_id (polla.created_by)
//
// Returns:
//   - allocations[] — per-participant prize in INTEGER pesos. Sums to pot.
//   - transactions[] — list of { from, to, amount } pesos > 0. In
//     admin_collects: admin → each non-admin winner. In pay_winner: a
//     greedy minimum-transaction settlement of net balances.
//   - errors[] — blocking; when present, allocations/transactions are
//     empty and the caller should refuse to settle until fixed.
//   - warnings[] — non-blocking, surfaced to the admin so they can
//     verify the auto-resolution (e.g., distribution sum < 100%).
//
// Tie handling:
//   ranks 1,1,3 with distribution 80/20:
//     - Group {1: [a,b]} covers positions [1,2] → group_weight = 80+20.
//     - Group {3: [c]} covers position [3] → weight 0.
//     - Each member of group 1 gets pot * 100/100 / 2 = pot/2.
//     - c gets 0.
//
// Distribution edge cases:
//   - NULL or empty → treated as winner-takes-all (100% to position 1).
//   - mode=percentage, sum < 100 → warn + scale (pot still fully
//     distributed across participants in the covered positions).
//   - mode=percentage, sum > 100 → ERROR.
//   - mode=cop, sum > pot → ERROR.
//   - mode=cop, sum < pot → warn + scale.
//   - Positions beyond the last participant → their weight is dropped
//     (we use sumWeightsUsed instead of sumWeights), so the pot is
//     fully allocated to active positions and never "vanishes" to
//     admin. Example: distribution 70/25/5 with 2 participants → the
//     5% folds into the 70/25 split.
//
// Settlement modes:
//   - admin_collects: admin already has the pot. Emits transactions
//     admin → each winner with allocation > 0, skipping admin paying
//     themselves.
//   - pay_winner: nobody collected. Greedy: net = allocation - buy_in
//     per participant. Total nets = pot - n*buy_in = 0 (math closes).
//     Match largest creditor with largest debtor, transfer min, repeat.
//     Yields ≤ n-1 transactions (typically far fewer).
//
// Rounding:
//   All allocations are integer pesos. Float perMember is computed,
//   then floored, then leftover_pesos is distributed +1 each to the
//   highest-ranked participant first. Guarantees sum == pot.

export type PrizeMode = "percentage" | "cop";

export interface PrizeDistribution {
  mode: PrizeMode;
  prizes: { position: number; value: number }[];
}

export interface ParticipantForPayout {
  user_id: string;
  display_name: string;
  rank: number; // 1-indexed; ties share rank.
  joined_at: string; // ISO; deterministic tiebreak inside a tied group.
}

export interface AllocationRow {
  user_id: string;
  display_name: string;
  rank: number;
  positions: number[]; // distribution positions this participant covers
  allocation: number; // integer pesos
  isTied: boolean;
}

export interface PayoutTransaction {
  from_user_id: string;
  to_user_id: string;
  amount: number; // integer pesos > 0
}

export type PaymentMode = "admin_collects" | "pay_winner";

export interface PayoutComputationArgs {
  participants: ParticipantForPayout[];
  prizeDistribution: PrizeDistribution | null;
  pot: number;
  buyIn: number;
  paymentMode: PaymentMode;
  adminUserId: string;
}

export interface PayoutComputation {
  allocations: AllocationRow[];
  transactions: PayoutTransaction[];
  pot: number;
  totalAllocated: number;
  errors: string[];
  warnings: string[];
}

const COP_TOLERANCE = 0.5; // accept tiny float drift on stored cop sums
const PCT_TOLERANCE = 0.01;

function defaultDistribution(): PrizeDistribution {
  return { mode: "percentage", prizes: [{ position: 1, value: 100 }] };
}

function fmtCOP(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CO")}`;
}

export function computePayout(args: PayoutComputationArgs): PayoutComputation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { paymentMode, adminUserId } = args;

  const pot = Math.max(0, Math.round(args.pot));
  const buyIn = Math.max(0, Math.round(args.buyIn));
  const participants = args.participants;
  const distribution = args.prizeDistribution && args.prizeDistribution.prizes.length > 0
    ? args.prizeDistribution
    : defaultDistribution();

  if (participants.length === 0) {
    return { allocations: [], transactions: [], pot, totalAllocated: 0, errors, warnings };
  }

  // Sort distribution positions ascending and build a 0-indexed weights[]
  // where weights[i] = value at position i+1. Positions not specified
  // get weight 0.
  const sortedPrizes = [...distribution.prizes]
    .filter((p) => Number.isFinite(p.position) && p.position >= 1)
    .sort((a, b) => a.position - b.position);

  const weights: number[] = [];
  for (const p of sortedPrizes) {
    while (weights.length < p.position) weights.push(0);
    weights[p.position - 1] = p.value;
  }
  for (const w of weights) {
    if (!Number.isFinite(w) || w < 0) {
      errors.push("La distribución contiene valores inválidos (negativos o no numéricos).");
      return { allocations: [], transactions: [], pot, totalAllocated: 0, errors, warnings };
    }
  }
  const sumWeights = weights.reduce((s, w) => s + w, 0);
  if (sumWeights <= 0) {
    errors.push("La distribución suma 0 — no hay nada que repartir.");
    return { allocations: [], transactions: [], pot, totalAllocated: 0, errors, warnings };
  }

  // Validate distribution shape vs pot.
  if (distribution.mode === "percentage") {
    if (sumWeights > 100 + PCT_TOLERANCE) {
      errors.push(`Los porcentajes suman ${sumWeights.toFixed(2)}% (más de 100%). Editá la distribución antes de cerrar.`);
      return { allocations: [], transactions: [], pot, totalAllocated: 0, errors, warnings };
    }
    if (sumWeights < 100 - PCT_TOLERANCE) {
      warnings.push(`Los porcentajes suman ${sumWeights.toFixed(2)}% (menos de 100%). Se reparte el pozo completo entre las posiciones definidas.`);
    }
  } else {
    if (pot > 0 && sumWeights > pot + COP_TOLERANCE) {
      errors.push(`La distribución suma ${fmtCOP(sumWeights)} pero el pozo es ${fmtCOP(pot)}. Editá la distribución.`);
      return { allocations: [], transactions: [], pot, totalAllocated: 0, errors, warnings };
    }
    if (pot > 0 && sumWeights < pot - COP_TOLERANCE) {
      warnings.push(`La distribución suma ${fmtCOP(sumWeights)}, menos que el pozo (${fmtCOP(pot)}). Se reparte el pozo completo.`);
    }
  }

  // Sort participants: rank ASC, then joined_at ASC. Stable across runs.
  const sortedParts = [...participants].sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.joined_at.localeCompare(b.joined_at);
  });

  // Group by rank.
  const groups: ParticipantForPayout[][] = [];
  for (const p of sortedParts) {
    const last = groups[groups.length - 1];
    if (last && last[0].rank === p.rank) last.push(p);
    else groups.push([p]);
  }

  // For each group, determine covered positions and group weight sum.
  // sumWeightsUsed = sum of weights actually covered by some group.
  // This makes the pot fully redistributable across the active
  // positions — distribution slots beyond the last participant fold
  // back into earlier slots proportionally.
  let positionCursor = 1;
  let sumWeightsUsed = 0;
  const groupInfo: Array<{ group: ParticipantForPayout[]; positions: number[]; groupWeight: number }> = [];
  for (const group of groups) {
    const n = group.length;
    const positions: number[] = [];
    let groupWeight = 0;
    for (let i = 0; i < n; i++) {
      const pos = positionCursor + i;
      positions.push(pos);
      groupWeight += weights[pos - 1] ?? 0;
    }
    sumWeightsUsed += groupWeight;
    groupInfo.push({ group, positions, groupWeight });
    positionCursor += n;
  }

  // Allocations. If sumWeightsUsed=0 (all positions defined are past the
  // last participant — pathological), fall back to even split.
  const allocFloat = new Map<string, number>();
  if (sumWeightsUsed <= 0) {
    warnings.push("La distribución no asigna valor a las posiciones cubiertas. Repartiendo el pozo en partes iguales.");
    const per = pot / sortedParts.length;
    for (const p of sortedParts) allocFloat.set(p.user_id, per);
  } else {
    for (const gi of groupInfo) {
      const groupTotal = (pot * gi.groupWeight) / sumWeightsUsed;
      const per = groupTotal / gi.group.length;
      for (const p of gi.group) allocFloat.set(p.user_id, per);
    }
  }

  // Round to integer pesos. Floor each, distribute leftover pesos
  // by rank order so the highest finishers absorb the +1's. Guarantees
  // sum(allocations) == pot exactly when pot > 0.
  const allocInt = new Map<string, number>();
  for (const p of sortedParts) {
    allocInt.set(p.user_id, Math.floor(allocFloat.get(p.user_id) ?? 0));
  }
  let leftover = pot - Array.from(allocInt.values()).reduce((s, x) => s + x, 0);
  // leftover is in [0, n) when float values are non-negative (which they are).
  for (const p of sortedParts) {
    if (leftover <= 0) break;
    allocInt.set(p.user_id, (allocInt.get(p.user_id) ?? 0) + 1);
    leftover -= 1;
  }
  // If somehow leftover < 0 (shouldn't with floor, but defensive against
  // float drift if pot tiny), pull back from lowest ranks.
  for (let i = sortedParts.length - 1; i >= 0 && leftover < 0; i--) {
    const uid = sortedParts[i].user_id;
    const cur = allocInt.get(uid) ?? 0;
    if (cur > 0) {
      allocInt.set(uid, cur - 1);
      leftover += 1;
    }
  }

  // Build allocation rows.
  const allocations: AllocationRow[] = [];
  for (let g = 0; g < groupInfo.length; g++) {
    const gi = groupInfo[g];
    for (const p of gi.group) {
      allocations.push({
        user_id: p.user_id,
        display_name: p.display_name,
        rank: p.rank,
        positions: gi.positions,
        allocation: allocInt.get(p.user_id) ?? 0,
        isTied: gi.group.length > 1,
      });
    }
  }
  const totalAllocated = allocations.reduce((s, a) => s + a.allocation, 0);

  // Build transactions.
  let transactions: PayoutTransaction[];
  if (paymentMode === "admin_collects") {
    transactions = [];
    for (const a of allocations) {
      if (a.allocation <= 0) continue;
      if (a.user_id === adminUserId) continue; // admin → admin self-pay skipped
      transactions.push({
        from_user_id: adminUserId,
        to_user_id: a.user_id,
        amount: a.allocation,
      });
    }
  } else {
    // pay_winner: greedy minimum transactions over net = alloc - buy_in.
    if (buyIn <= 0 && pot > 0) {
      errors.push("La polla es 'pago al final' pero el buy-in es 0 — no se puede liquidar. Revisá la configuración.");
      return { allocations, transactions: [], pot, totalAllocated, errors, warnings };
    }
    const balances: Array<{ uid: string; b: number }> = [];
    for (const a of allocations) {
      const net = a.allocation - buyIn;
      balances.push({ uid: a.user_id, b: net });
    }
    transactions = greedySettle(balances);
  }

  // Defensive: drop any zero-amount or self-pay transactions (shouldn't
  // occur but the DB CHECK constraint will reject self-pay either way).
  transactions = transactions.filter(
    (t) => t.amount > 0 && t.from_user_id !== t.to_user_id,
  );

  return { allocations, transactions, pot, totalAllocated, errors, warnings };
}

/** Greedy minimum-transaction settlement.
 *  Repeatedly: largest positive balance ← largest negative balance,
 *  transfer min(creditor, |debtor|), reduce both, repeat until empty.
 *  Mutates the input array's balance values.
 */
function greedySettle(balances: Array<{ uid: string; b: number }>): PayoutTransaction[] {
  const txs: PayoutTransaction[] = [];
  // Loop bound: at most 2*n iterations (each step zeroes at least one balance).
  const maxIter = balances.length * 2 + 4;
  for (let iter = 0; iter < maxIter; iter++) {
    let credIdx = -1;
    let debtIdx = -1;
    let credBal = 0;
    let debtBal = 0;
    for (let i = 0; i < balances.length; i++) {
      const x = balances[i].b;
      if (x > credBal) {
        credBal = x;
        credIdx = i;
      }
      if (x < debtBal) {
        debtBal = x;
        debtIdx = i;
      }
    }
    if (credIdx < 0 || debtIdx < 0) break;
    if (credBal <= 0 || debtBal >= 0) break;
    const amount = Math.min(credBal, -debtBal);
    if (amount <= 0) break;
    txs.push({
      from_user_id: balances[debtIdx].uid,
      to_user_id: balances[credIdx].uid,
      amount,
    });
    balances[credIdx].b -= amount;
    balances[debtIdx].b += amount;
  }
  return txs;
}
