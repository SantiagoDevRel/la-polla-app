import { describe, it, expect } from "vitest";
import { normalizePhone, emailForPhone } from "./phone";

describe("normalizePhone", () => {
  it("strips the leading +", () => {
    expect(normalizePhone("+573117312391")).toBe("573117312391");
  });

  it("strips spaces, dashes, and parens", () => {
    expect(normalizePhone("+57 311-731-2391")).toBe("573117312391");
    expect(normalizePhone("(57) 311 7312391")).toBe("573117312391");
  });

  it("keeps already-clean numbers unchanged", () => {
    expect(normalizePhone("573117312391")).toBe("573117312391");
  });

  it("returns empty string for empty/null/undefined input", () => {
    expect(normalizePhone("")).toBe("");
    // @ts-expect-error null is not in the signature but the function defends
    expect(normalizePhone(null)).toBe("");
    // @ts-expect-error same as above for undefined
    expect(normalizePhone(undefined)).toBe("");
  });
});

describe("emailForPhone", () => {
  it("derives a deterministic internal email from the phone", () => {
    expect(emailForPhone("+573117312391")).toBe(
      "573117312391@wa.lapolla.app",
    );
  });

  it("normalizes the phone before deriving the email", () => {
    expect(emailForPhone("+57 311-731-2391")).toBe(
      "573117312391@wa.lapolla.app",
    );
  });
});
