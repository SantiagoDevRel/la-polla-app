import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.auth } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
import { POST } from "@/app/api/users/me/delete/route";
const owner = "00000000-0000-4000-8000-000000000001";
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ data: { user: { id: owner } }, error: null }); });
it.each([undefined, {}, { expected_user_id: 1 }])("rejects a deletion without the confirmed account before database access: %j", async body => {
  const response = await POST(new Request("http://localhost/api/users/me/delete", { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  expect(response.status).toBe(428); expect(mocks.admin).not.toHaveBeenCalled();
});
it("rejects an account switch before any cleanup or mutation", async () => {
  const response = await POST(new Request("http://localhost/api/users/me/delete", { method: "POST", body: JSON.stringify({ expected_user_id: "00000000-0000-4000-8000-000000000002" }) }));
  expect(response.status).toBe(412); expect(await response.json()).toMatchObject({ code: "SESSION_CHANGED" });
  expect(response.headers.get("Cache-Control")).toBe("private, no-store"); expect(mocks.admin).not.toHaveBeenCalled();
});
it("checks authentication before the deletion precondition or database", async () => {
  mocks.auth.mockResolvedValue({ data: { user: null }, error: null });
  expect((await POST(new Request("http://localhost/api/users/me/delete", { method: "POST" }))).status).toBe(401);
  expect(mocks.admin).not.toHaveBeenCalled();
});
