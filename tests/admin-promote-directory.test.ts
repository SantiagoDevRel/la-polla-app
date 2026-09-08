import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/auth/admin", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { GET } from "@/app/api/admin/promote/route";

// NANP 555-0100..0199 son numeros ficticios reservados; cero datos reales.
const usuarios = Array.from({ length: 51 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  display_name: `Persona de prueba ${String(index + 1).padStart(2, "0")}`,
  whatsapp_number: `1202555${String(100 + index).padStart(4, "0")}`,
  is_admin: index === 0,
}));

const dbFetch = vi.fn<typeof fetch>();

function request(params: Record<string, string> = { directory: "1" }) {
  if (params.directory === "1") {
    const { q = "", ...pagination } = params;
    return new NextRequest(`http://localhost/api/admin/promote?${new URLSearchParams(pagination)}`, {
      headers: { "X-User-Search": encodeURIComponent(q) },
    });
  }
  return new NextRequest(`http://localhost/api/admin/promote?${new URLSearchParams(params)}`);
}

function dbResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function queryUrl() {
  return new URL(String(dbFetch.mock.calls[0][0]));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getAuthenticatedUser.mockResolvedValue({ id: usuarios[0].id, is_admin: true });
  // El builder real de Supabase genera el request; solo la red es simulada.
  mocks.createAdminClient.mockImplementation(() => createClient(
    "http://localhost:54321",
    "test-only-key",
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: dbFetch },
    },
  ));
  dbFetch.mockResolvedValue(dbResponse(usuarios));
});

describe("GET /api/admin/promote directory", () => {
  it.each([null, { id: usuarios[1].id, is_admin: false }])(
    "no consulta el directorio sin administrador: %j",
    async (user) => {
      mocks.getAuthenticatedUser.mockResolvedValue(user);
      const response = await GET(request());

      expect(response.status).toBe(403);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await response.json()).toEqual({ error: "Solo el administrador." });
      expect(mocks.createAdminClient).not.toHaveBeenCalled();
      expect(dbFetch).not.toHaveBeenCalled();
    },
  );

  it("entrega 50 filas y usa la fila adicional para hasMore, sin cache", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ usuarios: usuarios.slice(0, 50), hasMore: true });
    const url = queryUrl();
    expect(url.pathname).toBe("/rest/v1/users");
    expect(url.searchParams.get("select")).toBe("id,display_name,whatsapp_number,is_admin");
    expect(url.searchParams.get("order")).toBe("display_name.asc,id.asc");
    expect(url.searchParams.get("offset")).toBe("0");
    expect(url.searchParams.get("limit")).toBe("51");
    expect(url.searchParams.has("or")).toBe(false);
  });

  it("carga la segunda pagina desde la fila 50 y detecta el final", async () => {
    dbFetch.mockResolvedValueOnce(dbResponse([usuarios[50]]));
    const response = await GET(request({ directory: "1", page: "1" }));

    expect(await response.json()).toEqual({ usuarios: [usuarios[50]], hasMore: false });
    expect(queryUrl().searchParams.get("offset")).toBe("50");
    expect(queryUrl().searchParams.get("limit")).toBe("51");
  });

  it("una pagina completa de 50 sin fila adicional ya es la ultima", async () => {
    dbFetch.mockResolvedValueOnce(dbResponse(usuarios.slice(0, 50)));
    const response = await GET(request());
    expect((await response.json()).hasMore).toBe(false);
  });

  it.each(["", "-1", "1.5", "1e2", "abc", "9007199254740991"])(
    "rechaza la pagina invalida %j antes de consultar datos",
    async (page) => {
      const response = await GET(request({ directory: "1", page }));
      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(mocks.createAdminClient).not.toHaveBeenCalled();
    },
  );

  it("busca nombres sin modificar acentos, espacios o apostrofes", async () => {
    await GET(request({ directory: "1", q: "  José D'Prueba  " }));
    expect(queryUrl().searchParams.get("or")).toBe("(display_name.ilike.%José D'Prueba%)");
  });

  it.each(["+1 (202) 555-0100", "12025550100", "555-0100"])(
    "normaliza un telefono completo o parcial: %s",
    async (q) => {
      await GET(request({ directory: "1", q }));
      const filter = queryUrl().searchParams.get("or");
      expect(filter).toContain(`whatsapp_number.ilike.%${q.replace(/\D/g, "")}%`);
      expect(filter?.split(",")).toHaveLength(2);
    },
  );

  it("impide que delimitadores, comillas y comodines agreguen filtros", async () => {
    await GET(request({ directory: "1", q: 'Prueba%),is_admin.eq.true,display_name.ilike.("*\\_' }));
    const filter = queryUrl().searchParams.get("or")!;
    expect(filter).toBe("(display_name.ilike.%Pruebaisadmin.eq.truedisplayname.ilike.%)");
    expect(filter.split(",")).toHaveLength(1);
    expect(filter.match(/\(/g)).toHaveLength(1);
    expect(filter.match(/\)/g)).toHaveLength(1);
    expect(filter).not.toContain("\\");
    expect(filter).not.toContain('"');
  });

  it("buscar solo comodines devuelve vacio sin enumerar todo", async () => {
    const response = await GET(request({ directory: "1", q: "%_*" }));
    expect(await response.json()).toEqual({ usuarios: [], hasMore: false });
    expect(dbFetch).not.toHaveBeenCalled();
  });

  it("un error de base se reporta sin datos internos ni cache", async () => {
    dbFetch.mockResolvedValueOnce(dbResponse({ message: "diagnostico interno", code: "XX000" }, 500));
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: "No se pudieron cargar los usuarios." });
  });

  it("una excepcion inesperada tambien produce respuesta privada", async () => {
    mocks.getAuthenticatedUser.mockRejectedValueOnce(new Error("diagnostico interno"));
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("sin directory conserva el contrato anterior sin agregar telefonos", async () => {
    const admins = [{ id: usuarios[0].id, display_name: usuarios[0].display_name }];
    const resultados = [{ id: usuarios[1].id, display_name: usuarios[1].display_name, is_admin: false }];
    dbFetch.mockResolvedValueOnce(dbResponse(admins)).mockResolvedValueOnce(dbResponse(resultados));
    const response = await GET(request({ q: "Persona" }));

    expect(await response.json()).toEqual({ yoId: usuarios[0].id, admins, resultados });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    for (const call of dbFetch.mock.calls) {
      expect(new URL(String(call[0])).searchParams.get("select")).not.toContain("whatsapp_number");
    }
  });
});
