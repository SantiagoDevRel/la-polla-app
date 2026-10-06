import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getUser: mocks.getUser } }) }));
import { updateSession } from "@/lib/supabase/middleware";
beforeEach(() => mocks.getUser.mockResolvedValue({ data: { user: null } }));
it.each(["/api/users/me", "/api/feedback", "/api/casa/pollas/gift/unirme"])("lets %s reach its authenticated JSON handler", async (path) => {
  const response = await updateSession(new NextRequest(`http://localhost${path}`));
  expect(response.headers.get("location")).toBeNull(); expect(response.status).toBe(200);
});
it.each(["/api/users/me-other", "/api/feedback-other", "/api/casa/pollas/gift/unirme/extra", "/perfil"])("does not broaden the exemption to %s", async (path) => {
  expect((await updateSession(new NextRequest(`http://localhost${path}`))).status).toBe(307);
});
