// tests/sms-tope-alerta.test.ts — El aviso de "alguien agotó sus códigos de la
// hora" se manda UNA vez por número y por hora, y nunca tumba el login.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  from: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mocks.from }),
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mocks.send };
  },
}));

import {
  avisarTopeSmsPorHora,
  dedupeKeyTopeHora,
} from "@/lib/auth/sms-tope-alerta";

const AVISO = { phone: "573001112233", maxPorHora: 10, ip: "1.2.3.4" };

describe("aviso de tope de códigos por hora", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockReturnValue({ insert: mocks.insert });
    mocks.insert.mockResolvedValue({ error: null });
    mocks.send.mockResolvedValue({ error: null });
    process.env.RESEND_API_KEY = "re_test";
    process.env.FEEDBACK_NOTIFY_EMAIL = "admin@example.com";
  });

  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.FEEDBACK_NOTIFY_EMAIL;
  });

  it("registra la alerta y manda el correo con el número completo", async () => {
    const avisado = await avisarTopeSmsPorHora(AVISO);

    expect(avisado).toBe(true);
    expect(mocks.from).toHaveBeenCalledWith("admin_alerts");
    const fila = mocks.insert.mock.calls[0][0];
    expect(fila.kind).toBe("sms_rate_limit");
    expect(fila.dedupe_key.startsWith("sms_tope_hora:573001112233:")).toBe(true);
    expect(fila.title).toContain("10");

    expect(mocks.send).toHaveBeenCalledTimes(1);
    const correo = mocks.send.mock.calls[0][0];
    expect(correo.to).toBe("admin@example.com");
    expect(correo.subject).toContain("+573001112233");
    expect(correo.html).toContain("1.2.3.4");
  });

  it("no manda un segundo correo cuando ya se avisó por esa hora", async () => {
    // 23505 = unique_violation del índice de dedupe_key.
    mocks.insert.mockResolvedValue({ error: { code: "23505", message: "dup" } });

    const avisado = await avisarTopeSmsPorHora(AVISO);

    expect(avisado).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("la clave de dedupe cambia de hora en hora y no mezcla números", () => {
    const a = new Date("2026-09-19T14:05:00Z");
    const b = new Date("2026-09-19T14:59:59Z");
    const c = new Date("2026-09-19T15:00:00Z");

    expect(dedupeKeyTopeHora("573001112233", a)).toBe(
      dedupeKeyTopeHora("573001112233", b),
    );
    expect(dedupeKeyTopeHora("573001112233", a)).not.toBe(
      dedupeKeyTopeHora("573001112233", c),
    );
    expect(dedupeKeyTopeHora("573001112233", a)).not.toBe(
      dedupeKeyTopeHora("573009998877", a),
    );
  });

  it("si Supabase explota, no lanza y no manda correo", async () => {
    mocks.from.mockImplementation(() => {
      throw new Error("supabase caído");
    });

    await expect(avisarTopeSmsPorHora(AVISO)).resolves.toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("si Resend falla, el aviso no propaga el error", async () => {
    mocks.send.mockRejectedValue(new Error("resend caído"));

    await expect(avisarTopeSmsPorHora(AVISO)).resolves.toBe(true);
  });
});
