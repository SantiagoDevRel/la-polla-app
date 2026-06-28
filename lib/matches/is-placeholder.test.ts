import { describe, it, expect } from "vitest";
import { isPlaceholderTeam, inferWorldCupKnockoutPhase } from "./is-placeholder";

describe("isPlaceholderTeam", () => {
  it("códigos de bracket (api-football/openfootball) → placeholder", () => {
    for (const s of ["TBD", "1A", "2B", "3A/B/C/D/F", "W73", "W104", "L101"]) {
      expect(isPlaceholderTeam(s)).toBe(true);
    }
  });

  it("labels de ESPN → placeholder (incl. los que rompieron el resolver)", () => {
    for (const s of [
      "Round of 32 1 Winner",
      "Quarterfinal 1 Winner", // ← el bug: antes daba false
      "Quarterfinal 4 Winner",
      "Semifinal 1 Winner",
      "Semifinal 2 Loser", // ← el bug
      "Group J 2nd Place",
      "Third Place Group E/F/G/I/J",
      "Winner Group A",
      "Loser Group B",
    ]) {
      expect(isPlaceholderTeam(s)).toBe(true);
    }
  });

  it("null/empty → placeholder defensivo", () => {
    expect(isPlaceholderTeam(null)).toBe(true);
    expect(isPlaceholderTeam(undefined)).toBe(true);
    expect(isPlaceholderTeam("   ")).toBe(true);
  });

  it("equipos REALES → NO placeholder (incl. ortografías raras)", () => {
    for (const s of [
      "Germany",
      "South Africa",
      "United States",
      "DR Congo",
      "Congo DR",
      "Cape Verde",
      "Cape Verde Islands",
      "Ivory Coast",
      "Bosnia-Herzegovina",
      "New Zealand",
      "Saudi Arabia",
    ]) {
      expect(isPlaceholderTeam(s)).toBe(false);
    }
  });
});

describe("inferWorldCupKnockoutPhase", () => {
  it("infiere la fase desde los códigos", () => {
    expect(inferWorldCupKnockoutPhase("1A", "2B")).toBe("round_of_32");
    expect(inferWorldCupKnockoutPhase("W74", "W77")).toBe("round_of_16");
    expect(inferWorldCupKnockoutPhase("W101", "W102")).toBe("final");
    expect(inferWorldCupKnockoutPhase("L101", "L102")).toBe("third_place");
    expect(inferWorldCupKnockoutPhase("Germany", "Paraguay")).toBe(null);
  });
});
