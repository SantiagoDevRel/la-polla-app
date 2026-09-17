// tests/casa-issue-notifications.test.ts — correo por cada caso nuevo de
// /admin/issues (migración 121), resultado manual de un caso «sin datos» y el
// enganche del barrido en el cron de cada minuto.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  createAdminClient: vi.fn(),
  verifyPendingFinals: vi.fn(),
  syncApiFootballLive: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("resend", () => ({ Resend: class { emails = { send: mocks.send }; } }));
vi.mock("@/lib/auth/admin", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/matches/verify-final", () => ({ verifyPendingFinals: mocks.verifyPendingFinals }));
vi.mock("@/lib/api-football/live", () => ({ syncApiFootballLive: mocks.syncApiFootballLive }));

import {
  buildMatchIssueEmail,
  ISSUES_URL,
  notifyMatchIssues,
  type MatchIssueNotificationClaim,
} from "@/lib/casa/match-issue-notifications";
import { casaIssueRecipients, emailErrorCode, sendCasaIssueEmail } from "@/lib/email/casa-issues";
import { describeMatchIssue, formatIssueKickoff } from "@/lib/casa/match-issue-kinds";
import { describeDecision } from "@/lib/casa/match-issues";
import { casaErrorMessage } from "@/lib/casa/operations";
import { POST as resultPOST } from "@/app/api/casa/admin/match-issues/[id]/resultado/route";
import { POST as syncLivePOST } from "@/app/api/matches/sync-live/route";

const issueId = "00000000-0000-4000-8000-0000000000a1";
const adminId = "00000000-0000-4000-8000-0000000000d1";

function claim(overrides: Partial<MatchIssueNotificationClaim> = {}): MatchIssueNotificationClaim {
  return {
    issue_id: issueId,
    claim_token: "00000000-0000-4000-8000-0000000000e1",
    kind: "sin_datos",
    observed_elapsed: null,
    first_seen_at: "2026-09-14T20:31:00Z",
    match_id: "00000000-0000-4000-8000-0000000000b1",
    home_team: "Millonarios",
    away_team: "Nacional",
    tournament: "betplay_2026",
    scheduled_at: "2026-09-14T20:00:00Z",
    scheduled_at_confirmed: true,
    polla_names: ["Clásico del domingo", "Fecha 10"],
    ...overrides,
  };
}

describe("textos de los casos", () => {
  it("nombra el caso sin datos y la decisión resuelto", () => {
    expect(describeMatchIssue("sin_datos", null)).toBe("Marcador demorado: 30 minutos después del inicio aún no llegaban datos del partido");
    expect(describeDecision("resuelto")).toBe("Caso cerrado");
  });

  it("muestra la hora de Colombia o solo la fecha si la hora es provisional", () => {
    expect(formatIssueKickoff("2026-09-14T20:00:00Z", true)).toMatch(/14 de septiembre.*3:00.*p.*m.*\(hora de Colombia\)$/);
    // Medianoche UTC provisional: la fecha no se corre al día anterior.
    expect(formatIssueKickoff("2026-09-20T00:00:00Z", false)).toMatch(/20 de septiembre, hora por confirmar$/);
  });
});

describe("buildMatchIssueEmail", () => {
  it("arma asunto y cuerpo en español neutro con pollas, hora de Colombia y enlace", () => {
    const { subject, text } = buildMatchIssueEmail(claim());
    expect(subject).toBe("Issue en La Polla: Millonarios vs Nacional (Marcador demorado)");
    expect(text).toContain("Partido: Millonarios vs Nacional");
    expect(text).toContain("Tipo: Marcador demorado");
    expect(text).toMatch(/Inicio: .*14 de septiembre.*3:00.*\(hora de Colombia\)/);
    expect(text).toContain("Pollas afectadas (2):\n- Clásico del domingo\n- Fecha 10");
    expect(text).toContain("resultado de los 90 minutos");
    expect(text).toContain(`Revísalo en: ${ISSUES_URL}`);
    expect(ISSUES_URL).toBe("https://lapollacolombiana.com/admin/issues");
    expect(text).not.toMatch(/parce|vos |pantallazo/i);
  });

  it("describe una suspensión con su minuto y sin pollas activas", () => {
    const { subject, text } = buildMatchIssueEmail(claim({ kind: "suspendido", observed_elapsed: 34, polla_names: [] }));
    expect(subject).toBe("Issue en La Polla: Millonarios vs Nacional (Suspendido)");
    expect(text).toContain("Qué pasó: Suspendido en el minuto 34");
    expect(text).toContain("Pollas afectadas: ninguna polla activa en este momento.");
    expect(text).toContain("se anula (0 puntos para todos) o se mantiene");
  });

  it("no deja saltos de línea de los nombres en el asunto", () => {
    const { subject } = buildMatchIssueEmail(claim({ home_team: "Equipo\r\nBcc: x@y.com", away_team: null }));
    expect(subject).toBe("Issue en La Polla: Equipo Bcc: x@y.com vs Equipo visitante (Marcador demorado)");
    expect(subject).not.toMatch(/[\r\n]/);
  });
});

describe("configuración y errores de Resend", () => {
  it("usa CASA_ISSUES_NOTIFY_EMAIL y cae a ADMIN_ALERT_EMAIL o FEEDBACK_NOTIFY_EMAIL", () => {
    expect(casaIssueRecipients({ CASA_ISSUES_NOTIFY_EMAIL: "a@x.co, b@x.co", FEEDBACK_NOTIFY_EMAIL: "f@x.co" })).toEqual(["a@x.co", "b@x.co"]);
    expect(casaIssueRecipients({ ADMIN_ALERT_EMAIL: "admin@x.co", FEEDBACK_NOTIFY_EMAIL: "f@x.co" })).toEqual(["admin@x.co"]);
    expect(casaIssueRecipients({ CASA_ISSUES_NOTIFY_EMAIL: " ", FEEDBACK_NOTIFY_EMAIL: "f@x.co" })).toEqual(["f@x.co"]);
    expect(casaIssueRecipients({})).toEqual([]);
  });

  it("convierte el error en un código válido para la base", () => {
    expect(emailErrorCode("rate_limit_exceeded", 429)).toBe("rate_limit_exceeded_429");
    expect(emailErrorCode("Invalid From Address!", null)).toBe("invalid_from_address");
    expect(emailErrorCode("x".repeat(100), 422)).toMatch(/^[a-z0-9_.:-]{1,64}$/);
  });

  const ENV = ["RESEND_API_KEY", "RESEND_FROM_EMAIL"] as const;
  const saved = Object.fromEntries(ENV.map((key) => [key, process.env[key]]));
  afterEach(() => {
    for (const key of ENV) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("devuelve ok solo cuando Resend confirma, y un código sin mensaje del proveedor si rechaza", async () => {
    process.env.RESEND_API_KEY = "re_test_dummy";
    mocks.send.mockResolvedValueOnce({ data: { id: "1" }, error: null });
    expect(await sendCasaIssueEmail({ to: ["a@x.co"], subject: "s", text: "t" })).toEqual({ ok: true });
    mocks.send.mockResolvedValueOnce({ data: null, error: { name: "validation_error", statusCode: 403, message: "a@x.co is not allowed" } });
    const rejected = await sendCasaIssueEmail({ to: ["a@x.co"], subject: "s", text: "t" });
    expect(rejected).toEqual({ ok: false, errorCode: "validation_error_403" });
    mocks.send.mockRejectedValueOnce(new Error("network a@x.co"));
    expect(await sendCasaIssueEmail({ to: ["a@x.co"], subject: "s", text: "t" })).toEqual({ ok: false, errorCode: "exception" });
    delete process.env.RESEND_API_KEY;
    expect(await sendCasaIssueEmail({ to: ["a@x.co"], subject: "s", text: "t" })).toEqual({ ok: false, errorCode: "missing_resend_api_key" });
  });
});

describe("notifyMatchIssues", () => {
  function fakeDb(claims: MatchIssueNotificationClaim[] | { error: { code: string } }) {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const db = {
      rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        if (fn === "casa_claim_match_issue_notifications") {
          return Array.isArray(claims) ? { data: claims, error: null } : { data: null, error: claims.error };
        }
        return { data: true, error: null };
      }),
    };
    return { db, calls };
  }
  const noSleep = async () => {};

  it("sin configuración no reserva casos", async () => {
    const { db, calls } = fakeDb([claim()]);
    const send = vi.fn();
    expect(await notifyMatchIssues({ db: db as never, send, recipients: [], configured: true, deadline: Date.now() + 10_000, sleep: noSleep }))
      .toMatchObject({ skipped: "not_configured", claimed: 0 });
    expect(await notifyMatchIssues({ db: db as never, send, recipients: ["a@x.co"], configured: false, deadline: Date.now() + 10_000, sleep: noSleep }))
      .toMatchObject({ skipped: "not_configured" });
    expect(calls).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it("envía un correo por caso y cierra cada reserva con su token: enviada o fallida", async () => {
    const second = claim({ issue_id: "00000000-0000-4000-8000-0000000000a2", claim_token: "00000000-0000-4000-8000-0000000000e2", kind: "aplazado" });
    const { db, calls } = fakeDb([claim(), second]);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, errorCode: "rate_limit_exceeded_429" });
    const result = await notifyMatchIssues({ db: db as never, send, recipients: ["a@x.co"], configured: true, deadline: Date.now() + 10_000, sleep: noSleep });

    expect(result).toEqual({ claimed: 2, sent: 1, failed: 1, released: 0 });
    expect(calls[0]).toEqual({ fn: "casa_claim_match_issue_notifications", args: { p_limit: 10 } });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toMatchObject({ to: ["a@x.co"], subject: "Issue en La Polla: Millonarios vs Nacional (Marcador demorado)" });
    expect(send.mock.calls[1][0].subject).toContain("(Aplazado)");
    expect(calls.slice(1)).toEqual([
      { fn: "casa_finish_match_issue_notification", args: { p_issue: issueId, p_claim_token: claim().claim_token, p_outcome: "sent", p_error: null } },
      { fn: "casa_finish_match_issue_notification", args: { p_issue: second.issue_id, p_claim_token: second.claim_token, p_outcome: "failed", p_error: "rate_limit_exceeded_429" } },
    ]);
    expect(logged.mock.calls.flat().join(" ")).not.toContain("a@x.co");
    logged.mockRestore();
  });

  it("libera las reservas que ya no alcanza a enviar antes del límite de tiempo", async () => {
    const second = claim({ issue_id: "00000000-0000-4000-8000-0000000000a2", claim_token: "00000000-0000-4000-8000-0000000000e2" });
    const { db, calls } = fakeDb([claim(), second]);
    let clock = 1_000;
    const send = vi.fn(async () => { clock = 5_000; return { ok: true as const }; });
    const result = await notifyMatchIssues({ db: db as never, send, recipients: ["a@x.co"], configured: true, deadline: 4_000, now: () => clock, sleep: noSleep });
    expect(result).toEqual({ claimed: 2, sent: 1, failed: 0, released: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(calls.at(-1)).toEqual({ fn: "casa_finish_match_issue_notification", args: { p_issue: second.issue_id, p_claim_token: second.claim_token, p_outcome: "released", p_error: null } });
  });

  it("si la reserva falla no envía nada", async () => {
    const { db } = fakeDb({ error: { code: "42501" } });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn();
    expect(await notifyMatchIssues({ db: db as never, send, recipients: ["a@x.co"], configured: true, deadline: Date.now() + 10_000, sleep: noSleep }))
      .toMatchObject({ skipped: "claim_failed", sent: 0 });
    expect(send).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("POST /api/casa/admin/match-issues/[id]/resultado", () => {
  const rpc = vi.fn();
  function request(body: unknown, headers: Record<string, string> = { "Content-Type": "application/json", "X-Casa-Contract": "2" }) {
    return new NextRequest(`http://localhost/api/casa/admin/match-issues/${issueId}/resultado`, {
      method: "POST", headers, body: JSON.stringify(body),
    });
  }
  const context = (id = issueId) => ({ params: Promise.resolve({ id }) });

  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockReset();
    mocks.getAuthenticatedUser.mockResolvedValue({ id: adminId, is_admin: true });
    mocks.createAdminClient.mockReturnValue({ rpc });
  });

  it("valida sesión y rol antes de tocar la base", async () => {
    mocks.getAuthenticatedUser.mockResolvedValueOnce(null);
    expect((await resultPOST(request({ home: 1, away: 0 }), context())).status).toBe(401);
    mocks.getAuthenticatedUser.mockResolvedValueOnce({ id: adminId, is_admin: false });
    expect((await resultPOST(request({ home: 1, away: 0 }), context())).status).toBe(403);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it.each([
    [{ home: -1, away: 0 }],
    [{ home: 1.5, away: 0 }],
    [{ home: 100, away: 0 }],
    [{ home: "2", away: 0 }],
    [{ home: 1 }],
    [{ home: 1, away: 0, decision: "anular" }],
  ])("rechaza marcadores inválidos %j sin llamar al RPC", async (body) => {
    expect((await resultPOST(request(body), context())).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rechaza un id inválido y exige el contrato de Casa", async () => {
    expect((await resultPOST(request({ home: 1, away: 0 }), context("nope"))).status).toBe(400);
    expect((await resultPOST(request({ home: 1, away: 0 }, { "Content-Type": "application/json" }), context())).status).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("llama al RPC con el administrador de la sesión", async () => {
    rpc.mockResolvedValue({ data: { issue_id: issueId, decision: "resuelto", home: 2, away: 1 }, error: null });
    const response = await resultPOST(request({ home: 2, away: 1 }), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, decision: "resuelto" });
    expect(rpc).toHaveBeenCalledWith("casa_resolve_sin_datos_with_result", { p_issue: issueId, p_home: 2, p_away: 1, p_admin: adminId });
  });

  it.each(["MATCH_ALREADY_VERIFIED", "ISSUE_RESULT_NOT_ALLOWED", "ISSUE_ALREADY_DECIDED"])("responde 409 con mensaje claro para %s", async (message) => {
    rpc.mockResolvedValue({ data: null, error: { code: "55000", message } });
    const response = await resultPOST(request({ home: 2, away: 1 }), context());
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe(message);
    expect(body.error).toBe(casaErrorMessage({ message }));
    expect(body.error).not.toBe("No se pudo completar la operación. Actualiza los datos e intenta de nuevo.");
  });
});

describe("sync-live barre los casos y envía avisos cada minuto", () => {
  const ENV = ["CRON_SECRET", "RESEND_API_KEY", "CASA_ISSUES_NOTIFY_EMAIL", "ADMIN_ALERT_EMAIL", "FEEDBACK_NOTIFY_EMAIL"] as const;
  const saved = Object.fromEntries(ENV.map((key) => [key, process.env[key]]));
  afterEach(() => {
    for (const key of ENV) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("corre el barrido aunque no haya partidos en vivo, sin gastar intentos si falta Resend", async () => {
    process.env.CRON_SECRET = "cron-secret-test";
    delete process.env.RESEND_API_KEY;
    for (const key of ["CASA_ISSUES_NOTIFY_EMAIL", "ADMIN_ALERT_EMAIL", "FEEDBACK_NOTIFY_EMAIL"] as const) delete process.env[key];
    const rpcCalls: string[] = [];
    const client = {
      from: () => ({ select: () => ({ or: async () => ({ count: 0, error: null }) }) }),
      rpc: vi.fn(async (fn: string) => { rpcCalls.push(fn); return { data: 2, error: null }; }),
    };
    mocks.createAdminClient.mockReturnValue(client);
    mocks.verifyPendingFinals.mockResolvedValue({ checked: 0 });
    const response = await syncLivePOST(new NextRequest("http://localhost/api/matches/sync-live", {
      method: "POST", headers: { "x-cron-secret": "cron-secret-test" },
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.skipped).toBe(true);
    expect(mocks.syncApiFootballLive).not.toHaveBeenCalled();
    expect(rpcCalls).toEqual(["casa_sweep_match_issues"]);
    expect(body.matchIssues).toEqual({ opened: 2, email: { skipped: "not_configured", claimed: 0, sent: 0, failed: 0, released: 0 } });
  });
});
