// tests/casa-courtesies.test.ts — cortesías (migración 136).
//
// Lo que se protege acá: el formato del código que viaja en el enlace, cuándo
// una cortesía todavía sirve, y que el canje NUNCA decida por su cuenta — la
// respuesta de SQL es la que manda, y la cookie se descarta cuando el enlace ya
// no le va a servir a esa persona.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  redeem: vi.fn(),
  listMine: vi.fn(),
  cookieStore: { get: vi.fn(), delete: vi.fn() },
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => mocks.cookieStore }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/casa/courtesies", () => ({
  redeemCourtesy: mocks.redeem,
  listMyCourtesies: mocks.listMine,
}));

import { GET, POST } from "@/app/api/casa/cortesias/route";
import {
  COURTESY_COOKIE,
  courtesyLabel,
  courtesyLink,
  isCourtesyEntry,
  isCourtesyLive,
  normalizeCourtesyCode,
  validCourtesyCode,
  type MyCourtesy,
} from "@/lib/casa/courtesies-shared";
import { participationState } from "@/components/casa/Participaciones";

const userId = "00000000-0000-4000-8000-000000000001";
const code = "ABCDEFGHJK";

function redeemRequest(body: unknown = {}, contract = true) {
  return new Request("http://localhost/api/casa/cortesias", {
    method: "POST",
    headers: contract ? { "Content-Type": "application/json", "X-Casa-Contract": "2" } : { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const courtesy = (overrides: Partial<MyCourtesy> = {}): MyCourtesy => ({
  id: "c1",
  code,
  status: "disponible",
  slug: "ofigolazo",
  polla: "OFIGOLAZO",
  closes_at: new Date(Date.now() + 86_400_000).toISOString(),
  polla_status: "abierta",
  redeemed_name: null,
  redeemed_at: null,
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createClient.mockResolvedValue({ auth: { getUser: mocks.getUser } });
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  mocks.cookieStore.get.mockReturnValue({ value: code });
});

describe("código del enlace", () => {
  it("acepta el código con espacios, guiones o minúsculas", () => {
    expect(normalizeCourtesyCode(" abcd-efgh-jk ")).toBe("ABCDEFGHJK");
    expect(validCourtesyCode("abcd efgh jk")).toBe(code);
  });

  it("rechaza lo que no tiene la forma del código", () => {
    // 0, O, 1, I y L quedan fuera del alfabeto justo para que nadie los confunda.
    expect(validCourtesyCode("ABCDEFGHI0")).toBeNull();
    expect(validCourtesyCode("ABCDEFGH")).toBeNull();
    expect(validCourtesyCode("")).toBeNull();
    expect(validCourtesyCode(null)).toBeNull();
    expect(validCourtesyCode("x".repeat(60))).toBeNull();
  });

  it("arma el enlace de la polla con el código", () => {
    expect(courtesyLink("https://lapollacolombiana.com", "ofigolazo", code))
      .toBe(`https://lapollacolombiana.com/casa/ofigolazo?cortesia=${code}`);
  });
});

describe("estado de una cortesía", () => {
  it("vence con la polla: cerrada o pasada la fecha ya no sirve", () => {
    expect(isCourtesyLive(courtesy())).toBe(true);
    expect(isCourtesyLive(courtesy({ polla_status: "cerrada" }))).toBe(false);
    expect(isCourtesyLive(courtesy({ closes_at: new Date(Date.now() - 1000).toISOString() }))).toBe(false);
    expect(courtesyLabel(courtesy({ polla_status: "cerrada" })).text).toBe("Vencida");
  });

  it("dice quién la usó cuando ya se redimió", () => {
    expect(courtesyLabel(courtesy({ status: "redimida", redeemed_name: "Ana" })).text).toBe("La usó Ana");
    expect(courtesyLabel(courtesy({ status: "revocada" })).text).toBe("Retirada");
    // Migración 137: la que el administrador quitó DESPUÉS de usarse.
    expect(courtesyLabel(courtesy({ status: "retirada", redeemed_name: "Ana" })).text).toBe("Retirada");
    expect(courtesyLabel(courtesy({ status: "retirada" })).tone).toBe("mute");
    expect(isCourtesyLive(courtesy({ status: "retirada" }))).toBe(false);
  });
});

describe("qué cupo entró con cortesía", () => {
  // La cortesía y el regalo por invitar (migración 135) tienen la MISMA forma:
  // pagado, sin comprobante y sin monto. Lo único que los separa es `origin`, y
  // confundirlos le pondría «Cortesía» al cupo que alguien se ganó invitando.
  it("reconoce el cupo de cortesía", () => {
    const cupo = { status: "pagada" as const, proof_path: null, amount_cop: 0, origin: "compra" as const };
    expect(isCourtesyEntry(cupo)).toBe(true);
    expect(participationState(cupo)).toBe("cortesia");
  });

  it("nunca confunde un regalo por invitar con una cortesía", () => {
    const regalo = { status: "pagada" as const, proof_path: null, amount_cop: 0, origin: "invitacion" as const };
    expect(isCourtesyEntry(regalo)).toBe(false);
    expect(participationState(regalo)).toBe("regalo");
  });

  it("un cupo pagado de verdad sigue siendo pagado", () => {
    const pagado = { status: "pagada" as const, proof_path: "casa/x.jpg", amount_cop: 20000, origin: "compra" as const };
    expect(isCourtesyEntry(pagado)).toBe(false);
    expect(participationState(pagado)).toBe("activa");
  });
});

describe("canje de la cortesía", () => {
  it("exige sesión antes de tocar la base", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await POST(redeemRequest());
    expect(response.status).toBe(401);
    expect(mocks.redeem).not.toHaveBeenCalled();
  });

  it("exige el contrato de la app", async () => {
    const response = await POST(redeemRequest({}, false));
    expect(response.status).toBe(409);
    expect(mocks.redeem).not.toHaveBeenCalled();
  });

  it("usa el código de la cookie que dejó el enlace", async () => {
    mocks.redeem.mockResolvedValue({ ok: true, slug: "ofigolazo", polla: "OFIGOLAZO", entry_number: 1 });
    const response = await POST(redeemRequest());
    expect(mocks.redeem).toHaveBeenCalledWith(code, userId);
    expect(response.status).toBe(200);
    // La cookie se descarta: el enlace ya se usó y no debe perseguir a nadie.
    expect(response.cookies.get(COURTESY_COOKIE)?.value).toBe("");
  });

  it("sin cookie ni código no llama a la base", async () => {
    mocks.cookieStore.get.mockReturnValue(undefined);
    const response = await POST(redeemRequest());
    expect(response.status).toBe(404);
    expect(mocks.redeem).not.toHaveBeenCalled();
  });

  it("traduce el rechazo de SQL sin inventar un resultado", async () => {
    mocks.redeem.mockResolvedValue({ ok: false, error: "NOT_NEW_USER", slug: "ofigolazo" });
    const response = await POST(redeemRequest());
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("NOT_NEW_USER");
    expect(body.error).toContain("primera vez");
    expect(response.cookies.get(COURTESY_COOKIE)?.value).toBe("");
  });

  it("conserva la cookie cuando la polla apenas cerró: el código sigue siendo suyo", async () => {
    mocks.redeem.mockResolvedValue({ ok: false, error: "COURTESY_EXPIRED", slug: "ofigolazo" });
    const response = await POST(redeemRequest());
    expect(response.status).toBe(409);
    expect(response.cookies.get(COURTESY_COOKIE)).toBeUndefined();
  });
});

describe("mis cortesías", () => {
  it("exige sesión", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await GET();
    expect(response.status).toBe(401);
    expect(mocks.listMine).not.toHaveBeenCalled();
  });

  it("devuelve solo las de esa persona y no cachea", async () => {
    mocks.listMine.mockResolvedValue([courtesy()]);
    const response = await GET();
    expect(mocks.listMine).toHaveBeenCalledWith(userId);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await response.json()).cortesias).toHaveLength(1);
  });
});
