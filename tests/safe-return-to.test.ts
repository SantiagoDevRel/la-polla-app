import { describe, expect, it } from "vitest";
import { safeReturnTo } from "@/lib/auth/safe-return-to";

describe("safeReturnTo", () => {
  it("keeps internal paths with query and hash", () => {
    expect(safeReturnTo("/")).toBe("/");
    expect(safeReturnTo("/casa")).toBe("/casa");
    expect(safeReturnTo("/pollas/mundial-2026?tab=tabla#top")).toBe("/pollas/mundial-2026?tab=tabla#top");
    expect(safeReturnTo("/invites/abc123")).toBe("/invites/abc123");
  });

  it("rejects empty, absolute and protocol-relative targets", () => {
    for (const raw of [null, undefined, "", "casa", "https://evil.example/x", "//evil.example/x",
      "/\\evil.example/x","javascript:alert(1)", "/redirect?to=https://evil.example"]) {
      expect(safeReturnTo(raw)).toBeNull();
    }
  });

  it("rejects control characters and spaces that the URL parser strips into //host", () => {
    for (const ch of ["\t", "\n", "\r", "\u0000", "\u001f", " "]) {
      expect(safeReturnTo(`/${ch}/evil.example/phish`)).toBeNull();
      expect(safeReturnTo(`/casa${ch}`)).toBeNull();
    }
  });

  it("never returns a value that resolves to another origin", () => {
    const base = "https://lapollacolombiana.com";
    for (const raw of ["/\t/evil.example/x", "/\n/evil.example/x", "/\r\n/evil.example", "/ /evil.example"]) {
      const out = safeReturnTo(raw);
      if (out !== null) expect(new URL(out, base).origin).toBe(base);
    }
  });
});
