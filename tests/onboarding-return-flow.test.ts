import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), profile: vi.fn() }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: { setAll: (cookies: unknown[]) => void } }) => ({
    auth: { getUser: async () => {
      options.cookies.setAll([{ name: "sb-local-auth-token", value: "refreshed", options: { path: "/" } }]);
      return mocks.getUser();
    } },
  }),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.profile }) }) }),
}) }));
import { updateSession } from "@/lib/supabase/middleware";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "new-player" } } });
  mocks.profile.mockResolvedValue({ data: { display_name: null, avatar_url: null }, error: null });
});

describe("registration retains the player's destination", () => {
  it.each(["/polla/weekend/pagar?entry=second", "/polla/weekend?ref=invitation", "/rifa/prize?numero=25"])(
    "returns a new player to %s after onboarding", async (destination) => {
      const response = await updateSession(new NextRequest(`http://localhost${destination}`));
      expect(response.status).toBe(307);
      const url = new URL(response.headers.get("location")!);
      expect(url.pathname).toBe("/onboarding");
      expect(url.searchParams.get("returnTo")).toBe(destination);
      expect(response.cookies.get("sb-local-auth-token")?.value).toBe("refreshed");
    },
  );
  it("does not redirect a completed profile", async () => {
    mocks.profile.mockResolvedValue({ data: { display_name: "Jugador", avatar_url: "millos" }, error: null });
    const response = await updateSession(new NextRequest("http://localhost/polla/weekend/pagar"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.cookies.get("lp_onb")?.value).toBe("1");
  });
  it("keeps JSON APIs outside the onboarding redirect", async () => {
    const response = await updateSession(new NextRequest("http://localhost/api/casa/pollas/weekend/join"));
    expect(response.headers.get("location")).toBeNull();
    expect(mocks.profile).not.toHaveBeenCalled();
  });
});
