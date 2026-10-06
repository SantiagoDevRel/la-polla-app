import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => createClient("http://127.0.0.1:59999", "synthetic-only", {
  auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: mocks.fetch },
}) }));
import { GET } from "@/app/api/pollas/preview/route";
const pool = { id: "pool", slug: "test", created_by: "organizer", name: "Test", join_code: "FIXTURE", admin_payment_instructions: "Synthetic instructions" };
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  mocks.fetch.mockReset();
  mocks.fetch.mockImplementation(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/pollas")) {
      const token = url.searchParams.get("invite_token");
      return response(token && token !== "eq.valid" ? null : pool);
    }
    if (init?.method === "HEAD") return new Response(null, { headers: { "Content-Range": "0-0/1" } });
    return response({ display_name: "Organizer", avatar_url: "millos" });
  });
});
const call = (query: string) => GET(new NextRequest(`http://localhost/api/pollas/preview?${query}`));
describe("invitation preview boundary", () => {
  it.each(["slug=test&token=invalid", "slug=test&token=other-pool", "token=invalid"])("rejects an invalid or unrelated token: %s", async query => {
    const res = await call(query);
    expect(res.status).toBe(404);
    expect(await res.json()).not.toHaveProperty("polla");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const url = new URL(String(mocks.fetch.mock.calls[0][0]));
    expect(url.searchParams.has("invite_token")).toBe(true);
    if (query.includes("slug=")) expect(url.searchParams.get("slug")).toBe("eq.test");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it.each(["slug=test", "slug=test&token="])("only exposes public fields without a token: %s", async query => {
    const res = await call(query);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.polla).not.toHaveProperty("join_code");
    expect(data.polla).not.toHaveProperty("admin_payment_instructions");
    expect(data.polla).not.toHaveProperty("created_by");
  });
  it.each(["token=valid", "slug=test&token=valid"])("returns reserved fields only after token validation: %s", async query => {
    const res = await call(query);
    expect(res.status).toBe(200);
    expect((await res.json()).polla.join_code).toBe("FIXTURE");
    expect(new URL(String(mocks.fetch.mock.calls[0][0])).searchParams.get("invite_token")).toBe("eq.valid");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("requires at least one identifier", async () => {
    expect((await call("")).status).toBe(400);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
