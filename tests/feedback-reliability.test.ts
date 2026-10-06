import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ user: vi.fn(), from: vi.fn(), notify: vi.fn(), after: vi.fn(), rows: [] as Record<string, unknown>[], queued: [] as (() => Promise<unknown>)[] }));
vi.mock("next/server", async () => ({ ...await vi.importActual<typeof import("next/server")>("next/server"), after: mocks.after }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.user }, from: mocks.from }) }));
vi.mock("@/lib/feedback/notify", () => ({ notifyFeedback: mocks.notify }));
import { GET, POST } from "@/app/api/feedback/route";
import { submitFeedback } from "@/lib/feedback/submit";
const requestId = "00000000-0000-4000-8000-000000000123";
const body = { message: "The save button is unavailable", pageUrl: "/polla/gift", requestId, ownerId: "session-user" };
const request = (input: unknown = body, owner = "session-user") => new NextRequest("http://localhost/api/feedback", { method: "POST", body: JSON.stringify(input), headers: { "Content-Type": "application/json", "X-Feedback-Owner": owner } });
beforeEach(() => {
  vi.clearAllMocks(); mocks.rows = []; mocks.queued = [];
  mocks.user.mockResolvedValue({ data: { user: { id: "session-user" } } });
  mocks.after.mockImplementation((work) => mocks.queued.push(work)); mocks.notify.mockResolvedValue(undefined);
  mocks.from.mockImplementation(() => {
    let insert: Record<string, unknown> | undefined;
    const filters: Record<string, unknown> = {};
    const chain = {
      insert: (value: Record<string, unknown>) => { insert = value; return chain; },
      select: () => chain,
      eq: (key: string, value: unknown) => { filters[key] = value; return chain; },
      maybeSingle: async () => ({ data: mocks.rows.find((row) => Object.entries(filters).every(([key, value]) => row[key] === value)) ?? null, error: null }),
      single: async () => {
        if (insert?.request_id && mocks.rows.some((row) => row.user_id === insert?.user_id && row.request_id === insert?.request_id)) return { data: null, error: { code: "23505" } };
        const row = { ...insert, id: `report-${mocks.rows.length + 1}` }; mocks.rows.push(row);
        return { data: row, error: null };
      },
    };
    return chain;
  });
});
afterEach(() => vi.unstubAllGlobals());
it("requires auth before validation, reads or writes for both methods", async () => {
  mocks.user.mockResolvedValue({ data: { user: null } });
  expect((await POST(request())).status).toBe(401);
  expect((await GET(new NextRequest(`http://localhost/api/feedback?requestId=${requestId}`))).status).toBe(401);
  expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.after).not.toHaveBeenCalled();
});
it("confirms the inserted report before notifications and keeps responses private", async () => {
  const response = await POST(request());
  expect(await response.json()).toEqual({ ok: true, owner_id: "session-user", id: "report-1", request_id: requestId });
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(mocks.notify).not.toHaveBeenCalled();
  expect(mocks.queued).toHaveLength(1); await mocks.queued[0]();
  expect(mocks.notify).toHaveBeenCalledTimes(1);
});
it("a committed response lost then a retry creates only one report and one notice", async () => {
  let drop = true;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    if (init.method === "POST") {
      const response = await POST(request(JSON.parse(init.body as string)));
      if (drop) { drop = false; throw new Error("response lost after commit"); }
      return response;
    }
    return GET(new NextRequest(`http://localhost${url}`));
  }));
  expect(await submitFeedback(body)).toMatchObject({ ok: true, data: { id: "report-1" } });
  expect(await submitFeedback(body)).toMatchObject({ ok: true, data: { id: "report-1" } });
  expect(mocks.rows).toHaveLength(1); expect(mocks.queued).toHaveLength(1);
  await mocks.queued[0](); expect(mocks.notify).toHaveBeenCalledTimes(1);
});
it("does not update or duplicate a report when the same identity has other content", async () => {
  await POST(request()); const original = { ...mocks.rows[0] };
  expect((await POST(request({ ...body, message: "different" }))).status).toBe(409);
  expect(mocks.rows).toEqual([original]); expect(mocks.queued).toHaveLength(1);
});
it("scopes reconciliation to its authenticated author", async () => {
  await POST(request()); mocks.user.mockResolvedValue({ data: { user: { id: "other-user" } } });
  const response = await GET(new NextRequest(`http://localhost/api/feedback?requestId=${requestId}`));
  expect(await response.json()).toEqual({ ok: true, owner_id: "other-user", request_id: requestId, report: null });
  expect(mocks.rows).toHaveLength(1); expect(mocks.queued).toHaveLength(1);
});
it("keeps valid legacy clients supported with nullable identity", async () => {
  const response = await POST(request({ message: body.message, pageUrl: body.pageUrl }));
  expect(await response.json()).toEqual({ ok: true, owner_id: "session-user", id: "report-1", request_id: null });
});
it.each([new Response("<html>login</html>"), new Response(JSON.stringify({ ok: true })), new Response(JSON.stringify({ ok: true, id: "wrong", request_id: "other" }))])("never confirms malformed ACK or HTML", async (response) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response).mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, owner_id: "session-user", request_id: requestId, report: null }))));
  expect(await submitFeedback(body)).toMatchObject({ ok: false, kind: "uncertain" });
});
it("never clears an expired-session submission", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 401 })); vi.stubGlobal("fetch", fetch);
  expect(await submitFeedback(body)).toMatchObject({ ok: false, kind: "auth" }); expect(fetch).toHaveBeenCalledTimes(1);
});
it("rejects a report from the original account when recovery logs into somebody else", async () => {
  mocks.user.mockResolvedValue({ data: { user: { id: "other-user" } } });
  expect((await POST(request())).status).toBe(412); expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.queued).toHaveLength(0);
});
it("does not confirm another account's same report text or identity", async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error("lost")).mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, owner_id: "other-user", request_id: requestId,
    report: { id: "other-report", request_id: requestId, message: body.message, page_url: body.pageUrl } })));
  vi.stubGlobal("fetch", fetch);
  expect(await submitFeedback(body)).toMatchObject({ ok: false, kind: "account", error: expect.stringContaining("Tu cuenta cambió") });
});
it("returns account identity without touching report data", async () => {
  const response = await GET(new NextRequest("http://localhost/api/feedback"));
  expect(await response.json()).toEqual({ ok: true, owner_id: "session-user" });
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(mocks.from).not.toHaveBeenCalled();
});
it("classifies HTTP 412 by its precondition status without relying on the error text", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "ACCOUNT_CHANGED", error: "different wording" }), { status: 412 })); vi.stubGlobal("fetch", fetch);
  expect(await submitFeedback(body)).toMatchObject({ ok: false, kind: "account", error: "different wording" });
  expect(fetch).toHaveBeenCalledTimes(1);
});
