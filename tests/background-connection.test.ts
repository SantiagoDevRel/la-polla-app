import { describe, expect, it } from "vitest";
import { getBackgroundPlaybackMode } from "@/lib/background-connection";

describe("background video connection policy", () => {
  it("preserves rotation when connection information is unavailable", () => {
    expect(getBackgroundPlaybackMode()).toBe("rotate");
  });

  it.each(["slow-2g", "2g", "3g"])(
    "keeps the zero-byte smoke on %s connections",
    (effectiveType) => {
      expect(getBackgroundPlaybackMode({ effectiveType })).toBe("off");
    },
  );

  it("honors the browser data-saver preference", () => {
    expect(
      getBackgroundPlaybackMode({
        saveData: true,
        effectiveType: "4g",
      }),
    ).toBe("off");
  });

  it("preserves rotation on every other reported connection", () => {
    expect(getBackgroundPlaybackMode({ effectiveType: "4g" })).toBe("rotate");
    expect(getBackgroundPlaybackMode({ effectiveType: "5g" })).toBe("rotate");
    expect(getBackgroundPlaybackMode({})).toBe("rotate");
  });
});
