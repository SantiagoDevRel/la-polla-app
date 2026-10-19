import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { maxEntriesPerUser } from "@/lib/casa/types";
import { buildEditChanges, validateEditDraft, type EditableFields } from "@/lib/casa/editor";
import { pollaPrizeMedia } from "@/components/casa/prize-media";

/**
 * (2026-10-19) POLLA REGALO 2 quedó guardada con «10 cupos por persona» aunque
 * la entrada es gratis. SQL ya daba un solo cupo (migración 143), pero el
 * formulario mostraba 10. Pedido del dueño: con entrada gratis, siempre 1.
 */
describe("entrada gratis: un cupo por persona", () => {
  it("una polla gratis tiene un cupo, diga lo que diga la columna", () => {
    expect(maxEntriesPerUser({ kind: "partidos", entry_price_cop: 0, max_entries_per_user: 10 })).toBe(1);
    expect(maxEntriesPerUser({ kind: "manual", entry_price_cop: 0 })).toBe(1);
  });

  it("una polla con entrada conserva su tope", () => {
    expect(maxEntriesPerUser({ kind: "partidos", entry_price_cop: 20_000, max_entries_per_user: 4 })).toBe(4);
    expect(maxEntriesPerUser({ kind: "partidos", entry_price_cop: 20_000 })).toBe(10);
  });

  const draft: EditableFields = {
    name: "POLLA REGALO 2", description: "", scoringMode: "1x2", entryPriceCop: 0, houseCutPct: 100,
    potMode: "proporcional", fixedPrizeCop: null, prizeObject: "2 BOLETAS DE SUR O NORTE",
    payoutMethod: "", payoutAccount: "", payoutAccountName: "", maxEntriesPerUser: 10, referralOn: false,
  };
  const options = { hasEntries: false, kind: "partidos" as const, prizeKind: "objeto" as const };

  it("el editor no envía un tope de cupos para una polla gratis", () => {
    const changes = buildEditChanges(draft, { ...draft, maxEntriesPerUser: 7 }, options);
    expect(changes).not.toHaveProperty("maxEntriesPerUser");
    expect(validateEditDraft({ ...draft, maxEntriesPerUser: 0 }, options)).toBeNull();
  });

  it("al pasar a gratis tampoco arrastra el tope anterior", () => {
    const paid = { ...draft, entryPriceCop: 20_000 };
    const changes = buildEditChanges(paid, { ...paid, entryPriceCop: 0, maxEntriesPerUser: 3 }, options);
    expect(changes).toEqual({ entryPriceCop: 0 });
  });

  it("con entrada el tope se sigue editando", () => {
    const paid = { ...draft, entryPriceCop: 20_000 };
    expect(buildEditChanges(paid, { ...paid, maxEntriesPerUser: 3 }, options)).toEqual({ maxEntriesPerUser: 3 });
  });
});

describe("premios con imagen propia", () => {
  const exists = (src: string) => fs.existsSync(path.join(process.cwd(), "public", src));

  it("OFIGOLAZO 5 lleva los billetes de cien mil, como OFIGOLAZO4", () => {
    const previous = pollaPrizeMedia("05f83cb8-d16d-42fd-a6b8-a0840c9b0cf9");
    const ofigolazo5 = pollaPrizeMedia("6e9bea55-fdc0-4ba1-b703-9f947c2bb3c1");
    expect(ofigolazo5?.kind).toBe("cash");
    expect(ofigolazo5).toEqual(previous);
  });

  it("POLLA REGALO 2 muestra los escudos de Nacional y Medellín, quietos", () => {
    const prize = pollaPrizeMedia("67b3f25f-f94b-4319-9081-517c206d8241");
    expect(prize?.kind).toBe("crests");
    if (prize?.kind !== "crests") return;
    expect(prize.crests.map((crest) => crest.alt)).toEqual(["Escudo de Atlético Nacional", "Escudo de Independiente Medellín"]);
    for (const crest of prize.crests) expect(exists(crest.src)).toBe(true);
  });

  it("las demás pollas no inventan imagen", () => {
    expect(pollaPrizeMedia("00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});
