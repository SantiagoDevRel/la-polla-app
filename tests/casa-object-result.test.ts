import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), user: vi.fn(), admin: vi.fn(), rpc: vi.fn(), polla: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.session }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/casa/queries", () => ({ getPollaBySlug: mocks.polla }));
import { GET } from "@/app/api/casa/pollas/[slug]/object-result/route";
const request = () => GET(new Request("http://localhost/api/casa/pollas/prueba/object-result"), { params: Promise.resolve({ slug: "prueba" }) });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ auth: { getUser: mocks.user } });
  mocks.user.mockResolvedValue({ data: { user: { id: "viewer" } }, error: null });
  mocks.admin.mockReturnValue({ rpc: mocks.rpc });
  mocks.polla.mockResolvedValue({ id: "polla", prize_kind: "objeto", kind: "partidos", status: "cerrada" });
  mocks.rpc.mockResolvedValue({ data: { state: "waiting" }, error: null });
});

describe("resultado de objeto privado sin adjudicar", () => {
  it.each([
    { data: { user: null }, error: null },
    { data: { user: { id: "viewer" } }, error: new Error("expired") },
  ])("valida sesión antes de tocar datos", async (auth) => {
    mocks.user.mockResolvedValue(auth);
    const result = await request();
    expect(result.status).toBe(401);
    expect(mocks.polla).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(result.headers.get("Cache-Control")).toContain("no-store");
  });
  it.each([null, { status: "borrador" }, { status: "anulada" }, { prize_kind: "pozo" }, { kind: "rifa" }])("no expone destinos fuera de alcance %j", async (change) => {
    mocks.polla.mockResolvedValue(change === null ? null : { id: "polla", prize_kind: "objeto", kind: "partidos", status: "cerrada", ...change });
    expect((await request()).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("devuelve el ganador decidido por SQL sin adjudicar ni leer contactos", async () => {
    const result = { state: "ready", tied: true, winner: { user_id: "oldest", points: 6 } };
    mocks.rpc.mockResolvedValue({ data: result, error: null });
    const response = await request();
    expect(await response.json()).toEqual({ result });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("casa_object_result_v1", { p_polla_id: "polla" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("si la lectura falla no inventa un ganador ni expone errores internos", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "private SQL" } });
    const response = await request();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "No se pudo actualizar el resultado." });
  });
});
