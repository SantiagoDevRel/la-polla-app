import { describe, it, expect } from "vitest";
import { redactPhone, redactId, redactText } from "./log";

describe("redactPhone", () => {
  it("masks the middle but keeps the country prefix and last 3", () => {
    expect(redactPhone("573117312391")).toBe("57XXXXXXX391");
  });

  it("normalizes + and spaces before masking", () => {
    expect(redactPhone("+57 311-731-2391")).toBe("57XXXXXXX391");
  });

  it("returns *** for very short input", () => {
    expect(redactPhone("123")).toBe("***");
  });

  it("handles missing input", () => {
    expect(redactPhone(null)).toBe("(no phone)");
    expect(redactPhone(undefined)).toBe("(no phone)");
    expect(redactPhone("")).toBe("(no phone)");
  });

  it("does not include the actual middle digits", () => {
    const masked = redactPhone("573117312391");
    expect(masked).not.toContain("31173");
    expect(masked).not.toContain("11731");
  });
});

describe("redactId", () => {
  it("keeps prefix and suffix, masks the middle", () => {
    const id = "8c1f2a4e-b6c3-49a1-9e80-12abcd34ef56";
    const masked = redactId(id);
    expect(masked.startsWith("8c1f2")).toBe(true);
    expect(masked.endsWith("ef56")).toBe(true);
    expect(masked).not.toContain("a4e-b6c3");
  });

  it("returns *** for very short input", () => {
    expect(redactId("abc123")).toBe("***");
  });

  it("handles missing input", () => {
    expect(redactId(null)).toBe("(no id)");
  });
});

describe("redactText", () => {
  it("keeps the first N chars and reports total length", () => {
    expect(redactText("hola parce, mandame el código", 6)).toBe(
      "hola p… (29 chars)",
    );
  });

  it("returns the full text for short strings", () => {
    expect(redactText("ok", 6)).toBe("ok (2 chars)");
  });

  it("handles missing input", () => {
    expect(redactText(null)).toBe("(no text)");
  });
});
