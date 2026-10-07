import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), auth: vi.fn(), verify: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/supabase/auth-ip", () => ({ createAuthRouteClient: mocks.auth }));
import { startSessionForVerifiedPhone } from "@/lib/auth/phone-session";

beforeEach(() => {
  vi.clearAllMocks();
  const query = { update: vi.fn(), eq: vi.fn(), select: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: { display_name: "Ana", avatar_url: "millos" }, error: null }) };
  query.update.mockReturnValue(query); query.eq.mockReturnValue(query); query.select.mockReturnValue(query);
  mocks.admin.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ data: "owner", error: null }), from: () => query,
    auth: { admin: {
      getUserById: vi.fn().mockResolvedValue({ data: { user: { email: "573001234567@wa.lapolla.app" } } }),
      generateLink: vi.fn().mockResolvedValue({ data: { properties: { email_otp: "123456" } }, error: null }),
    } },
  });
  mocks.auth.mockResolvedValue({ verifyOtp: mocks.verify, signOut: mocks.signOut });
});

describe("verified-phone session minting", () => {
  it("does not revoke a previous session when the generated link cannot be verified", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.verify.mockResolvedValue({ error: { message: "Provider unavailable" } });
    expect(await startSessionForVerifiedPhone("+573001234567", "local-test")).toEqual({ ok: false, stage: "verify" });
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it("lets successful OTP verification replace cookies without revoking the previous session", async () => {
    mocks.verify.mockResolvedValue({ error: null });
    expect(await startSessionForVerifiedPhone("+573001234567", "local-test")).toEqual({ ok: true, userId: "owner", needsOnboarding: false });
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.verify).toHaveBeenCalledWith({ email: "573001234567@wa.lapolla.app", token: "123456", type: "email" });
  });
});
