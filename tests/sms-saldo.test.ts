import { describe, expect, it } from "vitest";
import { CREDITOS_POR_SMS_CO, resumirSaldo } from "@/lib/sms/saldo";

describe("resumirSaldo", () => {
  it("convierte créditos a SMS a Colombia", () => {
    const r = resumirSaldo(200.08, 0, 7);
    expect(r.smsEstimados).toBe(Math.floor(200.08 / CREDITOS_POR_SMS_CO));
    expect(r.smsEstimados).toBe(4648);
    expect(r.promedioDiario).toBeNull();
    expect(r.diasRestantes).toBeNull();
    expect(r.nivel).toBe("ok");
  });

  it("calcula los días que alcanza al ritmo actual", () => {
    // 4648 SMS, 70 envíos en 7 días = 10/día → 464 días.
    const r = resumirSaldo(200.08, 70, 7);
    expect(r.promedioDiario).toBe(10);
    expect(r.diasRestantes).toBe(464);
    expect(r.nivel).toBe("ok");
  });

  it("avisa en ámbar con pocos SMS aunque no haya consumo", () => {
    expect(resumirSaldo(500 * CREDITOS_POR_SMS_CO, 0, 7).nivel).toBe("bajo");
  });

  it("avisa en ámbar cuando el saldo dura menos de 10 días", () => {
    // 4648 SMS a 700/día = 6 días.
    expect(resumirSaldo(200.08, 4900, 7).nivel).toBe("bajo");
  });

  it("se pone en rojo con menos de 150 SMS o menos de 3 días", () => {
    expect(resumirSaldo(100 * CREDITOS_POR_SMS_CO, 0, 7).nivel).toBe("critico");
    // 4648 SMS a 2000/día = 2 días.
    expect(resumirSaldo(200.08, 14000, 7).nivel).toBe("critico");
  });

  it("trata saldos inválidos o negativos como cero", () => {
    expect(resumirSaldo(Number.NaN, 5, 7)).toMatchObject({ creditos: 0, smsEstimados: 0, nivel: "critico" });
    expect(resumirSaldo(-3, 0, 7).smsEstimados).toBe(0);
  });
});
