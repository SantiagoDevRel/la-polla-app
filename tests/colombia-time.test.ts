import { afterEach, describe, expect, it } from "vitest";
import {
  colombiaDateKey,
  colombiaDateTimeToIso,
  formatColombiaDateTime,
  nextColombiaSaturdayInput,
  toColombiaDateTimeInput,
} from "../lib/time/colombia";

const originalTimeZone = process.env.TZ;
afterEach(() => {
  if (originalTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimeZone;
});

describe.each(["UTC", "Europe/Berlin", "America/Los_Angeles", "Asia/Tokyo"])(
  "Colombia dates from a device in %s",
  (timeZone) => {
    it("keeps UTC midnight in the previous Colombian calendar day", () => {
      process.env.TZ = timeZone;
      expect(colombiaDateKey("2026-09-15T00:00:00Z")).toBe("2026-09-14");
      expect(colombiaDateKey("2026-09-15T04:59:59Z")).toBe("2026-09-14");
      expect(colombiaDateKey("2026-09-15T05:00:00Z")).toBe("2026-09-15");
      expect(toColombiaDateTimeInput("2026-09-15T00:00:00Z")).toBe("2026-09-14T19:00");
    });

    it("saves the chosen Colombia hour across European summer/winter changes", () => {
      process.env.TZ = timeZone;
      for (const day of ["2026-03-29", "2026-09-13", "2026-10-25", "2026-12-31"]) {
        const input = `${day}T02:30`;
        expect(colombiaDateTimeToIso(input)).toBe(`${day}T07:30:00.000Z`);
        expect(toColombiaDateTimeInput(colombiaDateTimeToIso(input))).toBe(input);
      }
      expect(colombiaDateTimeToIso("2026-12-31T23:30")).toBe("2027-01-01T04:30:00.000Z");
    });

    it("uses the next Colombian Saturday even while the device is already on Sunday", () => {
      process.env.TZ = timeZone;
      expect(nextColombiaSaturdayInput(new Date("2026-09-13T00:00:00Z"))).toBe("2026-09-19T12:00");
      expect(nextColombiaSaturdayInput(new Date("2026-09-12T00:00:00Z"))).toBe("2026-09-12T12:00");
    });

    it("formats both languages with Colombia's date and time", () => {
      process.env.TZ = timeZone;
      const options: Intl.DateTimeFormatOptions = {
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      };
      expect(formatColombiaDateTime("2026-09-15T00:00:00Z", options, "en-US"))
        .toBe("09/14/2026, 19:00");
      expect(formatColombiaDateTime("2026-09-15T00:00:00Z", options, "es-CO"))
        .toBe("14/09/2026, 19:00");
    });
  },
);

it.each(["", "2026-02-30T12:00", "2026-13-01T12:00", "2026-09-13T24:00", "2026-09-13T10:60", "2026-09-13T10:00Z"])(
  "rejects an invalid calendar input: %s", (input) => {
    expect(() => colombiaDateTimeToIso(input)).toThrow(RangeError);
  },
);
