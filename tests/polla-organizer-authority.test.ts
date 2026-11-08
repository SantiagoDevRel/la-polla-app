// P2P polla authority comes from pollas.created_by, never from the
// polla_participants.role column (security audit 2026-11-07, S1: a signed-in
// user could self-insert role='admin'). Every participant row served below
// claims role='admin', so only the creator check can let a request through.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), userId: "organizer", rotate: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    createClient("http://127.0.0.1:59999", "synthetic-only", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: mocks.fetch },
    }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: mocks.userId } }, error: null }) },
  }),
}));
vi.mock("@/lib/pollas/rotate-code", () => ({ rotateJoinCode: mocks.rotate }));
vi.mock("@/lib/notifications", () => ({
  notifyAdminPaymentSubmitted: vi.fn(),
  notifyParticipantPaymentApproved: vi.fn(),
}));
vi.mock("@/lib/scoring", () => ({ recomputePollaStandings: vi.fn() }));
vi.mock("@/lib/auth/admin", () => ({ isCurrentUserAdmin: async () => false }));

import { isPollaOrganizer } from "@/lib/pollas/organizer";
import { POST as rotateCode } from "@/app/api/pollas/[slug]/rotate-code/route";
import { PATCH as reviewPayment } from "@/app/api/pollas/[slug]/payments/route";
import { PATCH as updateParticipant } from "@/app/api/pollas/[slug]/participants/[id]/route";

const POLLA_ID = "00000000-0000-4000-8000-000000000001";
const PARTICIPANT_ID = "00000000-0000-4000-8000-000000000002";
const pool = { id: POLLA_ID, slug: "test", created_by: "organizer", payment_mode: "admin_collects" };
let targetUserId = "planted";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  mocks.userId = "organizer";
  targetUserId = "planted";
  mocks.rotate.mockReset();
  mocks.rotate.mockResolvedValue({ ok: true, code: "NEWCODE" });
  mocks.fetch.mockReset();
  mocks.fetch.mockImplementation(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (method !== "GET") return new Response(null, { status: 204 });
    const headers = new Headers(init?.headers);
    const single = (headers.get("Accept") ?? "").includes("vnd.pgrst.object");
    const row = url.pathname.endsWith("/pollas")
      ? pool
      : { id: PARTICIPANT_ID, role: "admin", status: "approved", polla_id: POLLA_ID, user_id: targetUserId };
    return json(single ? row : [row]);
  });
});

const writes = () =>
  mocks.fetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method && (init as RequestInit).method !== "GET");

const slugParams = { params: Promise.resolve({ slug: "test" }) };
const jsonRequest = (path: string, method: string, body: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

describe("isPollaOrganizer", () => {
  it("accepts only the polla creator", () => {
    expect(isPollaOrganizer({ created_by: "organizer" }, "organizer")).toBe(true);
    expect(isPollaOrganizer({ created_by: "organizer" }, "planted")).toBe(false);
    expect(isPollaOrganizer({ created_by: null }, "organizer")).toBe(false);
    expect(isPollaOrganizer({ created_by: "organizer" }, "")).toBe(false);
    expect(isPollaOrganizer(null, "organizer")).toBe(false);
  });
});

describe("rotate-code authority", () => {
  it("refuses a participant whose row says role=admin but did not create the polla", async () => {
    mocks.userId = "planted";
    const res = await rotateCode(new NextRequest("http://localhost/api/pollas/test/rotate-code", { method: "POST" }), slugParams);
    expect(res.status).toBe(403);
    expect(mocks.rotate).not.toHaveBeenCalled();
  });

  it("lets the creator rotate the code", async () => {
    const res = await rotateCode(new NextRequest("http://localhost/api/pollas/test/rotate-code", { method: "POST" }), slugParams);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ code: "NEWCODE" });
    expect(mocks.rotate).toHaveBeenCalledWith(expect.anything(), POLLA_ID);
  });
});

describe("payment review authority", () => {
  const body = { participantId: PARTICIPANT_ID, action: "approve" };

  it("refuses a planted role=admin participant and writes nothing", async () => {
    mocks.userId = "planted";
    const res = await reviewPayment(jsonRequest("/api/pollas/test/payments", "PATCH", body), slugParams);
    expect(res.status).toBe(403);
    expect(writes()).toHaveLength(0);
  });

  it("lets the creator approve a payment", async () => {
    const res = await reviewPayment(jsonRequest("/api/pollas/test/payments", "PATCH", body), slugParams);
    expect(res.status).toBe(200);
    const [url, init] = writes()[0];
    expect(new URL(String(url)).pathname).toMatch(/\/polla_participants$/);
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ paid: true });
  });
});

describe("participant management authority", () => {
  const params = { params: Promise.resolve({ slug: "test", id: PARTICIPANT_ID }) };

  it("refuses a planted role=admin participant", async () => {
    mocks.userId = "planted";
    const res = await updateParticipant(jsonRequest(`/api/pollas/test/participants/${PARTICIPANT_ID}`, "PATCH", { status: "rejected" }), params);
    expect(res.status).toBe(403);
    expect(writes()).toHaveLength(0);
  });

  it("lets the creator expel a participant even if its row claims role=admin", async () => {
    const res = await updateParticipant(jsonRequest(`/api/pollas/test/participants/${PARTICIPANT_ID}`, "PATCH", { status: "rejected" }), params);
    expect(res.status).toBe(200);
    expect(writes()).toHaveLength(1);
  });

  it("still protects the creator from being expelled", async () => {
    targetUserId = "organizer";
    const res = await updateParticipant(jsonRequest(`/api/pollas/test/participants/${PARTICIPANT_ID}`, "PATCH", { status: "rejected" }), params);
    expect(res.status).toBe(400);
    expect(writes()).toHaveLength(0);
  });
});
