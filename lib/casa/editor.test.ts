import { describe, expect, it } from "vitest";
import {
  buildEditChanges,
  canEditPolla,
  editorErrorMessage,
  pollaEditBlock,
  removeMatchBlock,
  validateEditDraft,
  type EditableFields,
} from "./editor";

const now = new Date("2026-09-14T15:00:00Z");
const future = "2026-09-20T17:00:00Z";
const past = "2026-09-14T14:59:00Z";

describe("pollaEditBlock", () => {
  it("allows draft and open pools before their close", () => {
    expect(pollaEditBlock({ status: "borrador", closes_at: future }, now)).toBeNull();
    expect(canEditPolla({ status: "abierta", closes_at: future, settled_at: null }, now)).toBe(true);
  });

  it("locks at the exact close instant and after it", () => {
    expect(pollaEditBlock({ status: "abierta", closes_at: now.toISOString() }, now)).toBe("CLOSED");
    expect(pollaEditBlock({ status: "abierta", closes_at: past }, now)).toBe("CLOSED");
    expect(pollaEditBlock({ status: "cerrada", closes_at: future }, now)).toBe("CLOSED");
  });

  it("follows the SQL order: missing, archived, final, draw, closed", () => {
    expect(pollaEditBlock(null, now)).toBe("NOT_FOUND");
    expect(pollaEditBlock({ status: "resuelta", closes_at: past, archived_at: past }, now)).toBe("ARCHIVED");
    expect(pollaEditBlock({ status: "abierta", closes_at: future, settled_at: past }, now)).toBe("FINAL");
    expect(pollaEditBlock({ status: "abierta", closes_at: future, settlement_outcome: "money_awarded" }, now)).toBe("FINAL");
    expect(pollaEditBlock({ status: "anulada", closes_at: future }, now)).toBe("FINAL");
    expect(pollaEditBlock({ status: "abierta", closes_at: past, draw_pending: true }, now)).toBe("DRAW");
  });

  it("treats an unparseable close as closed", () => {
    expect(pollaEditBlock({ status: "abierta", closes_at: "no-date" }, now)).toBe("CLOSED");
  });
});

const base: EditableFields = {
  name: "Fecha 5",
  description: "",
  scoringMode: "1x2",
  entryPriceCop: 10000,
  houseCutPct: 20,
  potMode: "proporcional",
  fixedPrizeCop: null,
  prizeObject: "",
  payoutMethod: "Nequi",
  payoutAccount: "3000000000",
  payoutAccountName: "La casa",
  maxEntriesPerUser: 10,
};
const moneyPool = { hasEntries: false, kind: "partidos" as const, prizeKind: "pozo" as const };

describe("buildEditChanges", () => {
  it("sends nothing when nothing changed, even with surrounding spaces", () => {
    expect(buildEditChanges(base, { ...base, name: " Fecha 5 " }, moneyPool)).toEqual({});
  });

  it("sends only the changed keys, with blank text as null", () => {
    expect(
      buildEditChanges(base, { ...base, name: "Fecha 6", scoringMode: "marcador", payoutAccountName: "  " }, moneyPool),
    ).toEqual({ name: "Fecha 6", scoringMode: "marcador", payoutAccountName: null });
    expect(buildEditChanges({ ...base, description: "Antes" }, base, moneyPool)).toEqual({ description: null });
  });

  it("with entries only name and description travel", () => {
    const draft = { ...base, name: "Con gente", description: "Nueva", entryPriceCop: 5000, scoringMode: "marcador" as const };
    expect(buildEditChanges(base, draft, { ...moneyPool, hasEntries: true })).toEqual({ name: "Con gente", description: "Nueva" });
  });

  it("switching to a fixed pot sends the mode and the prize", () => {
    expect(buildEditChanges(base, { ...base, potMode: "fijo", fixedPrizeCop: 200000 }, moneyPool)).toEqual({
      potMode: "fijo",
      fixedPrizeCop: 200000,
    });
    // Back to proportional: the stale fixed amount is not sent.
    expect(
      buildEditChanges({ ...base, potMode: "fijo", fixedPrizeCop: 200000 }, { ...base, fixedPrizeCop: 200000 }, moneyPool),
    ).toEqual({ potMode: "proporcional" });
  });

  it("object prizes never send pot fields and rifas/manual never send scoring", () => {
    const objectPool = { hasEntries: false, kind: "manual" as const, prizeKind: "objeto" as const };
    expect(
      buildEditChanges(base, { ...base, houseCutPct: 50, potMode: "fijo", fixedPrizeCop: 1, prizeObject: "Camiseta", scoringMode: "marcador" }, objectPool),
    ).toEqual({ prizeObject: "Camiseta" });
  });
});

describe("validateEditDraft", () => {
  it("validates name and money fields", () => {
    expect(validateEditDraft({ ...base, name: "ab" }, moneyPool)).toMatch(/nombre/);
    expect(validateEditDraft({ ...base, entryPriceCop: 1.5 }, moneyPool)).toMatch(/entrada/);
    expect(validateEditDraft({ ...base, houseCutPct: 101 }, moneyPool)).toMatch(/porcentaje/);
    expect(validateEditDraft({ ...base, potMode: "fijo", fixedPrizeCop: null }, moneyPool)).toMatch(/garantizado/);
    expect(validateEditDraft(base, moneyPool)).toBeNull();
  });

  it("with entries ignores the locked fields", () => {
    expect(validateEditDraft({ ...base, entryPriceCop: -1 }, { ...moneyPool, hasEntries: true })).toBeNull();
  });
});

describe("removeMatchBlock", () => {
  it("never allows removing a match with picks or the last match", () => {
    expect(removeMatchBlock({ picks: 1 }, 5)).toMatch(/1 pronóstico/);
    expect(removeMatchBlock({ picks: 3 }, 5)).toMatch(/3 pronósticos/);
    expect(removeMatchBlock({ picks: 0 }, 1)).toMatch(/al menos un partido/);
    expect(removeMatchBlock({ picks: 0 }, 2)).toBeNull();
  });
});

describe("editorErrorMessage", () => {
  it("maps the SQL block detail to its message", () => {
    expect(editorErrorMessage({ message: "POLLA_NOT_EDITABLE", details: "CLOSED" })).toBe("Esta polla ya cerró; no se puede editar.");
    expect(editorErrorMessage({ message: "POLLA_NOT_EDITABLE", details: "DRAW" })).toMatch(/desempate/);
    expect(editorErrorMessage({ message: "POLLA_NOT_EDITABLE", details: null })).toMatch(/ya cerró/);
  });

  it("maps editor codes and leaves the rest to the general Casa map", () => {
    expect(editorErrorMessage({ message: "MATCH_HAS_PICKS" })).toMatch(/pronósticos/);
    expect(editorErrorMessage({ message: "MATCH_TOO_SOON" })).toMatch(/5 minutos/);
    expect(editorErrorMessage({ message: "ADMIN_REQUIRED" })).toBeNull();
  });
});
