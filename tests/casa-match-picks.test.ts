import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), server: vi.fn(), db: vi.fn(), polla: vi.fn(), entry: vi.fn(), matches: vi.fn(), admin: vi.fn(), leaderboard: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.server }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.db }));
vi.mock("@/lib/auth/admin", () => ({ isCurrentUserAdmin: mocks.admin }));
vi.mock("@/lib/casa/queries", () => ({ getPollaBySlug: mocks.polla, getMyEntry: mocks.entry, getMyEntries: async () => [], getMyEntryByNumber: mocks.entry, getPollaMatches: mocks.matches, getLeaderboard: mocks.leaderboard }));
import { GET } from "@/app/api/casa/pollas/[slug]/match-picks/route";
import { PUT } from "@/app/api/casa/pollas/[slug]/picks/route";

const pollaId = "00000000-0000-4000-8000-000000000001";
const matchId = "00000000-0000-4000-8000-000000000002";
const userId = "00000000-0000-4000-8000-000000000003";
const fetchDb = vi.fn<typeof fetch>();
const call = (search = `match=${matchId}`) => GET(new NextRequest(`http://localhost/api/casa/pollas/test/match-picks?${search}`), { params: Promise.resolve({ slug: "test" }) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.server.mockResolvedValue({ auth: { getUser: mocks.auth } });
  mocks.auth.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  mocks.polla.mockResolvedValue({ id: pollaId, status: "abierta", kind: "partidos", scoring_mode: "marcador" });
  mocks.entry.mockResolvedValue({ status: "pagada" });
  mocks.matches.mockResolvedValue([{ id: matchId, scheduled_at: "2020-01-01T00:00:00Z", status: "live" }]);
  mocks.admin.mockResolvedValue(false);
  mocks.leaderboard.mockResolvedValue([]);
  mocks.db.mockImplementation(() => createClient("http://localhost:54321", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchDb },
  }));
  fetchDb.mockResolvedValue(new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json" } }));
});

describe("Casa match save after inscription closure", () => {
  const save = () => PUT(new NextRequest("http://localhost/api/casa/pollas/test/picks", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ picks: [{ matchId, homeScore: 2, awayScore: 1 }] }),
  }), { params: Promise.resolve({ slug: "test" }) });
  it("saves a future match while the parent is closed to new entries", async () => {
    mocks.polla.mockResolvedValue({ id: pollaId, status: "cerrada", kind: "partidos", scoring_mode: "marcador", closes_at: "2020-01-01T00:00:00Z" });
    mocks.entry.mockResolvedValue({ id: "entry", status: "pagada" });
    mocks.matches.mockResolvedValue([{ id: matchId, scheduled_at: new Date(Date.now() + 3_600_000).toISOString(), status: "scheduled" }]);
    fetchDb.mockImplementation(async () => new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json" } }));
    const response = await save();
    expect(response.status).toBe(200);
    const writes = fetchDb.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(writes).toHaveLength(1);
    expect(new URL(String(writes[0][0])).pathname).toBe("/rest/v1/casa_picks");
    expect(JSON.parse(String(writes[0][1]?.body))[0]).toMatchObject({ entry_id: "entry", user_id: userId, polla_id: pollaId, match_id: matchId });
  });
  it.each(["resuelta", "anulada", "borrador"])("does not write to a %s polla", async status => {
    mocks.polla.mockResolvedValue({ id: pollaId, kind: "partidos", status });
    expect((await save()).status).toBe(status === "borrador" ? 404 : 409);
    expect(mocks.db).not.toHaveBeenCalled();
  });
});

describe("Casa participant predictions privacy", () => {
  it.each([
    { data: { user: null }, error: null },
    { data: { user: { id: userId } }, error: { message: "expired" } },
  ])("validates the session before any data read", async auth => {
    mocks.auth.mockResolvedValue(auth);
    const response = await call();
    expect(response.status).toBe(401); expect(mocks.polla).not.toHaveBeenCalled(); expect(mocks.db).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it.each([null, { status: "rechazada" }, { status: "anulada" }, { status: "pendiente", proof_path: null }])("requires an active inscription or admin: %j", async entry => {
    mocks.entry.mockResolvedValue(entry);
    expect((await call()).status).toBe(403); expect(mocks.matches).not.toHaveBeenCalled(); expect(mocks.db).not.toHaveBeenCalled();
    expect(mocks.entry).toHaveBeenCalledWith(pollaId, userId);
  });
  it.each([null, { id: pollaId, kind: "partidos", status: "borrador" }, { id: pollaId, kind: "partidos", status: "anulada" }])("does not expose hidden pollas", async polla => {
    mocks.polla.mockResolvedValue(polla);
    expect((await call()).status).toBe(404); expect(mocks.db).not.toHaveBeenCalled();
  });
  it.each([
    { status: "resuelta", closes_at: "2026-09-16T16:55:00Z" },
    { status: "cerrada", closes_at: "2026-09-16T05:00:00Z" },
    { status: "abierta", closes_at: "2026-09-17T12:00:00Z" },
  ])("opens a public closed polla (since 2026-09-16) to non-participants: %j", async closed => {
    mocks.polla.mockResolvedValue({ id: pollaId, kind: "partidos", scoring_mode: "marcador", publication_mode: "ahora", opens_at: "2026-09-13T00:00:00Z", ...closed });
    mocks.entry.mockResolvedValue(null);
    expect((await call()).status).toBe(200);
    expect(mocks.db).toHaveBeenCalled();
  });
  it.each([
    { status: "resuelta", closes_at: "2026-09-16T04:59:00Z" },
    { status: "resuelta", closes_at: "2026-09-10T18:00:00Z" },
    { status: "abierta", closes_at: "2099-01-01T00:00:00Z" },
    { status: "resuelta", closes_at: "2026-09-16T16:55:00Z", publication_mode: "oculta" },
  ])("keeps other pollas private to non-participants: %j", async polla => {
    mocks.polla.mockResolvedValue({ id: pollaId, kind: "partidos", scoring_mode: "marcador", ...polla });
    mocks.entry.mockResolvedValue(null);
    expect((await call()).status).toBe(403); expect(mocks.db).not.toHaveBeenCalled();
  });
  it("does not expose another polla's match", async () => {
    mocks.matches.mockResolvedValue([]);
    expect((await call()).status).toBe(404); expect(mocks.db).not.toHaveBeenCalled();
  });
  it.each(["scheduled", "cancelled"])("does not query anyone's picks from a %s match after its scheduled hour", async status => {
    mocks.matches.mockResolvedValue([{ id: matchId, scheduled_at: "2020-01-01T00:00:00Z", status }]);
    expect((await call()).status).toBe(409); expect(mocks.db).not.toHaveBeenCalled();
  });
  it("scopes group reads to this match and paid entries, paginates, and projects no payment data", async () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({ id: String(index), home_score: 2, away_score: 1, pick_1x2: "L", users: { display_name: "Jugador", avatar_url: "millos" }, casa_entries: { status: "pagada" } }));
    fetchDb.mockResolvedValueOnce(new Response(JSON.stringify(rows), { headers: { "Content-Type": "application/json" } }));
    const response = await call(`match=${matchId}&page=1`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rows).toHaveLength(20); expect(body.hasMore).toBe(true);
    // `mine` comes from the caller's own entry ids; `pointsEarned` only once the match is verified.
    expect(body.rows[0]).toEqual({ id: "0", displayName: "Jugador", avatarUrl: "millos", homeScore: 2, awayScore: 1, pick1x2: null, entryNumber: null, mine: false, pointsEarned: null });
    const url = new URL(String(fetchDb.mock.calls[0][0]));
    expect(url.searchParams.get("polla_id")).toBe(`eq.${pollaId}`);
    expect(url.searchParams.get("match_id")).toBe(`eq.${matchId}`);
    expect(url.searchParams.get("casa_entries.status")).toBe("eq.pagada");
    expect(url.searchParams.get("offset")).toBe("20"); expect(url.searchParams.get("limit")).toBe("21");
    expect(url.searchParams.get("select")).not.toMatch(/phone|account|proof|user_id|\*/);
  });
  it("numbers only the participations of people with several approved entries (migration 131)", async () => {
    const rows = [
      { id: "a", entry_id: "e-ana-1", home_score: 1, away_score: 0, users: { display_name: "Ana", avatar_url: null }, casa_entries: { status: "pagada" } },
      { id: "b", entry_id: "e-ana-2", home_score: 2, away_score: 2, users: { display_name: "Ana", avatar_url: null }, casa_entries: { status: "pagada" } },
      { id: "c", entry_id: "e-beto-1", home_score: 0, away_score: 0, users: { display_name: "Beto", avatar_url: null }, casa_entries: { status: "pagada" } },
    ];
    fetchDb.mockResolvedValueOnce(new Response(JSON.stringify(rows), { headers: { "Content-Type": "application/json" } }));
    mocks.leaderboard.mockResolvedValue([
      { entry_id: "e-ana-1", entry_number: 1, user_entries: 2 },
      { entry_id: "e-ana-2", entry_number: 2, user_entries: 2 },
      { entry_id: "e-beto-1", entry_number: 1, user_entries: 1 },
    ]);
    const body = await (await call()).json();
    expect(body.rows.map((row: { entryNumber: number | null }) => row.entryNumber)).toEqual([1, 2, null]);
    expect(JSON.stringify(body)).not.toMatch(/entry_id|user_id|e-ana/);
  });
  it("asks the database for scoring picks first across pages only after verification", async () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({
      id: `pick-${index}`, entry_id: `entry-${index}`, home_score: 2, away_score: index < 3 ? 1 : 0,
      points_earned: index < 3 ? 3 : 0, users: { display_name: `Jugador ${index}`, avatar_url: null },
    }));
    fetchDb.mockImplementation(async () => new Response(JSON.stringify(rows), { headers: { "Content-Type": "application/json" } }));
    const before = await (await call(`match=${matchId}&page=1`)).json();
    const liveUrl = new URL(String(fetchDb.mock.calls[0][0]));
    expect(liveUrl.searchParams.get("order")).toBe("id.asc");
    expect(before.rows.every((row: { pointsEarned: number | null }) => row.pointsEarned === null)).toBe(true);

    mocks.matches.mockResolvedValue([{ id: matchId, scheduled_at: "2020-01-01T00:00:00Z", status: "finished", final_verified_at: "2026-09-24T20:00:00Z" }]);
    const after = await (await call(`match=${matchId}&page=1`)).json();
    const finalUrl = new URL(String(fetchDb.mock.calls[1][0]));
    expect(finalUrl.searchParams.get("order")).toBe("points_earned.desc.nullslast,id.asc");
    expect(finalUrl.searchParams.get("offset")).toBe("20");
    expect(finalUrl.searchParams.get("limit")).toBe("21");
    expect(after.rows.map((row: { pointsEarned: number }) => row.pointsEarned)).toEqual([3, 3, 3, ...Array(17).fill(0)]);
    expect(after.hasMore).toBe(true);
    expect(after.rows.some((row: { id: string }) => row.id === "pick-20")).toBe(false);
  });
  it("shows zero for a voided match and orders its scored rows before pagination", async () => {
    mocks.matches.mockResolvedValue([{ id: matchId, scheduled_at: "2020-01-01T00:00:00Z", status: "cancelled", voided_at: "2026-09-24T20:00:00Z" }]);
    fetchDb.mockResolvedValueOnce(new Response(JSON.stringify([
      { id: "pick", entry_id: "entry", home_score: 2, away_score: 1, points_earned: 3, users: { display_name: "Jugador", avatar_url: null } },
    ]), { headers: { "Content-Type": "application/json" } }));
    const body = await (await call()).json();
    expect(body.rows[0].pointsEarned).toBe(0);
    expect(new URL(String(fetchDb.mock.calls[0][0])).searchParams.get("order")).toBe("points_earned.desc.nullslast,id.asc");
  });
  it("allows an administrator to inspect started matches without an inscription", async () => {
    mocks.entry.mockResolvedValue(null); mocks.admin.mockResolvedValue(true);
    expect((await call()).status).toBe(200);
  });
});
