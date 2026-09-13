import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  getPollaBySlug: vi.fn(),
  getLeaderboard: vi.fn(),
  getMyEntry: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/casa/queries", () => ({
  getPollaBySlug: mocks.getPollaBySlug,
  getLeaderboard: mocks.getLeaderboard,
  getMyEntry: mocks.getMyEntry,
}));

import { GET } from "@/app/api/casa/pollas/[slug]/leaderboard/route";

const userId = "00000000-0000-4000-8000-000000000001";
const pollaId = "00000000-0000-4000-8000-000000000002";

function request() {
  return GET(new NextRequest("http://localhost/api/casa/pollas/prueba/leaderboard"), {
    params: Promise.resolve({ slug: "prueba" }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createClient.mockResolvedValue({ auth: { getUser: mocks.getUser } });
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  mocks.getPollaBySlug.mockResolvedValue({ id: pollaId, status: "abierta" });
  mocks.getLeaderboard.mockResolvedValue([]);
  mocks.getMyEntry.mockResolvedValue(null);
});

describe("GET casa leaderboard", () => {
  it.each([
    { data: { user: null }, error: null },
    { data: { user: { id: userId } }, error: { message: "Expired token" } },
  ])("requires a valid session before any polla or participant read", async (auth) => {
    mocks.getUser.mockResolvedValue(auth);
    const result = await request();
    expect(result.status).toBe(401);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.getPollaBySlug).not.toHaveBeenCalled();
    expect(mocks.getLeaderboard).not.toHaveBeenCalled();
    expect(mocks.getMyEntry).not.toHaveBeenCalled();
  });

  it.each([null, { id: pollaId, status: "borrador" }, { id: pollaId, status: "anulada" }])(
    "does not expose nonexistent, archived, draft or cancelled pollas: %j", async (polla) => {
      // Archived pollas are returned as null by getPollaBySlug.
      mocks.getPollaBySlug.mockResolvedValue(polla);
      const result = await request();
      expect(result.status).toBe(404);
      expect(result.headers.get("Cache-Control")).toBe("private, no-store");
      expect(mocks.getLeaderboard).not.toHaveBeenCalled();
      expect(mocks.getMyEntry).not.toHaveBeenCalled();
    },
  );

  it("returns RPC ranks unchanged and scopes the entry status to the session user", async () => {
    const rows = [{ entry_id: "entry", user_id: userId, display_name: "Persona", points: 9, aciertos: 3, puesto: 1 }];
    mocks.getLeaderboard.mockResolvedValue(rows);
    mocks.getMyEntry.mockResolvedValue({ status: "pagada", proof_path: "private/receipt", amount_cop: 10000 });
    const result = await request();
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await result.json()).toEqual({ rows, entryStatus: "pagada", pollaStatus: "abierta", drawPending: false });
    expect(mocks.getPollaBySlug).toHaveBeenCalledWith("prueba");
    expect(mocks.getLeaderboard).toHaveBeenCalledWith(pollaId);
    expect(mocks.getMyEntry).toHaveBeenCalledWith(pollaId, userId);
  });

  it.each(["abierta", "cerrada", "resuelta"])("allows signed-in visitors without an entry for a published %s polla", async (status) => {
    mocks.getPollaBySlug.mockResolvedValue({ id: pollaId, status });
    const result = await request();
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ rows: [], entryStatus: null, pollaStatus: status, drawPending: false });
  });

  it.each(["getUser", "getPollaBySlug", "getLeaderboard", "getMyEntry"] as const)("returns a private generic error if %s fails", async (method) => {
    mocks[method].mockRejectedValue(new Error("private database diagnostic"));
    const result = await request();
    expect(result.status).toBe(500);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await result.json()).toEqual({ error: "No se pudo cargar la tabla de posiciones." });
  });
});
