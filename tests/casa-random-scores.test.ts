import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RANDOM_SCORELINES, randomScoreline, randomScoreOptions } from "@/lib/casa/random-scores";

const approved = [[0, 0], [1, 0], [0, 1], [2, 1], [1, 2], [1, 1], [2, 2]];
afterEach(() => vi.restoreAllMocks());

describe("approved managed-player random scores", () => {
  it("offers exactly the seven approved pairs in the board and SQL enrollment", () => {
    expect(RANDOM_SCORELINES).toEqual(approved);
    const sql = readFileSync(new URL("../supabase/migrations/172_casa_admin_approved_scorelines.sql", import.meta.url), "utf8");
    const catalog = sql.match(/VALUES ([\s\S]*?) allowed\(home,away\)/)?.[1] ?? "";
    expect([...catalog.matchAll(/\((\d+),(\d+)\)/g)].map(m => [Number(m[1]), Number(m[2])])).toEqual(approved);
  });
  it("can select every approved pair, including both RNG boundaries", () => {
    for (let i = 0; i < approved.length; i++) {
      vi.spyOn(Math, "random").mockReturnValue((i + 0.5) / approved.length);
      expect(randomScoreline()).toEqual(approved[i]);
      vi.restoreAllMocks();
    }
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(randomScoreline()).toEqual([0, 0]);
    vi.mocked(Math.random).mockReturnValue(1 - Number.EPSILON);
    expect(randomScoreline()).toEqual([2, 2]);
  });
  it("completes partial scores only with compatible pairs and preserves zero", () => {
    expect(randomScoreOptions({ homeScore: 0 })).toEqual([[0, 0], [0, 1]]);
    expect(randomScoreOptions({ awayScore: 0 })).toEqual([[0, 0], [1, 0]]);
    expect(randomScoreOptions({ homeScore: 2 })).toEqual([[2, 1], [2, 2]]);
    expect(randomScoreOptions({ homeScore: 0, awayScore: 0 })).toEqual([[0, 0]]);
    for (const input of [{ homeScore: 3 }, { awayScore: 4 }, { homeScore: 2, awayScore: 0 }]) {
      expect(randomScoreline(input)).toBeNull();
    }
  });
});
