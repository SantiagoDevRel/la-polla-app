import { describe, expect, it } from "vitest";
import { textoCompartir } from "@/lib/casa/share-text";

const fmt = (n: number) => `$${n.toLocaleString("es-CO")}`;

describe("textoCompartir", () => {
  it("pozo fijo anuncia entrada y premio", () => {
    expect(textoCompartir({ nombre: "OFIGOLAZO", entradaCop: 20000, premio: { cop: 1000000 } }))
      .toBe(`Únete a OFIGOLAZO en La Polla Colombiana.\nEntrada: ${fmt(20000)} · Premio: ${fmt(1000000)}`);
  });

  it("pozo proporcional solo anuncia la entrada", () => {
    expect(textoCompartir({ nombre: "X", entradaCop: 20000, premio: null }))
      .toBe(`Únete a X en La Polla Colombiana.\nEntrada: ${fmt(20000)}`);
  });

  it("premio objeto usa su nombre", () => {
    expect(textoCompartir({ nombre: "X", entradaCop: 10000, premio: { objeto: "Camiseta oficial" } }))
      .toContain("· Premio: Camiseta oficial");
  });

  it("Chicken Picks en inglés", () => {
    expect(textoCompartir({ nombre: "X", entradaCop: 20000, premio: { cop: 1000000 }, english: true }))
      .toBe(`Join X on Chicken Picks.\nEntry: ${fmt(20000)} COP · Prize: ${fmt(1000000)} COP`);
  });
});
