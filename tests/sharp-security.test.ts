import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// Check the native runtime Next actually loads, including Linux CI binaries.
// https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w
const requireNext = createRequire(createRequire(import.meta.url).resolve("next/package.json"));
const sharp = requireNext("sharp") as {
  (input: Buffer): { png(): { toBuffer(options: { resolveWithObject: true }): Promise<{ data: Buffer; info: { width: number; height: number; format: string } }> } };
  versions: { sharp: string; rsvg: string };
};

function atLeast(actual: string, minimum: number[]): boolean {
  const parts = actual.split(".").map(Number);
  for (let index = 0; index < minimum.length; index++) {
    if (parts[index] !== minimum[index]) return parts[index] > minimum[index];
  }
  return true;
}

describe("Next native image security", () => {
  it("loads patched sharp and librsvg instead of an older native installation", () => {
    expect(atLeast(sharp.versions.sharp, [0, 35, 5])).toBe(true);
    expect(atLeast(sharp.versions.rsvg, [2, 63, 2])).toBe(true);
  });

  it("still renders a bounded, trusted SVG to the expected PNG dimensions", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16"><rect width="24" height="16" fill="#FFD700"/></svg>');
    const result = await sharp(svg).png().toBuffer({ resolveWithObject: true });
    expect(result.info).toMatchObject({ width: 24, height: 16, format: "png" });
    expect(result.data.subarray(1, 4).toString()).toBe("PNG");
  });
});
