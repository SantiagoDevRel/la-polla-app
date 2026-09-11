import { describe, expect, it } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config } from "@/proxy";

function matches(url: string): boolean {
  return unstable_doesMiddlewareMatch({ config, url, nextConfig: {} });
}

describe("proxy matcher", () => {
  it.each([
    "https://lapollacolombiana.com/videos/nuevo-background-lite.mp4",
    "https://lapollacolombiana.com/videos/nuevo-background.webm",
    "https://lapollacolombiana.com/team-crests/abc-96.webp",
  ])("lets static media bypass auth for %s", (url) => {
    expect(matches(url)).toBe(false);
  });

  it.each([
    "https://lapollacolombiana.com/",
    "https://lapollacolombiana.com/casa",
    "https://lapollacolombiana.com/api/app-version",
  ])("keeps dynamic requests inside the proxy for %s", (url) => {
    expect(matches(url)).toBe(true);
  });
});
