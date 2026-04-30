// lib/pollas/payout-allocation.test.ts
// Exhaustive coverage of computePayout. Each test names a real-world
// scenario and asserts: no errors, sum-of-allocations == pot, and the
// transaction shape is what a human would draw on a napkin.
//
// All COP amounts are integer pesos. Tests use small round numbers
// (10k, 20k, 100k) to keep the assertions readable.

import { describe, it, expect } from "vitest";
import { computePayout, type ParticipantForPayout, type PrizeDistribution } from "./payout-allocation";

const ADMIN_ID = "admin-uid";
const A = "user-a";
const B = "user-b";
const C = "user-c";
const D = "user-d";
const E = "user-e";

function part(user_id: string, rank: number, joined_at = "2026-01-01T00:00:00Z"): ParticipantForPayout {
  return { user_id, display_name: user_id.toUpperCase(), rank, joined_at };
}

function totalAlloc(out: ReturnType<typeof computePayout>): number {
  return out.allocations.reduce((s, a) => s + a.allocation, 0);
}

function balancesAfterPayWinner(
  participants: ParticipantForPayout[],
  buyIn: number,
  out: ReturnType<typeof computePayout>,
): Map<string, number> {
  // pay_winner mode: nobody pays upfront, each user starts at 0. After
  // the settlement transactions, each user's actual cash position should
  // equal their EXPECTED net = (allocation - buy_in). We return
  //   diff[user] = real_cash - expected
  // and the test asserts every entry is 0.
  const real = new Map<string, number>();
  for (const p of participants) real.set(p.user_id, 0);
  for (const t of out.transactions) {
    real.set(t.from_user_id, (real.get(t.from_user_id) ?? 0) - t.amount);
    real.set(t.to_user_id, (real.get(t.to_user_id) ?? 0) + t.amount);
  }
  const diff = new Map<string, number>();
  for (const p of participants) {
    const alloc = out.allocations.find((a) => a.user_id === p.user_id)?.allocation ?? 0;
    const expected = alloc - buyIn;
    diff.set(p.user_id, (real.get(p.user_id) ?? 0) - expected);
  }
  return diff;
}

function balancesAfterAdminCollects(
  participants: ParticipantForPayout[],
  buyIn: number,
  out: ReturnType<typeof computePayout>,
  adminId: string,
): Map<string, number> {
  // In admin_collects, the admin already holds the pot. Net pre-tx:
  //   admin = +pot - own_buy_in (if also a participant); each participant
  //   = -buy_in + their_allocation. After admin pays each winner, every
  //   participant should hold (allocation - buy_in) and admin should
  //   hold zero (or their own allocation - their own buy_in).
  const pot = participants.length * buyIn;
  const m = new Map<string, number>();
  for (const p of participants) m.set(p.user_id, -buyIn);
  if (!m.has(adminId)) m.set(adminId, 0);
  m.set(adminId, (m.get(adminId) ?? 0) + pot);
  for (const a of out.allocations) {
    m.set(a.user_id, (m.get(a.user_id) ?? 0) - 0); // alloc not yet paid
  }
  for (const t of out.transactions) {
    m.set(t.from_user_id, (m.get(t.from_user_id) ?? 0) - t.amount);
    m.set(t.to_user_id, (m.get(t.to_user_id) ?? 0) + t.amount);
  }
  return m;
}

const PCT = (entries: Array<[number, number]>): PrizeDistribution => ({
  mode: "percentage",
  prizes: entries.map(([position, value]) => ({ position, value })),
});

const COP = (entries: Array<[number, number]>): PrizeDistribution => ({
  mode: "cop",
  prizes: entries.map(([position, value]) => ({ position, value })),
});

describe("computePayout — basic shapes", () => {
  it("winner-takes-all (NULL distribution) defaults to 100% to 1st", () => {
    const out = computePayout({
      participants: [part(A, 1), part(B, 2), part(C, 3)],
      prizeDistribution: null,
      pot: 60_000,
      buyIn: 20_000,
      paymentMode: "pay_winner",
      adminUserId: ADMIN_ID,
    });
    expect(out.errors).toEqual([]);
    expect(out.allocations.find((x) => x.user_id === A)!.allocation).toBe(60_000);
    expect(out.allocations.find((x) => x.user_id === B)!.allocation).toBe(0);
    expect(out.allocations.find((x) => x.user_id === C)!.allocation).toBe(0);
    expect(totalAlloc(out)).toBe(60_000);
  });

  it("80/20 with 5 participants, no ties — sums exactly", () => {
    const out = computePayout({
      participants: [part(A, 1), part(B, 2), part(C, 3), part(D, 4), part(E, 5)],
      prizeDistribution: PCT([[1, 80], [2, 20]]),
      pot: 100_000,
      buyIn: 20_000,
      paymentMode: "pay_winner",
      adminUserId: ADMIN_ID,
    });
    expect(out.errors).toEqual([]);
    expect(out.allocations.find((x) => x.user_id === A)!.allocation).toBe(80_000);
    expect(out.allocations.find((x) => x.user_id === B)!.allocation).toBe(20_000);
    expect(out.allocations.find((x) => x.user_id === C)!.allocation).toBe(0);
    expect(totalAlloc(out)).toBe(100_000);
  });

  it("70/25/5 with 5 participants — sums exactly", () => {
    const out = computePayout({
      participants: [part(A, 1), part(B, 2), part(C, 3), part(D, 4), part(E, 5)],
      prizeDistribution: PCT([[1, 70], [2, 25], [3, 5]]),
      pot: 100_000,
      buyIn: 20_000,
      paymentMode: "pay_winner",
      adminUserId: ADMIN_ID,
    });
    expect(out.errors).toEqual([]);
    expect(out.allocations.find((x) => x.user_id === A)!.allocation).toBe(70_000);
    expect(out.allocations.find((x) => x.user_id === B)!.allocation).toBe(25_000);
    expect(out.allocations.find((x) => x.user_id === C)!.allocation).toBe(5_000);
    expect(totalAlloc(out)).toBe(100_000);
  });

  it("50/30/20 sums exactly", () => {
    const out = computePayout({
      participants: [part(A, 1), part(B, 2), part(C, 3)],
      prizeDistribution: PCT([[1, 50], [2, 30], [3, 20]]),
      pot: 60_000,
      buyIn: 20_000,
      paymentMode: "pay_winner",
      adminUserId: ADMIN_ID,
    });
    expect(out.errors).toEqual([]);
    expect(out.allocations.find((x) => x.user_id === A)!.allocation).toBe(30_000);
    expect(out.allocations.find((x) => x.user_id === B)!.allocation).toBe(18_000);
    expect(out.allocations.find((x) => x.user_id === C)!.allocation).toBe(12_000);
  });
});

describe("computePayout — ties", () => {
  it("2 tied at rank 1 with 80/20 — split into halves", () => {
    const out = computePayout({
      participants: [part(A, 1, "2026-01-01T00:00:00Z"), part(B, 1, "2026-01-02T00:00:00Z"), part(C, 3)],
      prizeDistribution: PCT([[1, 80], [2, 20]]),
      pot: 60_000,
      buyIn: 20_000,
      paymentMode: "pay_winner",
      adminUserId: ADMIN_ID,
    });
    expect(out.errors).toEqual([]);
    // A and B each take (80+20)/2 = 50% pot = 30k
    expect(out.allocations.find((x) => x.user_id === A)!.allocation).toBe(30_000);
    expect(out.allocations.find((x) => x.user_id === B)!.allocation).toBe(30_000);
    expect(out.allocations.find((x) => x.user_id === C)!.allocation).toBe(0);
    expect(totalAlloc(out)).toBe(60_000);
  });

  it("3 tied at rank 1 with distribution 80/20 — fold position 3 into the group", () => {
    const out = computePayout({
      participants: [part(A, 1, "2026-01-01"), part(B, 1, "2026-01-02"), part(C, 1, "2026-01-03")],
      prizeDistribution: PCT([[1, 80], [2, 20]]),
      pot: 60_000,
      buyIn: 20_000,
      paymentMode: "pay_winner",
      adminUserId: ADMIN_ID,
    });
    expect(out.errors).toEqual([]);
    // Each gets pot/3 = 20k. They each paid 20k buy-in → net 0. No transactions.
    expect(out.allocations.every((a) => a.allocation === 20_000)).toBe(true);
    expect(out.transactions.length).toBe(0);
  });

  it("All tied at rank 1, 4 participants — even split, zero transactions", () => {
    const out = computePayout({
      participants: [part(A, 1, "2026-01-01"), part(B, 1, "2026-01-02"), part(C, 1, "2026-01-03"), part(D, 1, "2026-01-04")],
      prizeDistribution: PCT([[1, 70], [2, 30]]),
      pot: 80_000,
      buyIn: 20_000,
      paymentMode: "pay_winner",
      adminUserId: ADMIN_ID,
    });
    expect(out.errors).toEqual([]);
    expect(out.allocations.every((a) => a.allocation === 20_000)).toBe(true);
    expect(out.transactions.length).toBe(0);
  });

  it("2 tied at rank 1 + 2 tied at rank 3 with distribution 80/20", () => {
    const out = computePayout({
      participants: [
        part(A, 1, "2026-01-01"),
        part(B, 1, "2026-01-02"),
        part(C, 3, "2026-01-03"),
        part(D, 3, "2026-01-04"),
      ],
      prizeDistribution: PCT([[1, 80], [2, 20]]),
      pot: 80_000,
      buyIn: 20_000,
      paymentMode: "pay_winner",
      adminUserId: ADMIN_ID,
    });
    expect(out.errors).toEqual([]);
    // Group 1 covers positions [1,2] → weight 80+20=100 → 80k → 40k each.
    // Group 3 covers [3,4] → weight 0 → 0 each.
    expect(out.allocations.find((x) => x.user_id === A)!.allocation).toBe(40_000);
    expect(out.allocations.find((x) => x.user_id === B)!.allocation).toBe(40_000);
    expect(out.allocations.find((x) => x.user_id === C)!.allocation).toBe(0);
    expect(out.allocations.find((x) => x.user_id === D)!.allocation).toBe(0);
    expect(totalAlloc(out)).toBe(80_000);
  });

  it("Distribution defines positions past last participant — folds back into actives", () => {
    // 70/25/5, 2 participants. Position 3's 5% folds into positions 1-2.
    // Group 1 covers [1] → weight 70. Group 2 covers [2] → weight 25.
    // sumWeightsUsed = 95, sumWeights = 100. We scale by sumWeightsUsed.
    // A gets pot * 70/95 = 70/95 of pot, B gets 25/95.
    const out = computePayout({
      participants: [part(A, 1), part(B, 2)],
      prizeDistribution: PCT([[1, 70], [2, 25], [3, 5]]),
      pot: 95_000, // chosen so the math is integer
      buyIn: 47_500,
      paymentMode: "admin_collects",
      adminUserId: ADMIN_ID,
    });
    expect(out.errors).toEqual([]);
    expect(out.allocations.find((x) => x.user_id === A)!.allocation).toBe(70_000);
    expect(out.allocations.find((x) => x.user_id === B)!.allocation).toBe(25_000);
    expect(totalAlloc(out)).toBe(95_000);
  });
});

describe("computePayout — admin_collects mode", () => {
  it("admin → each winner; admin self-pay skipped if admin won", () => {
    // Admin = A, A is rank 1, distribution 100/0 with 3 participants.
    const out = computePayout({
      participants: [part(A, 1), part(B, 2), part(C, 3)],
      prizeDistribution: PCT([[1, 100]]),
      pot: 60_000,
      buyIn: 20_000,
      paymentMode: "admin_collects",
      adminUserId: A,
    });
    expect(out.errors).toEqual([]);
    expect(out.transactions.length).toBe(0); // admin already has the pot
    expect(out.allocations.find((x) => x.user_id === A)!.allocation).toBe(60_000);
  });

  it("admin not a winner — pays each winner 1 transaction", () => {
    const out = computePayout({
      participants: [part(A, 1), part(B, 2), part(C, 3)],
      prizeDistribution: PCT([[1, 80], [2, 20]]),
      pot: 60_000,
      buyIn: 20_000,
      paymentMode: "admin_collects",
      adminUserId: ADMIN_ID, // not in participants — admin is just the org
    });
    expect(out.errors).toEqual([]);
    expect(out.transactions.length).toBe(2);
    expect(out.transactions.find((t) => t.to_user_id === A)!.amount).toBe(48_000);
    expect(out.transactions.find((t) => t.to_user_id === B)!.amount).toBe(12_000);
    expect(out.transactions.find((t) => t.to_user_id === C)).toBeUndefined();
  });

  it("admin is also a participant and a winner — only pays others", () => {
    const out = computePayout({
      participants: [part(ADMIN_ID, 1), part(A, 2), part(B, 3)],
      prizeDistribution: PCT([[1, 70], [2, 30]]),
      pot: 60_000,
      buyIn: 20_000,
      paymentMode: "admin_collects",
      adminUserId: ADMIN_ID,
    });
    expect(out.errors).toEqual([]);
    expect(out.transactions.length).toBe(1);
    expect(out.transactions[0].from_user_id).toBe(ADMIN_ID);
    expect(out.transactions[0].to_user_id).toBe(A);
    expect(out.transactions[0].amount).toBe(18_000); // 30% of 60k
  });
});

describe("computePayout — pay_winner mode (greedy)", () => {
  it("80/20 with 5 participants → minimal transactions, all balances close to zero", () => {
    const participants = [part(A, 1), part(B, 2), part(C, 3), part(D, 4), part(E, 5)];
    const out = computePayout({
      participants,
      prizeDistribution: PCT([[1, 80], [2, 20]]),
      pot: 100_000,
      buyIn: 20_000,
      paymentMode: "pay_winner",
      adminUserId: ADMIN_ID,
    });
    expect(out.errors).toEqual([]);
    // A net = +60k, B = 0, C/D/E = -20k each. Total nets = 0.
    // Expected: 3 losers each pay 20k to A. (B is balanced — no tx.)
    expect(out.transactions.length).toBe(3);
    expect(out.transactions.every((t) => t.to_user_id === A && t.amount === 20_000)).toBe(true);
    const balances = balancesAfterPayWinner(participants, 20_000, out);
    for (const b of Array.from(balances.values())) expect(b).toBe(0);
  });

  it("100/0/0 with 4 participants → 3 losers each pay buy-in to winner", () => {
    const participants = [part(A, 1), part(B, 2), part(C, 3), part(D, 4)];
    const out = computePayout({
      participants,
      prizeDistribution: PCT([[1, 100]]),
      pot: 80_000,
      buyIn: 20_000,
      paymentMode: "pay_winner",
      adminUserId: ADMIN_ID,
    });
    expect(out.errors).toEqual([]);
    expect(out.transactions.length).toBe(3);
    expect(out.transactions.every((t) => t.to_user_id === A && t.amount === 20_000)).toBe(true);
  });

  it("70/25/5 — multi-creditor greedy settlement", () => {
    const participants = [part(A, 1), part(B, 2), part(C, 3), part(D, 4), part(E, 5)];
    const out = computePayout({
      participants,
      prizeDistribution: PCT([[1, 70], [2, 25], [3, 5]]),
      pot: 100_000,
      buyIn: 20_000,
      paymentMode: "pay_winner",
      adminUserId: ADMIN_ID,
    });
    expect(out.errors).toEqual([]);
    // Nets: A=+50, B=+5, C=-15, D=-20, E=-20.
    // Greedy: D pays A 20, E pays A 20, C pays A 10, C pays B 5.
    // Or similar minimal ≤ 4 transactions.
    const balances = balancesAfterPayWinner(participants, 20_000, out);
    for (const b of Array.from(balances.values())) expect(b).toBe(0);
    expect(out.transactions.length).toBeLessThanOrEqual(4);
  });

  it("All tied at rank 1 — zero transactions", () => {
    const participants = [
      part(A, 1, "2026-01-01"),
      part(B, 1, "2026-01-02"),
      part(C, 1, "2026-01-03"),
    ];
    const out = computePayout({
      participants,
      prizeDistribution: PCT([[1, 80], [2, 20]]),
      pot: 60_000,
      buyIn: 20_000,
      paymentMode: "pay_winner",
      adminUserId: ADMIN_ID,
    });
    expect(out.transactions.length).toBe(0);
  });
});

describe("computePayout — COP mode", () => {
  it("cop mode equal to pot — exact", () => {
    const out = computePayout({
      participants: [part(A, 1), part(B, 2), part(C, 3)],
      prizeDistribution: COP([[1, 50_000], [2, 30_000], [3, 20_000]]),
      pot: 100_000,
      buyIn: 33_334,
      paymentMode: "admin_collects",
      adminUserId: ADMIN_ID,
    });
    expect(out.errors).toEqual([]);
    expect(out.allocations.find((x) => x.user_id === A)!.allocation).toBe(50_000);
    expect(out.allocations.find((x) => x.user_id === B)!.allocation).toBe(30_000);
    expect(out.allocations.find((x) => x.user_id === C)!.allocation).toBe(20_000);
    expect(totalAlloc(out)).toBe(100_000);
  });

  it("cop sum > pot — error", () => {
    const out = computePayout({
      participants: [part(A, 1), part(B, 2)],
      prizeDistribution: COP([[1, 80_000], [2, 30_000]]),
      pot: 100_000,
      buyIn: 50_000,
      paymentMode: "admin_collects",
      adminUserId: ADMIN_ID,
    });
    expect(out.errors.length).toBeGreaterThan(0);
    expect(out.transactions.length).toBe(0);
  });

  it("cop sum < pot — warning, scaled to pot", () => {
    const out = computePayout({
      participants: [part(A, 1), part(B, 2)],
      prizeDistribution: COP([[1, 50_000], [2, 30_000]]),
      pot: 100_000, // 20k more than distribution sum
      buyIn: 50_000,
      paymentMode: "admin_collects",
      adminUserId: ADMIN_ID,
    });
    expect(out.errors).toEqual([]);
    expect(out.warnings.length).toBeGreaterThan(0);
    // Scaled: 50/80 of 100k = 62500, 30/80 of 100k = 37500
    expect(out.allocations.find((x) => x.user_id === A)!.allocation).toBe(62_500);
    expect(out.allocations.find((x) => x.user_id === B)!.allocation).toBe(37_500);
    expect(totalAlloc(out)).toBe(100_000);
  });
});

describe("computePayout — invalid distributions", () => {
  it("percentage > 100% — error", () => {
    const out = computePayout({
      participants: [part(A, 1), part(B, 2)],
      prizeDistribution: PCT([[1, 80], [2, 30]]),
      pot: 40_000,
      buyIn: 20_000,
      paymentMode: "admin_collects",
      adminUserId: ADMIN_ID,
    });
    expect(out.errors.length).toBeGreaterThan(0);
  });

  it("percentage < 100% — warning + scale", () => {
    const out = computePayout({
      participants: [part(A, 1), part(B, 2)],
      prizeDistribution: PCT([[1, 60], [2, 30]]),
      pot: 40_000,
      buyIn: 20_000,
      paymentMode: "admin_collects",
      adminUserId: ADMIN_ID,
    });
    expect(out.errors).toEqual([]);
    expect(out.warnings.length).toBeGreaterThan(0);
    expect(totalAlloc(out)).toBe(40_000);
  });

  it("negative weight — error", () => {
    const out = computePayout({
      participants: [part(A, 1)],
      prizeDistribution: PCT([[1, -10], [2, 110]]),
      pot: 20_000,
      buyIn: 20_000,
      paymentMode: "admin_collects",
      adminUserId: ADMIN_ID,
    });
    expect(out.errors.length).toBeGreaterThan(0);
  });

  it("all-zero distribution — error", () => {
    const out = computePayout({
      participants: [part(A, 1)],
      prizeDistribution: PCT([[1, 0], [2, 0]]),
      pot: 20_000,
      buyIn: 20_000,
      paymentMode: "admin_collects",
      adminUserId: ADMIN_ID,
    });
    expect(out.errors.length).toBeGreaterThan(0);
  });
});

describe("computePayout — degenerate inputs", () => {
  it("zero participants → empty result, no errors", () => {
    const out = computePayout({
      participants: [],
      prizeDistribution: PCT([[1, 100]]),
      pot: 0,
      buyIn: 0,
      paymentMode: "admin_collects",
      adminUserId: ADMIN_ID,
    });
    expect(out.allocations).toEqual([]);
    expect(out.transactions).toEqual([]);
    expect(out.errors).toEqual([]);
  });

  it("free polla (pot=0, buy_in=0) → all allocations 0, no tx", () => {
    const out = computePayout({
      participants: [part(A, 1), part(B, 2)],
      prizeDistribution: PCT([[1, 100]]),
      pot: 0,
      buyIn: 0,
      paymentMode: "pay_winner",
      adminUserId: ADMIN_ID,
    });
    expect(out.errors).toEqual([]);
    expect(out.transactions.length).toBe(0);
    expect(totalAlloc(out)).toBe(0);
  });

  it("pay_winner with buy_in=0 but pot>0 → error (misconfigured)", () => {
    const out = computePayout({
      participants: [part(A, 1), part(B, 2)],
      prizeDistribution: PCT([[1, 100]]),
      pot: 100_000,
      buyIn: 0,
      paymentMode: "pay_winner",
      adminUserId: ADMIN_ID,
    });
    expect(out.errors.length).toBeGreaterThan(0);
  });

  it("single participant — gets the whole pot, no transactions in pay_winner", () => {
    const out = computePayout({
      participants: [part(A, 1)],
      prizeDistribution: PCT([[1, 80], [2, 20]]),
      pot: 20_000,
      buyIn: 20_000,
      paymentMode: "pay_winner",
      adminUserId: ADMIN_ID,
    });
    expect(out.errors).toEqual([]);
    expect(out.allocations[0].allocation).toBe(20_000);
    expect(out.transactions.length).toBe(0);
  });
});

describe("computePayout — rounding", () => {
  it("3 tied at rank 1, pot=100 → sum equals 100 (no rounding loss)", () => {
    const out = computePayout({
      participants: [part(A, 1, "2026-01-01"), part(B, 1, "2026-01-02"), part(C, 1, "2026-01-03")],
      prizeDistribution: PCT([[1, 100]]),
      pot: 100,
      buyIn: 33,
      paymentMode: "admin_collects",
      adminUserId: ADMIN_ID,
    });
    expect(out.errors).toEqual([]);
    expect(totalAlloc(out)).toBe(100);
    // Highest joined (A) absorbs leftover peso.
    expect(out.allocations.find((x) => x.user_id === A)!.allocation).toBe(34);
    expect(out.allocations.find((x) => x.user_id === B)!.allocation).toBe(33);
    expect(out.allocations.find((x) => x.user_id === C)!.allocation).toBe(33);
  });

  it("70/25/5 with pot=99999 → still sums exactly to pot", () => {
    const out = computePayout({
      participants: [part(A, 1), part(B, 2), part(C, 3)],
      prizeDistribution: PCT([[1, 70], [2, 25], [3, 5]]),
      pot: 99_999,
      buyIn: 33_333,
      paymentMode: "admin_collects",
      adminUserId: ADMIN_ID,
    });
    expect(out.errors).toEqual([]);
    expect(totalAlloc(out)).toBe(99_999);
  });

  it("100 participants tied at rank 1 with pot=997 → still sums exactly", () => {
    const participants: ParticipantForPayout[] = [];
    for (let i = 0; i < 100; i++) {
      participants.push(part(`u-${i}`, 1, `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`));
    }
    const out = computePayout({
      participants,
      prizeDistribution: PCT([[1, 100]]),
      pot: 997,
      buyIn: 10,
      paymentMode: "admin_collects",
      adminUserId: ADMIN_ID,
    });
    expect(out.errors).toEqual([]);
    expect(totalAlloc(out)).toBe(997);
  });
});

describe("computePayout — settlement closes balances", () => {
  it("admin_collects: post-tx balances reflect alloc - buy_in for each", () => {
    const participants = [part(A, 1), part(B, 2), part(C, 3), part(D, 4)];
    const out = computePayout({
      participants,
      prizeDistribution: PCT([[1, 70], [2, 25], [3, 5]]),
      pot: 80_000,
      buyIn: 20_000,
      paymentMode: "admin_collects",
      adminUserId: ADMIN_ID,
    });
    const balances = balancesAfterAdminCollects(participants, 20_000, out, ADMIN_ID);
    // ADMIN held the pot (80k), paid out totalAllocated. ADMIN balance = 80k - totalAlloc - own_buyin (admin not in participants here, so no buyin debit beyond +pot).
    // Per-participant: (allocation - buy_in).
    expect(balances.get(A)).toBe(56_000 - 20_000); // 70% * 80k = 56k
    expect(balances.get(B)).toBe(20_000 - 20_000); // 25% * 80k = 20k
    expect(balances.get(C)).toBe(4_000 - 20_000); // 5% * 80k = 4k
    expect(balances.get(D)).toBe(-20_000);
    // ADMIN: held pot, paid out totalAllocated → admin should be at 0
    // (admin doesn't have a buy-in here because they're not a participant).
    expect(balances.get(ADMIN_ID)).toBe(80_000 - 80_000);
  });
});
