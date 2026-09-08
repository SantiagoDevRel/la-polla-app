import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  createAdminClient: vi.fn(),
  signedProofUrl: vi.fn(),
}));

vi.mock("@/lib/auth/admin", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/telegram/notify", () => ({ signedProofUrl: mocks.signedProofUrl }));
vi.mock("@/lib/casa/queries", () => ({ getPot: vi.fn() }));

import { GET } from "@/app/api/casa/admin/entries/route";

const pollaId = "00000000-0000-4000-8000-000000000001";
const otraPolla = "00000000-0000-4000-8000-000000000002";
const userId = "00000000-0000-4000-8000-000000000003";
const dbFetch = vi.fn<typeof fetch>();

function request(params: Record<string, string>) {
  return new NextRequest(`http://localhost/api/casa/admin/entries?${new URLSearchParams(params)}`);
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function calledUrl(index = 0) {
  return new URL(String(dbFetch.mock.calls[index][0]));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getAuthenticatedUser.mockResolvedValue({ id: userId, is_admin: true });
  mocks.createAdminClient.mockImplementation(() => createClient("http://localhost:54321", "test-only-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: dbFetch },
  }));
  mocks.signedProofUrl.mockResolvedValue("https://example.invalid/proof.webp");
});

describe("GET /api/casa/admin/entries", () => {
  it.each([null, { id: userId, is_admin: false }])("no consulta pagos ni firma URLs sin administrador: %j", async (user) => {
    mocks.getAuthenticatedUser.mockResolvedValue(user);
    const result = await GET(request({ summary: "1" }));
    expect(result.status).toBe(403);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.signedProofUrl).not.toHaveBeenCalled();
  });

  it("cuenta mas de 1000 pendientes por polla, con cursor estable y sin firmar imagenes", async () => {
    const rows = Array.from({ length: 1000 }, (_, index) => ({
      id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      polla_id: index % 2 ? pollaId : otraPolla,
    }));
    dbFetch.mockResolvedValueOnce(response(rows)).mockResolvedValueOnce(response([
      { id: "10000000-0000-4000-8000-000000001001", polla_id: pollaId },
      { id: "10000000-0000-4000-8000-000000001002", polla_id: pollaId },
    ]));
    const result = await GET(request({ summary: "1" }));
    expect(await result.json()).toEqual({ counts: { [pollaId]: 502, [otraPolla]: 500 } });
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(dbFetch).toHaveBeenCalledTimes(2);
    expect(calledUrl().searchParams.get("select")).toBe("id,polla_id,casa_pollas!inner(archived_at)");
    expect(calledUrl().searchParams.get("casa_pollas.archived_at")).toBe("is.null");
    expect(calledUrl().searchParams.get("status")).toBe("eq.pendiente");
    expect(calledUrl().searchParams.get("proof_path")).toBe("not.is.null");
    expect(calledUrl().searchParams.get("order")).toBe("id.asc");
    expect(calledUrl(1).searchParams.get("id")).toBe(`gt.${rows[999].id}`);
    expect(mocks.signedProofUrl).not.toHaveBeenCalled();
  });

  it("no convierte un error del conteo en cero pendientes", async () => {
    dbFetch.mockResolvedValueOnce(response({ message: "private diagnostic" }, 500));
    const result = await GET(request({ summary: "1" }));
    expect(result.status).toBe(500);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await result.json()).toEqual({ error: "No se pudieron cargar los pagos pendientes." });
  });

  it("carga 25 pagos solo de la polla elegida y usa la fila 26 para hasMore", async () => {
    const entries = Array.from({ length: 26 }, (_, index) => ({
      id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      polla_id: pollaId,
      user_id: userId,
      amount_cop: 1000,
      ticket_number: null,
      proof_path: `fixtures/${index}.webp`,
      proof_uploaded_at: "2026-09-08T00:00:00.000Z",
    }));
    dbFetch.mockResolvedValueOnce(response(entries))
      .mockResolvedValueOnce(response([{ id: userId, display_name: "Persona de prueba" }]))
      .mockResolvedValueOnce(response([{ id: pollaId, name: "Polla de prueba", slug: "prueba" }]));
    const result = await GET(request({ pollaId, page: "1" }));
    const data = await result.json();
    expect(result.status).toBe(200);
    expect(data.pendientes).toHaveLength(25);
    expect(data.hasMore).toBe(true);
    expect(data.pendientes[0]).toMatchObject({ pollaId, jugador: "Persona de prueba", polla: "Polla de prueba", comprobanteUrl: "https://example.invalid/proof.webp" });
    expect(calledUrl().searchParams.get("polla_id")).toBe(`eq.${pollaId}`);
    expect(calledUrl().searchParams.get("casa_pollas.archived_at")).toBe("is.null");
    expect(calledUrl().searchParams.get("offset")).toBe("25");
    expect(calledUrl().searchParams.get("limit")).toBe("26");
    expect(calledUrl().searchParams.get("order")).toBe("proof_uploaded_at.asc.nullslast,id.asc");
    expect(JSON.parse(Buffer.from(data.nextCursor, "base64url").toString("utf8"))).toEqual({
      id: entries[24].id, uploadedAt: entries[24].proof_uploaded_at, pollaId,
    });
    expect(mocks.signedProofUrl).toHaveBeenCalledTimes(25);
  });

  it.each(["summary", "queue"])("excluye los pagos de pollas archivadas de %s", async (mode) => {
    const entries = [
      { id: userId, polla_id: pollaId, user_id: userId, proof_path: "visible.webp", casa_pollas: { archived_at: null } },
      { id: otraPolla, polla_id: otraPolla, user_id: userId, proof_path: "archived.webp", casa_pollas: { archived_at: "2026-09-08T00:00:00Z" } },
    ];
    dbFetch.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/users")) return response([{ id: userId, display_name: "Persona" }]);
      if (url.pathname.endsWith("/casa_pollas")) return response([{ id: pollaId, name: "Visible", slug: "visible" }]);
      const excludesArchived = url.searchParams.get("select")?.includes("casa_pollas!inner(archived_at)")
        && url.searchParams.get("casa_pollas.archived_at") === "is.null";
      return response(excludesArchived ? entries.filter((entry) => entry.casa_pollas.archived_at === null) : entries);
    });
    const result = await GET(request(mode === "summary" ? { summary: "1" } : {}));
    const data = await result.json();
    if (mode === "summary") {
      expect(data).toEqual({ counts: { [pollaId]: 1 } });
      expect(mocks.signedProofUrl).not.toHaveBeenCalled();
    } else {
      expect(data.pendientes.map((entry: { pollaId: string }) => entry.pollaId)).toEqual([pollaId]);
      expect(mocks.signedProofUrl).toHaveBeenCalledExactlyOnceWith("visible.webp");
    }
  });

  it.each([0, 24])("no omite el pago 26 si otro administrador resuelve la fila %i entre paginas", async (reviewedIndex) => {
    const allEntries = Array.from({ length: 26 }, (_, index) => ({
      id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      polla_id: pollaId, user_id: userId, amount_cop: 1000, ticket_number: null,
      proof_path: `fixtures/${index}.webp`, proof_uploaded_at: "2026-09-08T00:00:00.000Z",
    }));
    let pendingEntries = allEntries;
    dbFetch.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/users")) return response([{ id: userId, display_name: "Persona" }]);
      if (url.pathname.endsWith("/casa_pollas")) return response([{ id: pollaId, name: "Polla", slug: "polla" }]);
      let rows = pendingEntries;
      // Model the filtered server collection: offsets shift after approval,
      // while the UUID boundary for equal upload timestamps stays stable.
      const boundary = url.searchParams.get("or")?.match(/id\.gt\.([a-f0-9-]+)/)?.[1];
      if (boundary) rows = rows.filter((entry) => entry.id > boundary);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      return response(rows.slice(offset, offset + Number(url.searchParams.get("limit"))));
    });

    const first = await (await GET(request({ pollaId }))).json();
    expect(first.pendientes).toHaveLength(25);
    expect(first.nextCursor).toEqual(expect.any(String));
    // Approval may remove the first row or the cursor's own row.
    pendingEntries = pendingEntries.filter((_, index) => index !== reviewedIndex);
    const next = await (await GET(request({ pollaId, cursor: first.nextCursor }))).json();
    expect(next.pendientes.map((entry: { id: string }) => entry.id)).toEqual([allEntries[25].id]);
    expect(next.hasMore).toBe(false);
    expect(next.nextCursor).toBeNull();
    const nextQuery = calledUrl(3).searchParams;
    expect(nextQuery.has("offset")).toBe(false);
    expect(nextQuery.get("or")).toBe(`(proof_uploaded_at.gt.${allEntries[24].proof_uploaded_at},and(proof_uploaded_at.eq.${allEntries[24].proof_uploaded_at},id.gt.${allEntries[24].id}),proof_uploaded_at.is.null)`);
  });

  it("continua de forma estable entre comprobantes antiguos sin fecha", async () => {
    dbFetch.mockResolvedValueOnce(response([]));
    const cursor = Buffer.from(JSON.stringify({ id: userId, uploadedAt: null, pollaId })).toString("base64url");
    const result = await GET(request({ pollaId, cursor }));
    expect(result.status).toBe(200);
    expect(calledUrl().searchParams.get("proof_uploaded_at")).toBe("is.null");
    expect(calledUrl().searchParams.get("id")).toBe(`gt.${userId}`);
    expect(calledUrl().searchParams.has("offset")).toBe(false);
  });

  it.each([
    "invalid!",
    Buffer.from(JSON.stringify({ id: userId, uploadedAt: "2026-09-08T00:00:00Z),status.eq.pagada", pollaId })).toString("base64url"),
    Buffer.from(JSON.stringify({ id: userId, uploadedAt: null, pollaId: otraPolla })).toString("base64url"),
  ])("rechaza cursores invalidos o de otra polla antes de consultar: %s", async (cursor) => {
    const result = await GET(request({ pollaId, cursor }));
    expect(result.status).toBe(400);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(dbFetch).not.toHaveBeenCalled();
  });

  it.each([
    { pollaId: "invalid", page: "0" },
    { pollaId, page: "-1" },
    { pollaId, page: "1.5" },
    { pollaId, page: "999999999999999999999999" },
  ])("rechaza filtros invalidos: %j", async (params) => {
    const result = await GET(request(params));
    expect(result.status).toBe(400);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(dbFetch).not.toHaveBeenCalled();
  });

  it("una polla sin pendientes no hace queries extra ni firma imagenes", async () => {
    dbFetch.mockResolvedValueOnce(response([]));
    const result = await GET(request({ pollaId }));
    expect(await result.json()).toEqual({ pendientes: [], hasMore: false, nextCursor: null });
    expect(dbFetch).toHaveBeenCalledTimes(1);
    expect(mocks.signedProofUrl).not.toHaveBeenCalled();
  });
});
