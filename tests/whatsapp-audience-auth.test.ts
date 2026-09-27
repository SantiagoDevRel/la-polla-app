import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ user: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/auth/admin", () => ({ getAuthenticatedUser: mocks.user }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.db }));
import { GET } from "@/app/api/admin/whatsapp-audience/route";
beforeEach(() => vi.clearAllMocks());
it.each([[null, 401], [{ is_admin: false }, 403]])("denies non-admin audiences %j", async (user, status) => {
  mocks.user.mockResolvedValue(user);
  expect((await GET(new NextRequest("https://example.test/api/admin/whatsapp-audience"))).status).toBe(status);
  expect(mocks.db).not.toHaveBeenCalled();
});
it("paginates explicit consent without caching personal data", async () => {
  mocks.user.mockResolvedValue({ is_admin: true });
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const key of ["select", "eq", "order"]) q[key] = vi.fn(() => q);
  q.range = vi.fn().mockResolvedValue({ data: [], count: 0, error: null });
  mocks.db.mockReturnValue({ from: vi.fn(() => q) });
  const response = await GET(new NextRequest("https://example.test/api/admin/whatsapp-audience?page=1"));
  expect(q.eq).toHaveBeenCalledWith("enabled", true); expect(q.range).toHaveBeenCalledWith(25, 49);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
