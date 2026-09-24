import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.db }));
import { getDistribution } from "@/lib/casa/queries";

const now = new Date("2026-09-24T20:00:00Z");
const future = "2026-09-24T21:00:00Z";
const past = "2026-09-24T19:00:00Z";
const pool = "00000000-0000-4000-8000-000000000001";
const secret = "answer only another participant knows";
const fetchDb = vi.fn<typeof fetch>();
let questionRows: Array<{ id: string; resolved_at: string | null; casa_pollas: { status: string; closes_at: string } | null }>;
let failQuestions: boolean;
const raw = {
  resultado: { upcoming: { total: 14, conteo: { L: 14 } }, started: { total: 7, conteo: { E: 7 } } },
  marcador: { upcoming: { total: 78, conteo: { "3-0": 14 } }, delayed: { total: 1, conteo: { "9-7": 1 } }, started: { total: 7, conteo: { "1-1": 7 } } },
  preguntas: { editable: { total: 1, conteo: { [secret]: 1 } }, resolved: { total: 2, conteo: { revealed: 2 } }, foreign: { total: 1, conteo: { foreign: 1 } } },
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
  failQuestions = false;
  questionRows = [
    { id: "editable", resolved_at: null, casa_pollas: { status: "abierta", closes_at: future } },
    { id: "resolved", resolved_at: past, casa_pollas: { status: "abierta", closes_at: future } },
  ];
  mocks.db.mockImplementation(() => createClient("http://localhost:54321", "test-only-key", {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchDb },
  }));
  fetchDb.mockImplementation(async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/rpc/casa_pick_distribution")) return response(raw);
    if (url.pathname.endsWith("/casa_polla_matches")) return response([
      { match_id: "upcoming", order_index: 0 }, { match_id: "delayed", order_index: 1 }, { match_id: "started", order_index: 2 },
    ]);
    if (url.pathname.endsWith("/matches")) return response([
      { id: "upcoming", scheduled_at: future, status: "scheduled" },
      { id: "delayed", scheduled_at: past, status: "scheduled" },
      { id: "started", scheduled_at: past, status: "live" },
    ]);
    if (url.pathname.endsWith("/casa_questions")) return failQuestions ? response({ message: "lookup failed" }, 403) : response(questionRows);
    throw new Error(`Unexpected local test query: ${url.pathname}`);
  });
});
afterEach(() => vi.useRealTimers());

describe("distribution sent as client/RSC props", () => {
  it("filters legacy RPC data before serialization: no upcoming scores or editable answers", async () => {
    const distribution = await getDistribution(pool);
    expect(distribution).toEqual({
      resultado: { started: raw.resultado.started }, marcador: { started: raw.marcador.started },
      preguntas: { resolved: raw.preguntas.resolved },
    });
    expect(JSON.stringify(distribution)).not.toMatch(/upcoming|delayed|3-0|9-7|answer only|foreign/);
    const questionQuery = fetchDb.mock.calls.map(([input]) => new URL(String(input))).find(url => url.pathname.endsWith("/casa_questions"))!;
    expect(questionQuery.searchParams.get("polla_id")).toBe(`eq.${pool}`);
    expect(questionQuery.searchParams.get("select")).toBe("id,resolved_at,casa_pollas!inner(status,closes_at)");
  });
  it.each([
    { status: "abierta", closes_at: now.toISOString() },
    { status: "abierta", closes_at: past },
    { status: "cerrada", closes_at: future },
    { status: "resuelta", closes_at: past },
  ])("reveals manual choices after their lock: %j", async locked => {
    questionRows[0].casa_pollas = locked;
    expect((await getDistribution(pool)).preguntas.editable).toEqual(raw.preguntas.editable);
  });
  it.each([
    null,
    { status: "borrador", closes_at: past },
    { status: "anulada", closes_at: past },
    { status: "abierta", closes_at: "invalid" },
  ])("fails closed for unavailable or invalid question scope: %j", async unavailable => {
    questionRows[0].casa_pollas = unavailable;
    expect((await getDistribution(pool)).preguntas).not.toHaveProperty("editable");
  });
  it("does not return unfiltered private data when lock validation fails", async () => {
    failQuestions = true;
    await expect(getDistribution(pool)).rejects.toMatchObject({ message: "lookup failed" });
  });
});
