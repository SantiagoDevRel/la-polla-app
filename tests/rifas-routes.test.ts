// tests/rifas-routes.test.ts — rutas de rifas de creadores (migración 157).
//
// Lo que no puede cambiar sin que alguien lo decida:
//   · con RIFAS_ENABLED apagado ninguna ruta existe (404) y /api/rifas GET dice enabled:false;
//   · sin sesión, 401 antes de tocar la base;
//   · el actor que llega a SQL es SIEMPRE el uuid de la sesión, nunca un dato del cuerpo;
//   · crear rifa sin permiso llega a SQL y vuelve 403 (CREATOR_REQUIRED), sin atajos en TS;
//   · el panel de admin exige users.is_admin antes de llamar SQL;
//   · los códigos de SQL se traducen a mensajes y estados (NUMBER_TAKEN → 409 con el número).
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRifaViewer: vi.fn(),
  rifaRpc: vi.fn(),
  rifaIdBySlug: vi.fn(),
  rifasEnabled: vi.fn(),
  getMyRifas: vi.fn(),
  getPublicView: vi.fn(),
  getCreatorView: vi.fn(),
  lastPaymentAccount: vi.fn(),
  notifyBuyerReview: vi.fn(),
  notifyCreatorNewProof: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/rifas/server", () => ({
  ...mocks,
  validSlug: (s: string) => /^(?=[a-z0-9-]{3,40}$)[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s),
  RIFA_PROOF_BUCKET: "rifa-proofs",
  RIFA_MEDIA_BUCKET: "rifa-media",
  RIFA_LINK_COOKIE: "lp_rifa",
  signedRifaFile: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/casa/uploads", () => ({ signedCasaUpload: vi.fn(), verifyCasaUpload: vi.fn() }));

import { GET as listGet, POST as createPost } from "@/app/api/rifas/route";
import { POST as reservarPost } from "@/app/api/rifas/[slug]/reservar/route";
import { POST as gestionPost } from "@/app/api/rifas/[slug]/gestion/route";
import { GET as adminGet, POST as adminPost } from "@/app/api/admin/rifas/route";

const SLUG = "abcd2345";
const RIFA = "00000000-0000-4000-8000-0000000000aa";
const ME = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const params = { params: Promise.resolve({ slug: SLUG }) };

function req(body: unknown) {
  return new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

const createBody = {
  name: "Boleta Sur", prizeKind: "texto", prizeCop: null, prizeText: "Boleta para el clásico", numberCount: 100, priceCop: 6000,
  lotteryName: "Astro Sol", digitsRule: "ultimas_dos", drawAt: "2026-10-13T22:30", visibility: "privada",
  paymentMethod: "nequi", paymentAccount: "3001234567", paymentHolder: "Creadora",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.rifasEnabled.mockReturnValue(true);
  mocks.getRifaViewer.mockResolvedValue({ id: ME, is_admin: false, display_name: "Yo" });
  mocks.rifaIdBySlug.mockResolvedValue(RIFA);
});

describe("RIFAS_ENABLED apagado", () => {
  it("GET /api/rifas responde enabled:false y no toca la base", async () => {
    mocks.rifasEnabled.mockReturnValue(false);
    const res = await listGet();
    expect(await res.json()).toEqual({ enabled: false });
    expect(mocks.getRifaViewer).not.toHaveBeenCalled();
  });
  it.each([
    ["crear", () => createPost(req(createBody))],
    ["reservar", () => reservarPost(req({ action: "reservar", numbers: [7] }), params)],
    ["gestion", () => gestionPost(req({ action: "aprobar", proofId: RIFA }), params)],
    ["admin", () => adminGet()],
  ])("%s → 404", async (_label, call) => {
    mocks.rifasEnabled.mockReturnValue(false);
    const res = await call();
    expect(res.status).toBe(404);
    expect(mocks.rifaRpc).not.toHaveBeenCalled();
  });
});

describe("sesión", () => {
  it("sin sesión: 401 antes de llamar SQL", async () => {
    mocks.getRifaViewer.mockResolvedValue(null);
    for (const res of [await createPost(req(createBody)), await reservarPost(req({ action: "reservar", numbers: [7] }), params),
      await gestionPost(req({ action: "aprobar", proofId: RIFA }), params), await adminGet()]) {
      expect(res.status).toBe(401);
    }
    expect(mocks.rifaRpc).not.toHaveBeenCalled();
  });
});

describe("el actor sale de la sesión", () => {
  it("reservar ignora un comprador enviado en el cuerpo", async () => {
    mocks.rifaRpc.mockResolvedValue({ data: { numbers: [7], amount_cop: 6000 }, error: null });
    await reservarPost(req({ action: "reservar", numbers: [7], buyer: OTHER, p_buyer: OTHER }), params);
    expect(mocks.rifaRpc).toHaveBeenCalledWith("rifa_reserve_v1", { p_rifa: RIFA, p_buyer: ME, p_numbers: [7] });
  });
  it("aprobar manda la sesión como actor; SQL decide si es el creador", async () => {
    mocks.rifaRpc.mockResolvedValue({ data: null, error: { message: "CREATOR_ONLY", code: "42501", details: "" } });
    const res = await gestionPost(req({ action: "aprobar", proofId: RIFA, actor: OTHER }), params);
    expect(mocks.rifaRpc).toHaveBeenCalledWith("rifa_review_proof_v1", { p_actor: ME, p_proof: RIFA, p_decision: "aprobar", p_reason: null });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Solo quien creó la rifa puede hacer esto.");
    expect(mocks.notifyBuyerReview).not.toHaveBeenCalled();
  });
});

describe("crear rifa", () => {
  it("sin permiso de creador: SQL responde CREATOR_REQUIRED → 403", async () => {
    mocks.rifaRpc.mockResolvedValue({ data: null, error: { message: "CREATOR_REQUIRED", code: "42501", details: "" } });
    const res = await createPost(req(createBody));
    expect(res.status).toBe(403);
    expect(mocks.rifaRpc.mock.calls[0][1]).toMatchObject({ p_actor: ME, p_prize_cop: null, p_prize_text: "Boleta para el clásico" });
  });
  it("la hora del sorteo se interpreta en Colombia (UTC−5)", async () => {
    mocks.rifaRpc.mockResolvedValue({ data: { id: RIFA, slug: SLUG }, error: null });
    const res = await createPost(req(createBody));
    expect(res.status).toBe(201);
    expect(new Date(mocks.rifaRpc.mock.calls[0][1].p_draw_at as string).toISOString()).toBe("2026-10-14T03:30:00.000Z");
  });
  it("más de 100 números no pasa la validación", async () => {
    const res = await createPost(req({ ...createBody, numberCount: 101 }));
    expect(res.status).toBe(400);
    expect(mocks.rifaRpc).not.toHaveBeenCalled();
  });
});

describe("errores de SQL", () => {
  it("NUMBER_TAKEN → 409 con el número exacto de SQL", async () => {
    mocks.rifaRpc.mockResolvedValue({ data: null, error: { message: "NUMBER_TAKEN", code: "55000", details: "El 07 ya lo tomó otra persona. Elige otro número." } });
    const res = await reservarPost(req({ action: "reservar", numbers: [7] }), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "El 07 ya lo tomó otra persona. Elige otro número.", code: "NUMBER_TAKEN" });
  });
  it("una Privada ajena responde 404 como una inexistente", async () => {
    mocks.rifaRpc.mockResolvedValue({ data: null, error: { message: "RIFA_NOT_FOUND", code: "P0002", details: "" } });
    expect((await reservarPost(req({ action: "reservar", numbers: [7] }), params)).status).toBe(404);
  });
});

describe("admin", () => {
  it("un no-admin no llega a SQL", async () => {
    const res = await adminPost(req({ action: "asignar", userId: OTHER }));
    expect(res.status).toBe(403);
    expect(mocks.rifaRpc).not.toHaveBeenCalled();
  });
  it("asignar y quitar llaman sus RPC con el admin de la sesión", async () => {
    mocks.getRifaViewer.mockResolvedValue({ id: ME, is_admin: true, display_name: "Admin" });
    mocks.rifaRpc.mockResolvedValue({ data: { ok: true }, error: null });
    await adminPost(req({ action: "asignar", userId: OTHER }));
    await adminPost(req({ action: "quitar", userId: OTHER }));
    expect(mocks.rifaRpc).toHaveBeenNthCalledWith(1, "rifa_grant_creator_v1", { p_actor: ME, p_user: OTHER });
    expect(mocks.rifaRpc).toHaveBeenNthCalledWith(2, "rifa_revoke_creator_v1", { p_actor: ME, p_user: OTHER });
  });
  it("ocultar exige motivo", async () => {
    mocks.getRifaViewer.mockResolvedValue({ id: ME, is_admin: true, display_name: "Admin" });
    expect((await adminPost(req({ action: "ocultar", rifaId: RIFA, reason: "" }))).status).toBe(400);
  });
});
