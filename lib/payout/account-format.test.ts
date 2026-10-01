import { describe, expect, it } from "vitest";
import {
  joinOtherBank,
  onlyDigits,
  payoutAccountError,
  sanitizeBankAccount,
  sanitizeBankName,
  sanitizeLlave,
  splitOtherBank,
} from "./account-format";

describe("payout account format", () => {
  it("nequi y bancolombia solo aceptan números", () => {
    expect(onlyDigits("311 314-7831")).toBe("3113147831");
    expect(payoutAccountError("nequi", "3113147831")).toBeNull();
    expect(payoutAccountError("nequi", "31131478")).not.toBeNull();
    expect(payoutAccountError("bancolombia", "12345678901")).toBeNull();
    expect(payoutAccountError("bancolombia", "1234-5678")).not.toBeNull();
  });

  it("llave acepta letras, números y @", () => {
    expect(sanitizeLlave("@Juan.123 ñ!")).toBe("@Juan123ñ");
    expect(payoutAccountError("llave", "@juan123")).toBeNull();
    expect(payoutAccountError("llave", "juan@123")).toBeNull();
    expect(payoutAccountError("llave", "@juan-123")).not.toBeNull();
  });

  it("otro guarda banco y cuenta juntos y los separa al editar", () => {
    expect(sanitizeBankName("Banco de Bogotá!!")).toBe("Banco de Bogotá");
    expect(sanitizeBankAccount("0011-22 ab")).toBe("001122ab");
    const stored = joinOtherBank("Davivienda", "0011223344");
    expect(stored).toBe("Davivienda · 0011223344");
    expect(splitOtherBank(stored)).toEqual({ bank: "Davivienda", account: "0011223344" });
    expect(payoutAccountError("otro", stored)).toBeNull();
    expect(payoutAccountError("otro", joinOtherBank("", "0011223344"))).not.toBeNull();
    expect(payoutAccountError("otro", "Davivienda 0011")).not.toBeNull();
  });

  it("un «otro» viejo sin separador queda entero en la cuenta", () => {
    expect(splitOtherBank("Davivienda 0011")).toEqual({ bank: "", account: "Davivienda 0011" });
  });
});
