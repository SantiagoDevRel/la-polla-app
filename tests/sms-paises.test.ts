import { afterEach, describe, expect, it, vi } from "vitest";
import { PAISES_SMS, paisSmsPermitido } from "@/lib/sms/paises";
import { sendSms } from "@/lib/sms/labsmobile";

describe("paisSmsPermitido", () => {
  it("acepta los nueve países de la lista, con o sin +", () => {
    const muestras: Record<string, string> = {
      CO: "573001234567",
      US: "+12025550123",
      PA: "+50761234567",
      AR: "+5491123456789",
      PE: "+51912345678",
      CL: "+56912345678",
      BR: "+5511912345678",
      EC: "+593991234567",
      ES: "+34612345678",
    };
    expect(Object.keys(muestras).sort()).toEqual([...PAISES_SMS].sort());
    for (const [pais, tel] of Object.entries(muestras)) {
      expect(paisSmsPermitido(tel)).toBe(pais);
    }
  });

  it("rechaza Canadá y el Caribe aunque compartan el +1 con Estados Unidos", () => {
    expect(paisSmsPermitido("+14165550123")).toBeNull();
    expect(paisSmsPermitido("+18095550123")).toBeNull();
  });

  it("rechaza otros países y basura", () => {
    for (const tel of ["+584121234567", "+33612345678", "+61412345678", "+525512345678", "", "abc"]) {
      expect(paisSmsPermitido(tel)).toBeNull();
    }
  });
});

describe("sendSms", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("no llama a LabsMobile para un país fuera de la lista", async () => {
    vi.stubEnv("LABSMOBILE_USERNAME", "u@example.com");
    vi.stubEnv("LABSMOBILE_TOKEN", "t");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const r = await sendSms("584121234567", "hola");
    expect(r).toEqual({ ok: false, error: "pais_no_permitido" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
