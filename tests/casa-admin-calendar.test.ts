import { afterEach, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), auth: vi.fn(), refresh: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/admin", () => ({ isCurrentUserAdmin: mocks.auth }));
vi.mock("@/lib/matches/refresh-schedule", () => ({ refreshTournamentSchedule: mocks.refresh }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => createClient("http://localhost:59999", "fixture", {
  auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: mocks.fetch },
}) }));
import { GET } from "@/app/api/casa/admin/matches/route";
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });
it("keeps today's provisional dates after their placeholder midnight, using Colombia's day", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2030-09-16T03:00:00Z"));
  mocks.auth.mockResolvedValue(true); mocks.refresh.mockResolvedValue(true);
  mocks.fetch.mockResolvedValue(new Response("[]", { headers: { "Content-Type": "application/json" } }));
  const res = await GET(new NextRequest("http://localhost/api/casa/admin/matches?tournament=premier_2025"));
  expect(res.status).toBe(200);
  const query = new URL(String(mocks.fetch.mock.calls[0][0])).searchParams;
  expect(query.get("or")).toBe("(scheduled_at.gt.2030-09-16T03:00:00.000Z,and(scheduled_at_confirmed.eq.false,scheduled_at.gte.2030-09-15T00:00:00Z))");
  expect(query.getAll("scheduled_at")).toHaveLength(1);
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
});
