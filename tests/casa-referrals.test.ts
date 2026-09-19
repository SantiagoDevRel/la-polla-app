import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/supabase/middleware", () => ({ updateSession: vi.fn(async () => NextResponse.next()) }));

import { proxy } from "@/proxy";
import { updateSession } from "@/lib/supabase/middleware";
import {
  REFERRAL_COOKIE,
  REFERRAL_FINE_PRINT,
  isGiftEntry,
  isPromoPolla,
  pickPromoPolla,
  normalizeReferralCode,
  referralErrorMessage,
  referralEvery,
  referralLink,
  referralMissing,
  referralProgress,
  referralPromo,
  referralRule,
  validReferralCode,
} from "@/lib/casa/referrals-shared";
import { premioCompartir, textoCompartir } from "@/lib/casa/share-text";
import { buildEditChanges, editableFieldsFromPolla, type EditableFields } from "@/lib/casa/editor";
import { referralGiftMessage } from "@/lib/telegram-player/notify";
import { participationState } from "@/components/casa/Participaciones";

describe("códigos de invitación", () => {
  it("normaliza lo que escribe la persona", () => {
    expect(normalizeReferralCode(" juanpe-4821 ")).toBe("JUANPE4821");
    expect(normalizeReferralCode("")).toBeNull();
    expect(normalizeReferralCode("x".repeat(41))).toBeNull();
  });

  it("solo acepta el formato de casa_referral_codes", () => {
    expect(validReferralCode("ana0001")).toBe("ANA0001");
    expect(validReferralCode("POLLA123456")).toBe("POLLA123456");
    expect(validReferralCode("AB1234")).toBeNull();
    expect(validReferralCode("JUANPER1234")).toBeNull();
    expect(validReferralCode("JUAN123")).toBeNull();
    expect(validReferralCode("<script>")).toBeNull();
  });

  it("explica cada resultado de SQL y cae en un mensaje genérico", () => {
    expect(referralErrorMessage("REFERRAL_LOCKED")).toMatch(/primer pago/);
    expect(referralErrorMessage("NOT_NEW_USER")).toMatch(/primera vez/);
    expect(referralErrorMessage("OTRA_COSA")).toMatch(/Intenta de nuevo/);
  });
});

describe("reglas de la polla", () => {
  const polla = { kind: "partidos" as const, entry_price_cop: 20000, referral_every: 5 };

  it("rifas, entradas gratis y pollas sin programa no participan", () => {
    expect(referralEvery(polla)).toBe(5);
    expect(referralEvery({ ...polla, kind: "manual" })).toBe(5);
    expect(referralEvery({ ...polla, kind: "rifa" })).toBeNull();
    expect(referralEvery({ ...polla, entry_price_cop: 0 })).toBeNull();
    expect(referralEvery({ ...polla, referral_every: null })).toBeNull();
    expect(referralEvery({ kind: "partidos", entry_price_cop: 20000 })).toBeNull();
  });

  it("la regla es una frase con el número de la polla y una sola letra menuda", () => {
    expect(referralRule(5)).toBe("Por cada 5 invitados, te damos un cupo gratis.");
    expect(referralRule(1)).toBe("Por cada invitado, te damos un cupo gratis.");
    expect(REFERRAL_FINE_PRINT).toBe("*Cuenta cada usuario nuevo que entre con tu código o enlace y pague una polla.");
    expect(referralMissing(0, 5)).toBe(5);
    expect(referralMissing(3, 5)).toBe(2);
    expect(referralMissing(5, 5)).toBe(5);
  });

  it("la barrita va de 0/5 a 5/5 camino al próximo cupo", () => {
    expect(referralProgress(0, 5, 0)).toBe(0);
    expect(referralProgress(3, 5, 0)).toBe(3);
    // Cupo recién ganado y sin usar: se ve llena, no vuelve a cero.
    expect(referralProgress(5, 5, 1)).toBe(5);
    // Ya lo usó: arranca el siguiente.
    expect(referralProgress(5, 5, 0)).toBe(0);
    expect(referralProgress(7, 5, 1)).toBe(2);
  });

  it("el cupo de regalo se distingue del comprado", () => {
    expect(isGiftEntry({ origin: "invitacion" })).toBe(true);
    expect(isGiftEntry({ origin: "compra" })).toBe(false);
    expect(isGiftEntry(null)).toBe(false);
    expect(participationState({ status: "pagada", proof_path: null, origin: "invitacion" })).toBe("regalo");
    expect(participationState({ status: "pagada", proof_path: "x", origin: "compra" })).toBe("activa");
  });
});

describe("compartir con código", () => {
  it("el enlace lleva el código y el dominio público", () => {
    expect(referralLink("https://lapollacolombiana.com", "ofigolazo", "JUANPE4821"))
      .toBe("https://lapollacolombiana.com/polla/ofigolazo?ref=JUANPE4821");
    expect(referralLink("https://lapollacolombiana.com", "ofigolazo", null)).toBe("https://lapollacolombiana.com/polla/ofigolazo");
    expect(referralLink("https://lapollacolombiana.com", null, "ANA0001")).toBe("https://lapollacolombiana.com/inicio?ref=ANA0001");
  });

  it("el mensaje dice el código para quien entre sin el enlace", () => {
    expect(textoCompartir({ nombre: "X", entradaCop: 20000, premio: null, codigo: "ANA0001" }))
      .toMatch(/\nUsa mi código ANA0001 al inscribirte\.$/);
    expect(textoCompartir({ nombre: "X", entradaCop: 20000, premio: null, codigo: "ANA0001", english: true }))
      .toMatch(/\nUse my code ANA0001 when you join\.$/);
    expect(textoCompartir({ nombre: "X", entradaCop: 20000, premio: null })).not.toMatch(/código/);
  });

  it("solo anuncia el premio que ya se conoce", () => {
    expect(premioCompartir({ prize_kind: "pozo", pot_mode: "fijo" }, 500000)).toEqual({ cop: 500000 });
    expect(premioCompartir({ prize_kind: "pozo", pot_mode: "proporcional" }, 500000)).toBeNull();
    expect(premioCompartir({ prize_kind: "objeto", prize_object: "Camiseta" }, 0)).toEqual({ objeto: "Camiseta" });
    expect(premioCompartir({ prize_kind: "objeto", prize_object: null }, 0)).toBeNull();
  });
});

describe("aviso de invitaciones al entrar", () => {
  const polla = {
    id: "p1", slug: "ofigolazo-1", name: "OFIGOLAZO", kind: "partidos" as const, entry_price_cop: 20000,
    prize_kind: "pozo" as const, prize_object: null, pot_mode: "fijo" as const, referral_every: 5,
  };
  const view = { code: "JUANPE4821", every: 5 };

  it("sale en la polla abierta con invitaciones, se llame como se llame", () => {
    expect(isPromoPolla(polla)).toBe(true);
    expect(isPromoPolla({ ...polla, name: "POLLAGOL" })).toBe(true);
    expect(referralPromo(polla, view, 1000000)).toEqual({
      pollaId: "p1", slug: "ofigolazo-1", name: "OFIGOLAZO", every: 5, code: "JUANPE4821",
      entryPriceCop: 20000, premio: { cop: 1000000 },
    });
  });

  it("entre varias abiertas elige la que cierra primero, con desempate estable", () => {
    const a = { ...polla, id: "a", closes_at: "2026-09-20T10:25:00Z" };
    const b = { ...polla, id: "b", closes_at: "2026-09-21T10:25:00Z" };
    const c = { ...polla, id: "c", closes_at: "2026-09-20T10:25:00Z" };
    expect(pickPromoPolla([b, c, a])?.id).toBe("a");
    expect(pickPromoPolla([c, a])?.id).toBe("a");
    expect(pickPromoPolla([{ ...b, referral_every: null }])).toBeUndefined();
    expect(pickPromoPolla([])).toBeUndefined();
  });

  it("no sale sin programa o sin código", () => {
    expect(isPromoPolla({ ...polla, referral_every: null })).toBe(false);
    expect(isPromoPolla({ ...polla, entry_price_cop: 0 })).toBe(false);
    expect(isPromoPolla({ ...polla, kind: "rifa" })).toBe(false);
    expect(referralPromo(polla, { ...view, code: null }, 0)).toBeNull();
    expect(referralPromo(polla, { ...view, every: null }, 0)).toBeNull();
    expect(referralPromo(polla, null, 0)).toBeNull();
  });
});

describe("proxy: enlace de invitación", () => {
  const url = "https://lapollacolombiana.com/polla/ofigolazo?ref=juanpe4821&x=1";

  it("guarda el primer código y limpia la URL", async () => {
    const response = await proxy(new NextRequest(url, { headers: { "sec-fetch-dest": "document" } }));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://lapollacolombiana.com/polla/ofigolazo?x=1");
    const cookie = response.cookies.get(REFERRAL_COOKIE);
    expect(cookie?.value).toBe("JUANPE4821");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.maxAge).toBe(60 * 60 * 24 * 30);
  });

  it("no reemplaza el enlace que la persona abrió primero", async () => {
    const response = await proxy(new NextRequest(url, { headers: { cookie: `${REFERRAL_COOKIE}=ANA0001` } }));
    expect(response.status).toBe(307);
    expect(response.cookies.get(REFERRAL_COOKIE)).toBeUndefined();
  });

  it("un código inválido o una carga que no es navegación no dejan cookie", async () => {
    const invalid = await proxy(new NextRequest("https://lapollacolombiana.com/polla/x?ref=<b>"));
    expect(invalid.status).toBe(307);
    expect(invalid.cookies.get(REFERRAL_COOKIE)).toBeUndefined();
    const image = await proxy(new NextRequest(url, { headers: { "sec-fetch-dest": "image" } }));
    expect(image.cookies.get(REFERRAL_COOKIE)).toBeUndefined();
  });

  it("las API y los POST siguen su camino normal", async () => {
    vi.mocked(updateSession).mockClear();
    const api = await proxy(new NextRequest("https://lapollacolombiana.com/api/casa/referidos?ref=ANA0001"));
    expect(api.status).toBe(200);
    const post = await proxy(new NextRequest(url, { method: "POST" }));
    expect(post.status).toBe(200);
    expect(updateSession).toHaveBeenCalledTimes(2);
  });
});

// (2026-09-18) La casa pasó a llamarse /inicio y cada polla a /polla/<slug>.
// Los enlaces /casa/* ya están pegados en WhatsApp, en Telegram, en enlaces de
// invitación y de cortesía: si esta redirección se cae, todos esos se caen.
describe("proxy: los enlaces viejos de /casa siguen abriendo", () => {
  const permanente = async (path: string) => {
    const response = await proxy(new NextRequest(`https://lapollacolombiana.com${path}`, { headers: { "sec-fetch-dest": "document" } }));
    return { status: response.status, location: response.headers.get("location") };
  };

  it("la lista, la polla y su pago se mudan con 308", async () => {
    expect(await permanente("/casa")).toEqual({ status: 308, location: "https://lapollacolombiana.com/inicio" });
    expect(await permanente("/casa/ofigolazo")).toEqual({ status: 308, location: "https://lapollacolombiana.com/polla/ofigolazo" });
    expect(await permanente("/casa/ofigolazo/pagar")).toEqual({ status: 308, location: "https://lapollacolombiana.com/polla/ofigolazo/pagar" });
  });

  it("conserva la query, que es donde viaja el código de invitación", async () => {
    expect(await permanente("/casa/ofigolazo?ref=JUANPE4821")).toEqual({
      status: 308, location: "https://lapollacolombiana.com/polla/ofigolazo?ref=JUANPE4821",
    });
  });

  it("no toca el panel de administración ni las API", async () => {
    expect((await permanente("/casa/admin")).status).not.toBe(308);
    expect((await permanente("/api/casa/mis-pollas")).status).not.toBe(308);
  });
});

describe("editor: interruptor de invitaciones", () => {
  const row = {
    name: "Fecha 5", description: null, scoring_mode: "marcador" as const, entry_price_cop: 20000, house_cut_pct: 30,
    pot_mode: "proporcional" as const, fixed_prize_cop: null, prize_object: null, payout_method: "nequi",
    payout_account: "300", payout_account_name: null, max_entries_per_user: 10, referral_every: 5,
  };
  const base: EditableFields = editableFieldsFromPolla(row);
  const pool = { hasEntries: false, kind: "partidos" as const, prizeKind: "pozo" as const };

  it("lee el estado de la polla", () => {
    expect(base.referralOn).toBe(true);
    expect(editableFieldsFromPolla({ ...row, referral_every: null }).referralOn).toBe(false);
  });

  it("apagar y prender viajan solo sin inscripciones y nunca en rifas", () => {
    expect(buildEditChanges(base, { ...base, referralOn: false }, pool)).toEqual({ referralEvery: null });
    expect(buildEditChanges({ ...base, referralOn: false }, base, pool)).toEqual({ referralEvery: 5 });
    expect(buildEditChanges(base, { ...base, referralOn: false }, { ...pool, hasEntries: true })).toEqual({});
    // Prender sí se puede con inscripciones (POLLAGOL, 2026-09-17).
    expect(buildEditChanges({ ...base, referralOn: false }, base, { ...pool, hasEntries: true })).toEqual({ referralEvery: 5 });
    expect(buildEditChanges(base, { ...base, referralOn: false }, { ...pool, kind: "rifa" })).toEqual({});
  });
});

describe("aviso de cupo gratis por Telegram", () => {
  it("dice cuántos invitados pagaron y lleva a elegir la polla", () => {
    const message = referralGiftMessage({ userId: "u", invited: 5 });
    expect(message.text).toContain("¡Ganaste un cupo gratis!");
    expect(message.text).toContain("5 personas que invitaste ya pagaron una polla.");
    expect(message.text).toContain("Úsalo en la polla que quieras");
    expect(message.buttons[0][0]).toEqual({ text: "👉 Ver las pollas", url: "https://lapollacolombiana.com/inicio" });
  });
});
