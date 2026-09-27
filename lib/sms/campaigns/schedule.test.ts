import { expect, it } from "vitest";
import { assertCampaignTime, colombiaHolidays, nextCampaignTime } from "./schedule";
import { colombiaDateTimeToIso } from "@/lib/time/colombia";

it("uses Colombia regardless of server zone and skips Sunday", () => {
  expect(colombiaDateTimeToIso("2026-09-28T12:00")).toBe("2026-09-28T17:00:00.000Z");
  expect(nextCampaignTime(new Date("2026-09-27T10:00Z"))).toBe("2026-09-28T12:00");
  expect(() => assertCampaignTime("2026-09-27T17:00Z", "2026-10-01", new Date("2026-09-27T10:00Z"))).toThrow();
});
it("calculates movable holidays and rejects Saturday afternoon and closed pools", () => {
  const holidays = colombiaHolidays(2026);
  for (const date of ["2026-01-12", "2026-04-02", "2026-04-03", "2026-05-18", "2026-06-08", "2026-06-15", "2026-11-16"]) expect(holidays.has(date)).toBe(true);
  expect(() => assertCampaignTime("2026-10-03T20:00Z", "2026-12-01", new Date("2026-09-27"))).toThrow();
  expect(() => assertCampaignTime("2026-09-28T17:00Z", "2026-09-28T16:00Z", new Date("2026-09-27"))).toThrow("cierre");
});
