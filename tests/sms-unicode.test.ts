import { describe, expect, it } from "vitest";
import { necesitaUnicode } from "@/lib/sms/labsmobile";

describe("necesitaUnicode", () => {
  it("no activa Unicode para texto GSM-7", () => {
    expect(necesitaUnicode("Tu codigo es 123456 para La Polla.")).toBe(false);
    expect(necesitaUnicode("Entrada: $20.000 - ¿listo? ñ é")).toBe(false);
  });

  it("activa Unicode con emoji o tildes fuera de GSM-7", () => {
    expect(necesitaUnicode("Tu código es 123456 para La Polla Colombiana 🐥")).toBe(true);
    expect(necesitaUnicode("La Polla 🐥")).toBe(true);
    expect(necesitaUnicode("código")).toBe(true);
  });
});
