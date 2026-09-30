import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ user: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.user } }) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/components/auth/PasswordSetup", () => ({ default: () => null }));
import SetPasswordPage from "@/app/(auth)/set-password/page";

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("React", await import("react"));
  vi.stubEnv("PHONE_PASSWORD_ENABLED", "true");
  vi.stubEnv("AUTH_PIN_PEPPER", "test-private-pepper-at-least-32-characters");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("password management from profile", () => {
  it.each(["whatsapp", "sms", "password"])("allows a current %s session to manage the password and return to profile", async method => {
    mocks.user.mockResolvedValue({ data: { user: { id: "owner-id", app_metadata: { login_method: method } } } });
    const page = await SetPasswordPage({ searchParams: Promise.resolve({ returnTo: "/perfil" }) });
    expect(page.props).toEqual({ returnTo: "/perfil", manage: true });
  });
  it("keeps registration optional and sanitizes external destinations", async () => {
    mocks.user.mockResolvedValue({ data: { user: { id: "owner-id" } } });
    const page = await SetPasswordPage({ searchParams: Promise.resolve({ returnTo: "https://evil.test" }) });
    expect(page.props).toEqual({ returnTo: "/inicio", manage: false });
  });
  it("requires authentication for the profile password form", async () => {
    mocks.user.mockResolvedValue({ data: { user: null } });
    await expect(SetPasswordPage({ searchParams: Promise.resolve({ returnTo: "/perfil" }) })).rejects.toThrow("redirect:/login");
  });
  it("returns to profile when passwords are disabled", async () => {
    mocks.user.mockResolvedValue({ data: { user: { id: "owner-id" } } });
    vi.stubEnv("PHONE_PASSWORD_ENABLED", "false");
    await expect(SetPasswordPage({ searchParams: Promise.resolve({ returnTo: "/perfil" }) })).rejects.toThrow("redirect:/perfil");
  });
});
