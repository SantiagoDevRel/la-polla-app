// tests/casa-voided-hidden.test.ts — un partido anulado en una polla Casa no
// se muestra a los jugadores (regla del dueño, 2026-10-10): getPollaMatches lo
// excluye en la consulta, y el aviso de pronósticos pendientes de /inicio no lo
// cuenta como faltante ni cuenta un pronóstico viejo sobre él como hecho.
// PostgREST se simula con un fetch local que respeta los filtros relevantes.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.db }));
import { getPollaMatches, listPollasConPicksPendientes } from "@/lib/casa/queries";

const pool = "00000000-0000-4000-8000-000000000001";
const user = "00000000-0000-4000-8000-000000000002";
const fetchDb = vi.fn<typeof fetch>();
const links = [
  { match_id: "active-a", order_index: 0, voided_at: null },
  { match_id: "voided", order_index: 1, voided_at: "2026-10-10T16:44:05Z" },
  { match_id: "active-b", order_index: 2, voided_at: null },
];
// La entrada pronosticó active-a y el partido anulado; le falta active-b.
const picks = ["active-a", "voided"];
const response = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json", ...headers } });
const inList = (value: string | null) => value?.match(/^in\.\((.*)\)$/)?.[1].split(",") ?? null;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.db.mockImplementation(() => createClient("http://localhost:54321", "test-only-key", {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchDb },
  }));
  fetchDb.mockImplementation(async (input) => {
    const url = new URL(String(input));
    const params = url.searchParams;
    if (url.pathname.endsWith("/casa_polla_matches")) {
      return response(params.get("voided_at") === "is.null" ? links.filter((l) => !l.voided_at) : links);
    }
    if (url.pathname.endsWith("/matches")) {
      const ids = inList(params.get("id")) ?? [];
      return response(ids.map((id, i) => ({ id, scheduled_at: `2026-10-1${i + 1}T13:00:00Z`, status: "scheduled" })));
    }
    if (url.pathname.endsWith("/casa_entries")) return response([{ id: "entry-1", polla_id: pool, entry_number: 1 }]);
    if (url.pathname.endsWith("/casa_pollas")) return response([{ id: pool, name: "Polla" }]);
    if (url.pathname.endsWith("/casa_picks")) {
      const scope = inList(params.get("match_id"));
      const count = picks.filter((id) => !scope || scope.includes(id)).length;
      return response(null, { "Content-Range": `*/${count}` });
    }
    throw new Error(`Unexpected local test query: ${url.pathname}`);
  });
});

const calls = (table: string) =>
  fetchDb.mock.calls.map(([input]) => new URL(String(input))).filter((url) => url.pathname.endsWith(`/${table}`));

describe("partidos anulados en pollas Casa", () => {
  it("getPollaMatches no devuelve el partido anulado", async () => {
    const matches = await getPollaMatches(pool);
    expect(matches.map((m) => m.id)).toEqual(["active-a", "active-b"]);
    expect(calls("casa_polla_matches")[0].searchParams.get("voided_at")).toBe("is.null");
    expect(inList(calls("matches")[0].searchParams.get("id"))).not.toContain("voided");
  });

  it("el aviso de pendientes no cuenta el partido anulado ni su pronóstico", async () => {
    expect(await listPollasConPicksPendientes(user)).toEqual([
      { polla: { id: pool, name: "Polla" }, faltan: 1, total: 2, entryNumber: 1 },
    ]);
    expect(calls("casa_entries")[0].searchParams.get("user_id")).toBe(`eq.${user}`);
    expect(calls("casa_picks")[0].searchParams.get("entry_id")).toBe("eq.entry-1");
  });
});
