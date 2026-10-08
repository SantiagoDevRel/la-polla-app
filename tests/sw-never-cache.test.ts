// Every page that requires a session must be NetworkOnly in the service worker,
// so an offline visit never serves another moment's personal data from cache.
// The list lives in app/sw.ts; this test reads it from source because the
// worker module depends on the Serwist runtime and cannot be imported here.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function neverCachePatterns(): RegExp[] {
  const source = readFileSync(join(root, "app/sw.ts"), "utf8");
  const start = source.indexOf("const NEVER_CACHE_PATHS: RegExp[] = [");
  const end = source.indexOf("\n];", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source
    .slice(start, end)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("/") && !line.startsWith("//"))
    .map((line) => {
      const literal = line.replace(/,$/, "");
      const close = literal.lastIndexOf("/");
      return new RegExp(literal.slice(1, close), literal.slice(close + 1));
    });
}

// Route directories rendered by Next (no route groups, private folders, files).
function routeDirs(dir: string): string[] {
  return readdirSync(join(root, dir)).filter((name) => {
    if (/^[_([@.]/.test(name)) return false;
    return statSync(join(root, dir, name)).isDirectory();
  });
}

// Public pages may use the default page cache; everything else needs a session.
const PUBLIC_TOP_LEVEL = new Set([
  "api", // covered separately: /^\/api\//
  "fonts",
  "llms.txt",
  "matches",
  "partidos",
  "privacy",
  "soporte",
  "torneos",
  "tournaments",
]);

describe("service worker NetworkOnly coverage", () => {
  const patterns = neverCachePatterns();
  const isNetworkOnly = (path: string) => patterns.some((re) => re.test(path));

  it("parses the NEVER_CACHE_PATHS list", () => {
    expect(patterns.length).toBeGreaterThan(10);
    expect(isNetworkOnly("/api/casa/mis-pollas")).toBe(true);
  });

  it("covers every authenticated route group page", () => {
    const pages = [...routeDirs("app/(app)"), ...routeDirs("app/(auth)")];
    const missing = pages.filter((name) => !isNetworkOnly(`/${name}`));
    expect(missing).toEqual([]);
  });

  it("covers every non-public top-level page", () => {
    const pages = routeDirs("app").filter((name) => !PUBLIC_TOP_LEVEL.has(name));
    const missing = pages.filter((name) => !isNetworkOnly(`/${name}`));
    expect(missing).toEqual([]);
  });

  it("keeps invite links with tokens NetworkOnly", () => {
    expect(isNetworkOnly("/invites/polla/abc123")).toBe(true);
    expect(isNetworkOnly("/invites/abc123")).toBe(true);
  });

  it("leaves public pages cacheable", () => {
    expect(isNetworkOnly("/torneos/mundial-2026")).toBe(false);
    expect(isNetworkOnly("/privacy")).toBe(false);
  });
});
