import { describe, it, expect } from "vitest";
import { calculatePoints } from "./points";

// 5-tier scoring contract:
//   1) exact score → 5
//   2) correct winner + same goal diff → 3
//   3) correct winner only → 2
//   4) one team's score exact (wrong winner) → 1
//   5) nothing → 0

describe("calculatePoints", () => {
  it("tier 1: returns 5 for exact match", () => {
    expect(
      calculatePoints({ homeScore: 2, awayScore: 1 }, { homeScore: 2, awayScore: 1 }),
    ).toBe(5);
  });

  it("tier 1 also fires for 0-0", () => {
    expect(
      calculatePoints({ homeScore: 0, awayScore: 0 }, { homeScore: 0, awayScore: 0 }),
    ).toBe(5);
  });

  it("tier 2: correct winner + same goal diff → 3", () => {
    // Predicted home wins by 1, actual home wins by 1, scores differ.
    expect(
      calculatePoints({ homeScore: 3, awayScore: 2 }, { homeScore: 2, awayScore: 1 }),
    ).toBe(3);
  });

  it("tier 3: correct winner with different goal diff → 2", () => {
    // Predicted home wins by 2, actual home wins by 3.
    expect(
      calculatePoints({ homeScore: 2, awayScore: 0 }, { homeScore: 3, awayScore: 0 }),
    ).toBe(2);
  });

  it("tier 4: wrong winner but home score exact → 1", () => {
    // Predicted home win 2-0, actual away win 2-3. home matches.
    expect(
      calculatePoints({ homeScore: 2, awayScore: 0 }, { homeScore: 2, awayScore: 3 }),
    ).toBe(1);
  });

  it("tier 4: wrong winner but away score exact → 1", () => {
    expect(
      calculatePoints({ homeScore: 0, awayScore: 2 }, { homeScore: 3, awayScore: 2 }),
    ).toBe(1);
  });

  it("tier 5: completely wrong → 0", () => {
    expect(
      calculatePoints({ homeScore: 1, awayScore: 0 }, { homeScore: 0, awayScore: 3 }),
    ).toBe(0);
  });

  it("draw correct + same goal diff (0 vs 0) → tier 2 (3 pts)", () => {
    // Predicted 1-1, actual 2-2: both draw, diff=0, scores differ → tier 2.
    expect(
      calculatePoints({ homeScore: 1, awayScore: 1 }, { homeScore: 2, awayScore: 2 }),
    ).toBe(3);
  });

  it("respects custom scoring overrides", () => {
    expect(
      calculatePoints(
        { homeScore: 2, awayScore: 1 },
        { homeScore: 2, awayScore: 1 },
        { pointsExact: 10 },
      ),
    ).toBe(10);
  });
});
