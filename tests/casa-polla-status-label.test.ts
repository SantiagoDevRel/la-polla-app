import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollaEndedLabel, pollaStatusLabel, type CasaPolla } from "@/lib/casa/types";

// (2026-09-18) En Pollas cerradas se leían varias «Resuelta» seguidas, sin
// pista de cuándo fue cada una. Ese mismo día el dueño pidió menos cosas en
// pantalla: la fecha va DENTRO de la cinta («Terminó 17 sep») y no en un
// renglón aparte, y los estados hablan en idioma de jugador — «Cerrada» sonaba
// a candado y no decía si la polla seguía viva.
const polla = (extra: Partial<CasaPolla>) => ({
  status: "resuelta",
  settled_at: "2026-09-17T06:19:58Z",   // 17-sep 01:19 en Colombia
  closes_at: "2026-09-16T16:55:00Z",
  opens_at: "2026-09-10T00:00:00Z",
  publication_mode: "publica",
  draw_pending: false,
  ...extra,
}) as CasaPolla;

describe("estado de una polla, en idioma de jugador", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-18T17:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("la cinta dice cuándo terminó, una sola vez", () => {
    expect(pollaStatusLabel(polla({})).text).toBe("Terminó 17 sep");
    expect(pollaStatusLabel(polla({})).tone).toBe("mute");
  });

  it("el año solo aparece cuando no es el actual", () => {
    vi.setSystemTime(new Date("2027-01-05T17:00:00Z"));
    expect(pollaStatusLabel(polla({})).text).toBe("Terminó 17 sep 2026");
  });

  it("sin reparto registrado, la cinta cae al cierre de inscripciones", () => {
    expect(pollaStatusLabel(polla({ settled_at: null })).text).toBe("Terminó 16 sep");
  });

  it("nunca dice Cerrada, Cerrando ni Resuelta", () => {
    // Inscripciones cerradas por estado, o porque ya pasó la hora: se está jugando.
    expect(pollaStatusLabel(polla({ status: "cerrada" })).text).toBe("En juego");
    expect(pollaStatusLabel(polla({ status: "abierta" })).text).toBe("En juego");
    const textos = [polla({}), polla({ status: "cerrada" }), polla({ status: "abierta" })].map((p) => pollaStatusLabel(p).text);
    for (const texto of textos) expect(texto).not.toMatch(/Cerrad|Cerrando|Resuelta/);
  });

  it("abierta va en verde: el dorado es del premio", () => {
    const abierta = pollaStatusLabel(polla({ status: "abierta", closes_at: "2026-09-20T16:55:00Z" }));
    expect(abierta).toEqual({ text: "Abierta", tone: "live" });
  });

  it("la fecha larga sigue disponible para la vista pública y el bot", () => {
    expect(pollaEndedLabel(polla({}))).toBe("Terminó el 17 sep 2026");
    expect(pollaEndedLabel(polla({ settled_at: null }))).toBe("Terminó el 16 sep 2026");
  });

  it("no habla de terminada mientras la polla siga viva", () => {
    expect(pollaEndedLabel(polla({ status: "abierta" }))).toBeNull();
    expect(pollaEndedLabel(polla({ status: "cerrada" }))).toBeNull();
    expect(pollaEndedLabel(polla({ status: "anulada" }))).toBeNull();
    expect(pollaStatusLabel(polla({ status: "anulada" })).text).toBe("Anulada");
  });
});
