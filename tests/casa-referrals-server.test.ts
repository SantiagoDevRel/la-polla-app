// tests/casa-referrals-server.test.ts — vínculo desde la cookie del enlace (migración 135).
// La base es falsa: aquí solo se prueba cuándo la cookie lp_ref ya cumplió su función.
import { beforeEach, describe, expect, it, vi } from "vitest";

const adminFactory = vi.hoisted(() => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => adminFactory);
vi.mock("server-only", () => ({}));
vi.mock("@/lib/telegram-player/notify", () => ({ notifyReferralGiftByTelegram: vi.fn() }));

import { linkReferralFromCookie, notifyReferralGifts, redeemFreeEntry } from "@/lib/casa/referrals";
import { notifyReferralGiftByTelegram } from "@/lib/telegram-player/notify";

function answer(data: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  adminFactory.createAdminClient.mockReturnValue({ rpc });
  return rpc;
}

beforeEach(() => adminFactory.createAdminClient.mockReset());

describe("linkReferralFromCookie", () => {
  it("vincula con el código del enlace y limpia la cookie", async () => {
    const rpc = answer({ ok: true, changed: true, locked: false, referrer: null });
    await expect(linkReferralFromCookie("u1", "juanpe4821")).resolves.toEqual({ linked: true, clearCookie: true });
    expect(rpc).toHaveBeenCalledWith("casa_set_referrer_v1", { p_user_id: "u1", p_code: "JUANPE4821", p_via: "enlace" });
  });

  it("con el tope de intentos conserva la cookie: pasada la hora, el enlace todavía vincula", async () => {
    answer({ ok: false, error: "REFERRAL_RATE_LIMITED" });
    await expect(linkReferralFromCookie("u1", "JUANPE4821")).resolves.toEqual({ linked: false, clearCookie: false });
  });

  it("un resultado final o un código con mal formato limpian la cookie", async () => {
    for (const error of ["REFERRAL_CODE_NOT_FOUND", "SELF_REFERRAL", "REFERRAL_EXISTS", "REFERRAL_LOCKED", "NOT_NEW_USER"]) {
      answer({ ok: false, error });
      await expect(linkReferralFromCookie("u1", "JUANPE4821")).resolves.toEqual({ linked: false, clearCookie: true });
    }
    await expect(linkReferralFromCookie("u1", "<b>")).resolves.toEqual({ linked: false, clearCookie: true });
    await expect(linkReferralFromCookie("u1", undefined)).resolves.toEqual({ linked: false, clearCookie: false });
  });

  it("si la base falla, la cookie se conserva para el próximo intento", async () => {
    answer(null, { message: "timeout" });
    await expect(linkReferralFromCookie("u1", "JUANPE4821")).resolves.toEqual({ linked: false, clearCookie: false });
  });
});

describe("cupo gratis (migración 144)", () => {
  it("canjea con el contrato vigente y devuelve el cupo", async () => {
    const rpc = answer({ ok: true, slug: "pollagol", entry_id: "e1", entry_number: 2, created: true });
    await expect(redeemFreeEntry("p1", "u1")).resolves.toMatchObject({ entry_number: 2, created: true });
    expect(rpc).toHaveBeenCalledWith("casa_referral_redeem_v1", { p_polla_id: "p1", p_user_id: "u1", p_contract: 2 });
  });

  it("propaga el rechazo de SQL (sin saldo, polla cerrada, tope)", async () => {
    answer(null, { message: "NO_FREE_ENTRY", code: "55000" });
    await expect(redeemFreeEntry("p1", "u1")).rejects.toMatchObject({ message: "NO_FREE_ENTRY" });
  });

  it("avisa cada cupo ganado con el total de invitados, y nunca rompe la revisión", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ event_id: "v1", user_id: "u1", detail: { invitados: 5, cada: 5 } }], error: null });
    await notifyReferralGifts({ rpc } as never);
    expect(rpc).toHaveBeenCalledWith("casa_referral_claim_credit_notices_v1", { p_limit: 20 });
    expect(notifyReferralGiftByTelegram).toHaveBeenCalledWith(expect.anything(), { userId: "u1", invited: 5 });
    await expect(notifyReferralGifts({ rpc: vi.fn().mockRejectedValue(new Error("x")) } as never)).resolves.toBeUndefined();
  });
});
