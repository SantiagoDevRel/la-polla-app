import { describe, it, expect } from "vitest";
import { looksLikeMenuIntent } from "./menu-intent";

describe("looksLikeMenuIntent", () => {
  it("matches the exact bubble pre-text", () => {
    expect(looksLikeMenuIntent("hola parce, muestrame el menu porfa")).toBe(true);
  });

  it("matches plain greetings", () => {
    expect(looksLikeMenuIntent("hola")).toBe(true);
    expect(looksLikeMenuIntent("Hola")).toBe(true);
    expect(looksLikeMenuIntent("buenas")).toBe(true);
    expect(looksLikeMenuIntent("hey")).toBe(true);
    expect(looksLikeMenuIntent("ola")).toBe(true);
  });

  it("matches explicit menu requests", () => {
    expect(looksLikeMenuIntent("menu")).toBe(true);
    expect(looksLikeMenuIntent("menú")).toBe(true);
    expect(looksLikeMenuIntent("dame el menu")).toBe(true);
    expect(looksLikeMenuIntent("muestrame el menú")).toBe(true);
    expect(looksLikeMenuIntent("mostrame el menu")).toBe(true);
  });

  it("matches greetings with extra punctuation/text", () => {
    expect(looksLikeMenuIntent("hola parce!")).toBe(true);
    expect(looksLikeMenuIntent("buenas, ¿qué onda?")).toBe(true);
  });

  it("does NOT match score-style text (kept for prediction parsing)", () => {
    expect(looksLikeMenuIntent("2-1")).toBe(false);
    expect(looksLikeMenuIntent("3-0")).toBe(false);
  });

  it("does NOT match join codes (6-char alphabet)", () => {
    expect(looksLikeMenuIntent("ABCDEF")).toBe(false);
    expect(looksLikeMenuIntent("XYZABC")).toBe(false);
  });

  it("does NOT match yes/no replies", () => {
    expect(looksLikeMenuIntent("si")).toBe(false);
    expect(looksLikeMenuIntent("sí")).toBe(false);
    expect(looksLikeMenuIntent("no")).toBe(false);
  });

  it("rejects empty/whitespace input", () => {
    expect(looksLikeMenuIntent("")).toBe(false);
    expect(looksLikeMenuIntent("   ")).toBe(false);
  });
});
