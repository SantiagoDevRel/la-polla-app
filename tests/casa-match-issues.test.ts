import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/admin", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { POST } from "@/app/api/casa/admin/match-issues/[id]/route";
import { casaErrorMessage } from "@/lib/casa/operations";
import {
  classifyMatchIssueKind,
  countOpenMatchIssues,
  describeCurrentMatchState,
  describeDecision,
  describeMatchIssue,
  listMatchIssues,
} from "@/lib/casa/match-issues";

const issueId = "00000000-0000-4000-8000-0000000000a1";
const matchId = "00000000-0000-4000-8000-0000000000b1";
const pollaId = "00000000-0000-4000-8000-0000000000c1";
const adminId = "00000000-0000-4000-8000-0000000000d1";
const dbFetch = vi.fn<typeof fetch>();

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function request(body: unknown, headers: Record<string, string> = { "Content-Type": "application/json", "X-Casa-Contract": "2" }) {
  return new NextRequest(`http://localhost/api/casa/admin/match-issues/${issueId}`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function context(id = issueId) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getAuthenticatedUser.mockResolvedValue({ id: adminId, is_admin: true });
  mocks.createAdminClient.mockImplementation(() => createClient("http://localhost:54321", "test-only-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: dbFetch },
  }));
});

describe("POST /api/casa/admin/match-issues/[id]", () => {
  it("responde 401 sin sesión, antes de tocar la base", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    const result = await POST(request({ decision: "anular" }), context());
    expect(result.status).toBe(401);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(dbFetch).not.toHaveBeenCalled();
  });

  it("responde 403 a quien no es administrador, antes de tocar la base", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ id: adminId, is_admin: false });
    const result = await POST(request({ decision: "mantener" }), context());
    expect(result.status).toBe(403);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("exige el contrato Casa v2", async () => {
    const result = await POST(request({ decision: "anular" }, { "Content-Type": "application/json" }), context());
    expect(result.status).toBe(409);
    expect((await result.json()).code).toBe("UPDATE_REQUIRED");
    expect(dbFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["decisión desconocida", { decision: "borrar" }],
    ["sin decisión", {}],
    ["nota de más de 300 caracteres", { decision: "anular", note: "x".repeat(301) }],
    ["campos adicionales", { decision: "anular", p_admin: "otro" }],
    ["JSON inválido", "{no-json"],
  ])("responde 400 con %s", async (_label, body) => {
    const result = await POST(request(body), context());
    expect(result.status).toBe(400);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(dbFetch).not.toHaveBeenCalled();
  });

  it("responde 400 con un id que no es uuid", async () => {
    const result = await POST(request({ decision: "anular" }), context("no-es-uuid"));
    expect(result.status).toBe(400);
    expect(dbFetch).not.toHaveBeenCalled();
  });

  it("llama al RPC con el caso, la decisión, el administrador de la sesión y la nota", async () => {
    dbFetch.mockResolvedValueOnce(response({ issue_id: issueId, match_id: matchId, decision: "anular", voided_pollas: 2 }));
    const result = await POST(request({ decision: "anular", note: "  No se reanuda  " }), context());
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await result.json()).toEqual({ ok: true, issue_id: issueId, match_id: matchId, decision: "anular", voided_pollas: 2 });
    expect(dbFetch).toHaveBeenCalledTimes(1);
    const [url, init] = dbFetch.mock.calls[0];
    expect(new URL(String(url)).pathname).toBe("/rest/v1/rpc/casa_decide_match_issue");
    expect(JSON.parse(String(init?.body))).toEqual({ p_issue: issueId, p_decision: "anular", p_admin: adminId, p_note: "No se reanuda" });
  });

  it("manda p_note null cuando la nota está vacía", async () => {
    dbFetch.mockResolvedValueOnce(response({ issue_id: issueId, match_id: matchId, decision: "mantener", voided_pollas: 0 }));
    const result = await POST(request({ decision: "mantener", note: "   " }), context());
    expect(result.status).toBe(200);
    expect(JSON.parse(String(dbFetch.mock.calls[0][1]?.body))).toEqual({ p_issue: issueId, p_decision: "mantener", p_admin: adminId, p_note: null });
  });

  it.each([
    ["ISSUE_ALREADY_DECIDED", "Este caso ya fue decidido."],
    ["ISSUE_NOT_FOUND", "No encontramos ese caso."],
    ["OPERATIONS_PAUSED", "Estamos actualizando las inscripciones. Intenta de nuevo en unos minutos; si ya transferiste, no repitas el pago."],
  ])("traduce el error %s del RPC", async (code, message) => {
    dbFetch.mockResolvedValueOnce(response({ code: "P0001", message: code, details: null, hint: null }, 400));
    const result = await POST(request({ decision: "anular" }), context());
    expect(result.status).toBe(409);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await result.json()).toEqual({ error: message, code });
  });

  it("no expone detalles de un error desconocido", async () => {
    dbFetch.mockResolvedValueOnce(response({ code: "XX000", message: "private diagnostic" }, 500));
    const result = await POST(request({ decision: "anular" }), context());
    expect(result.status).toBe(500);
    const body = await result.json();
    expect(body.code).toBe("CASA_OPERATION_FAILED");
    expect(JSON.stringify(body)).not.toContain("private diagnostic");
  });
});

describe("mensajes del contrato de issues", () => {
  it.each([
    ["ISSUE_NOT_FOUND", "No encontramos ese caso."],
    ["ISSUE_ALREADY_DECIDED", "Este caso ya fue decidido."],
    ["INVALID_DECISION", "Elige anular o mantener el partido."],
    ["OPEN_MATCH_ISSUES", "Hay partidos con novedades sin decidir. Revísalos en Issues antes de repartir."],
  ])("%s", (message, text) => {
    expect(casaErrorMessage({ message })).toBe(text);
  });
});

describe("qué pasó con el partido", () => {
  it.each([
    ["suspendido", 60, "Suspendido en el minuto 60"],
    ["suspendido", null, "Suspendido"],
    ["suspendido", 0, "Suspendido"],
    ["abandonado", 75, "Abandonado en el minuto 75"],
    ["abandonado", undefined, "Abandonado"],
    ["aplazado", 0, "Aplazado"],
    ["aplazado", 30, "Aplazado"],
    ["cancelado", null, "Cancelado"],
    ["cancelado", 12, "Cancelado"],
  ] as const)("%s con minuto %s", (kind, elapsed, text) => {
    expect(describeMatchIssue(kind, elapsed)).toBe(text);
  });

  it("ignora minutos imposibles", () => {
    expect(describeMatchIssue("suspendido", -3)).toBe("Suspendido");
    expect(describeMatchIssue("suspendido", 12.5)).toBe("Suspendido");
    expect(describeMatchIssue("suspendido", 400)).toBe("Suspendido");
  });

  it.each([
    ["live", "STATUS_SUSPENDED", "suspendido"],
    ["live", " interrupted ", "suspendido"],
    ["live", "INT", "suspendido"],
    ["cancelled", "STATUS_POSTPONED", "aplazado"],
    ["scheduled", "PST", "aplazado"],
    ["cancelled", "ABD", "abandonado"],
    ["cancelled", "STATUS_CANCELED", "cancelado"],
    ["live", "CANC", "cancelado"],
    ["cancelled", null, "cancelado"],
    ["cancelled", "STATUS_FULL_TIME", "cancelado"],
    ["cancelled", "STATUS_SCHEDULED", null],
    ["live", "STATUS_SECOND_HALF", null],
    ["finished", null, null],
  ] as const)("clasifica status %s con detalle %s como %s", (status, detail, kind) => {
    expect(classifyMatchIssueKind(status, detail)).toBe(kind);
  });

  it("describe el estado actual y la decisión", () => {
    expect(describeCurrentMatchState({ status: "live", final_verified_at: null, live_status_detail: "STATUS_SUSPENDED" }, "suspendido")).toBe("Estado actual: sigue suspendido");
    expect(describeCurrentMatchState({ status: "cancelled", final_verified_at: null, live_status_detail: "ABD" }, "suspendido")).toBe("Estado actual: abandonado");
    expect(describeCurrentMatchState({ status: "live", final_verified_at: null, live_status_detail: "STATUS_SECOND_HALF" }, "suspendido")).toBe("Estado actual: en juego");
    expect(describeCurrentMatchState({ status: "scheduled", final_verified_at: null, live_status_detail: null }, "aplazado")).toBe("Estado actual: programado");
    expect(describeCurrentMatchState({ status: "live", final_verified_at: null })).toBe("Estado actual: en juego");
    expect(describeCurrentMatchState({ status: "finished", final_verified_at: null })).toBe("Estado actual: finalizado, falta verificar el resultado");
    expect(describeCurrentMatchState({ status: "finished", final_verified_at: "2026-09-13T20:00:00Z" })).toBe("Estado actual: finalizado, con resultado verificado");
    expect(describeCurrentMatchState({ status: "desconocido", final_verified_at: null })).toBeNull();
    expect(describeDecision("anular")).toBe("Anulado: 0 puntos para todos");
    expect(describeDecision("mantener")).toBe("Partido mantenido");
  });
});

describe("lectura server-side de issues", () => {
  const openIssue = {
    id: issueId, match_id: matchId, kind: "suspendido", observed_status: "live", observed_detail: "STATUS_SUSPENDED",
    observed_elapsed: 60, first_seen_at: "2026-09-13T20:00:00Z", last_seen_at: "2026-09-13T20:05:00Z",
    decision: null, decided_by: null, decided_at: null, note: null,
  };
  const decidedIssue = {
    ...openIssue, id: "00000000-0000-4000-8000-0000000000a2", kind: "aplazado", observed_elapsed: null,
    decision: "anular", decided_by: adminId, decided_at: "2026-09-13T21:00:00Z", note: "Sin fecha nueva",
  };

  function route(url: string, overrides: Partial<Record<string, () => Response>> = {}) {
    const parsed = new URL(url);
    const table = parsed.pathname.replace("/rest/v1/", "");
    const override = overrides[table];
    if (override) return override();
    if (table === "rpc/casa_sweep_match_issues") return response(0);
    if (table === "rpc/casa_active_open_match_issue_ids") return response([{ issue_id: issueId }]);
    if (table === "casa_match_issues") {
      return parsed.searchParams.get("decision") === "is.null" ? response([openIssue]) : response([decidedIssue]);
    }
    if (table === "matches") return response([{ id: matchId, home_team: "Millonarios", away_team: "Nacional", tournament: "betplay_2026", scheduled_at: "2026-09-13T19:00:00Z", status: "cancelled", live_status_detail: "STATUS_SUSPENDED", elapsed: 60, home_score: 1, away_score: 0, final_verified_at: null }]);
    if (table === "casa_polla_matches") return response([{ polla_id: pollaId, match_id: matchId, voided_at: null }]);
    if (table === "casa_pollas") return response([{ id: pollaId, name: "Clásico", slug: "clasico", status: "abierta", archived_at: null }]);
    if (table === "users") return response([{ id: adminId, display_name: "Admin" }]);
    return response({ message: "unexpected" }, 500);
  }

  it("lee abiertos y decididos con columnas enumeradas y lotes, sin una consulta por caso", async () => {
    dbFetch.mockImplementation(async (input) => route(String(input)));
    const result = await listMatchIssues();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.open).toHaveLength(1);
    expect(result.decided).toHaveLength(1);
    expect(result.open[0]).toMatchObject({
      id: issueId, summary: "Suspendido en el minuto 60", homeTeam: "Millonarios", awayTeam: "Nacional",
      score: "1 - 0", decision: null, currentState: "Estado actual: sigue suspendido",
      pollas: [{ id: pollaId, name: "Clásico", slug: "clasico", status: "abierta", linkable: true, voided: false }],
    });
    expect(result.decided[0]).toMatchObject({ summary: "Aplazado", decision: "anular", decidedByName: "Admin", note: "Sin fecha nueva" });

    const urls = dbFetch.mock.calls.map(([input]) => new URL(String(input)));
    for (const url of urls.filter((entry) => !entry.pathname.startsWith("/rest/v1/rpc/"))) {
      const select = url.searchParams.get("select");
      expect(select).not.toBe("*");
      expect(select).toBeTruthy();
    }
    const tables = urls.map((url) => url.pathname.replace("/rest/v1/", ""));
    // El barrido corre una vez y antes de cualquier lectura.
    expect(tables.filter((table) => table === "rpc/casa_sweep_match_issues")).toHaveLength(1);
    expect(tables[0]).toBe("rpc/casa_sweep_match_issues");
    expect(dbFetch.mock.calls[0][1]?.method).toBe("POST");
    expect(tables.filter((table) => table === "rpc/casa_active_open_match_issue_ids")).toHaveLength(1);
    expect(result.inactive).toEqual([]);
    expect(tables.filter((table) => table === "casa_match_issues")).toHaveLength(2);
    expect(tables.filter((table) => table === "matches")).toHaveLength(1);
    expect(tables.filter((table) => table === "casa_polla_matches")).toHaveLength(1);
    expect(tables.filter((table) => table === "casa_pollas")).toHaveLength(1);
    expect(urls.find((url) => url.pathname.endsWith("/matches"))?.searchParams.get("id")).toBe(`in.(${matchId})`);
    expect(urls.find((url) => url.pathname.endsWith("/casa_polla_matches"))?.searchParams.get("match_id")).toBe(`in.(${matchId})`);
  });

  it("no convierte un error de lectura en una lista vacía", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    dbFetch.mockResolvedValue(response({ message: "relation does not exist" }, 500));
    expect(await listMatchIssues()).toEqual({ ok: false });
    logged.mockRestore();
  });

  it("si el barrido falla, lo registra en el log y sigue leyendo", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    dbFetch.mockImplementation(async (input) => route(String(input), {
      "rpc/casa_sweep_match_issues": () => response({ code: "XX000", message: "sweep exploded with private detail" }, 500),
    }));
    const result = await listMatchIssues();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.open.map((issue) => issue.id)).toEqual([issueId]);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0][0]).toBe("[casa/match-issues] sweep failed code=XX000");
    expect(logged.mock.calls[0].join(" ")).not.toContain("private detail");
    logged.mockRestore();
  });

  it("deja al final los abiertos que ya no afectan pollas activas", async () => {
    dbFetch.mockImplementation(async (input) => route(String(input), {
      "rpc/casa_active_open_match_issue_ids": () => response([]),
    }));
    const result = await listMatchIssues();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.open).toEqual([]);
    expect(result.inactive.map((issue) => issue.id)).toEqual([issueId]);
    expect(result.decided).toHaveLength(1);
  });

  it("sin la lista de activos no esconde casos abiertos", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    dbFetch.mockImplementation(async (input) => route(String(input), {
      "rpc/casa_active_open_match_issue_ids": () => response({ message: "boom" }, 500),
    }));
    const result = await listMatchIssues();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.open.map((issue) => issue.id)).toEqual([issueId]);
    expect(result.inactive).toEqual([]);
    logged.mockRestore();
  });

  it("cuenta solo los abiertos de pollas activas con una sola consulta head al RPC", async () => {
    dbFetch.mockResolvedValueOnce(new Response(null, { status: 200, headers: { "Content-Range": "*/3" } }));
    expect(await countOpenMatchIssues()).toBe(3);
    expect(dbFetch).toHaveBeenCalledTimes(1);
    const [url, init] = dbFetch.mock.calls[0];
    expect(init?.method).toBe("HEAD");
    expect(new URL(String(url)).pathname).toBe("/rest/v1/rpc/casa_active_open_match_issue_ids");
    expect(new Headers(init?.headers).get("Prefer")).toContain("count=exact");
  });

  it("devuelve null si el conteo falla", async () => {
    dbFetch.mockResolvedValueOnce(new Response(null, { status: 500 }));
    expect(await countOpenMatchIssues()).toBeNull();
  });
});
