import { describe, expect, it } from "vitest";
import { pollaEndedLabel, pollaStatusLabel, type CasaPolla } from "@/lib/casa/types";

// (2026-09-18) En Pollas cerradas se leían varias «Resuelta» seguidas, sin
// pista de cuándo fue cada una. Ahora la tarjeta dice TERMINADA y, donde una
// polla abierta dice «Cierra en …», la terminada dice cuándo terminó.
const polla = (extra: Partial<CasaPolla>) => ({
  status: "resuelta",
  settled_at: "2026-09-17T06:19:58Z",   // 17-sep 01:19 en Colombia
  closes_at: "2026-09-16T16:55:00Z",
  opens_at: "2026-09-10T00:00:00Z",
  publication_mode: "publica",
  draw_pending: false,
  ...extra,
}) as CasaPolla;

describe("estado de una polla terminada", () => {
  it("la cinta dice Terminada, sin fecha: la fecha va en su propio renglón", () => {
    expect(pollaStatusLabel(polla({})).text).toBe("Terminada");
    expect(pollaStatusLabel(polla({})).tone).toBe("mute");
  });

  it("da la fecha del reparto en hora de Colombia", () => {
    expect(pollaEndedLabel(polla({}))).toBe("Terminó el 17 sep 2026");
  });

  it("sin reparto registrado cae al cierre de inscripciones", () => {
    expect(pollaEndedLabel(polla({ settled_at: null }))).toBe("Terminó el 16 sep 2026");
  });

  it("no habla de terminada mientras la polla siga viva", () => {
    expect(pollaEndedLabel(polla({ status: "abierta" }))).toBeNull();
    expect(pollaEndedLabel(polla({ status: "cerrada" }))).toBeNull();
    expect(pollaEndedLabel(polla({ status: "anulada" }))).toBeNull();
    expect(pollaStatusLabel(polla({ status: "anulada" })).text).toBe("Anulada");
  });
});
