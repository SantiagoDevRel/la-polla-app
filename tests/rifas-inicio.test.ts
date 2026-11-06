// tests/rifas-inicio.test.ts — inicio en una sola pantalla: rifas destacadas arriba y etiquetas RIFA/POLLA.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { RifaMyList, RifaPublicView } from "@/lib/rifas/shared";

vi.mock("server-only", () => ({}));
const { RifasInicio } = await import("@/components/rifas/RifasInicio");

const LA_IGUANA_1 = "495aa5b1-767c-47bb-8487-15223ab44f63";

function view(over: Partial<RifaPublicView> = {}): RifaPublicView {
  return {
    id: LA_IGUANA_1, slug: "rifa-solidaria-la-iguana-camiseta", name: "Rifa solidaria La Iguaná · Camiseta 1", creator_name: "carlos",
    prize_kind: "texto", prize_cop: null, prize_text: "Camiseta firmada", has_prize_image: false, number_count: 100, price_cop: 30000,
    lottery_name: "Lotería de Medellín", digits_rule: "ultimas_dos", draw_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    visibility: "publica", status: "abierta", winning_number: null, hidden: false, hidden_reason: null, closed: false, reservation_minutes: 30,
    board: [], counts: { pagado: 2, reservado: 1 }, draws: [],
    viewer: { signed_in: true, is_creator: false, is_admin: false, can_reserve: true, reported: false, pending_amount_cop: 0, has_payout_account: false, tickets: [], proofs: [] },
    payment: null, ...over,
  };
}

const emptyList: RifaMyList = { can_create: false, created: [], bought: [], visited: [], listed: [] };
const html = (featured: RifaPublicView[], mine: RifaMyList | null) => renderToStaticMarkup(createElement(RifasInicio, { featured, mine }));

describe("RifasInicio", () => {
  it("la rifa sin ánimo de lucro sale con su etiqueta, su causa y el botón con el precio", () => {
    const out = html([view()], emptyList);
    expect(out).toContain(">Rifa</span>");
    expect(out).toContain("Para una familia damnificada en La Iguaná");
    expect(out).toContain("Elegir número · $30.000");
    expect(out).toContain("3 de 100 números tomados");
    expect(out).toContain(">Sin ánimo de lucro</span>");
    expect(out).not.toContain("lucro ·");
  });

  it("sin «reservado» a la vista: con comprobante ya es pagado; sin comprobante lo dice", () => {
    const tickets = [
      { number: 7, state: "en_revision" as const, origin: "app" as const, expires_at: null, proof_id: null },
      { number: 23, state: "reservado" as const, origin: "app" as const, expires_at: null, proof_id: null },
    ];
    const out = html([view({ viewer: { ...view().viewer, tickets } })], emptyList);
    expect(out).toContain("Tus números: Pagados 07 · Falta el comprobante 23");
    expect(out).not.toMatch(/[Rr]eservad/);
  });

  it("quien ya compró ve sus números; el equipo también compra y ve los pagos por confirmar", () => {
    const tickets = [{ number: 7, state: "en_revision" as const, origin: "app" as const, expires_at: null, proof_id: null }];
    expect(html([view({ viewer: { ...view().viewer, tickets } })], emptyList)).toContain("Tus números: Pagados 07");
    const created = [{ slug: "rifa-solidaria-la-iguana-camiseta", name: "x", status: "abierta" as const, visibility: "publica" as const,
      draw_at: view().draw_at, hidden: false, number_count: 100, paid: 0, pending_proofs: 4 }];
    const out = html([view({ viewer: { ...view().viewer, is_creator: true } })], { ...emptyList, created });
    expect(out).toContain("Elegir número · $30.000");
    expect(out).not.toContain("Ver rifa");
    expect(out).toContain("4 pagos por confirmar");
    // La destacada no se repite en las filas.
    expect(out).not.toContain("Creada por ti");
  });

  it("sin rifas no dibuja nada: el inicio queda solo con las pollas", () => {
    expect(html([], emptyList)).toBe("");
    expect(html([], null)).toBe("");
  });
});

describe("inicio sin pestañas", () => {
  it("ya no existe el selector POLLAS | RIFAS y las pollas llevan su etiqueta", () => {
    const page = readFileSync(join(process.cwd(), "app/(app)/page.tsx"), "utf8");
    expect(page).not.toMatch(/PollasRifasTabs|tab === "rifas"/);
    expect(page).toContain("<MyPollas typeTag={conRifas}");
    expect(page).toContain('tag={tag ? "polla" : undefined}');
  });
});

describe("ajustes del 6-nov", () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("el tablero público solo muestra libre o pagado, y el equipo compra como cualquiera", () => {
    const comprador = src("components/rifas/RifaComprador.tsx");
    expect(comprador).toContain('state: c.s === "libre" ? "libre" : "pagado"');
    expect(comprador).toContain("const openForPicking = !rifa.closed && !rifa.hidden;");
    expect(comprador).not.toContain("no puedes comprar");
    expect(comprador).not.toMatch(/>Reservar<|"Reservar"|Quitar mi reserva/);
  });
  it("el equipo confirma el pago o lo marca como no pagado", () => {
    const gestion = src("components/rifas/RifaGestion.tsx");
    expect(gestion).toContain("Confirmar pago");
    expect(gestion).toContain("No pagó");
    expect(gestion).not.toMatch(/"Reservado"|>Aprobar<|>Rechazar</);
  });
  it("los borradores privados salieron del inicio y van al final del panel", () => {
    expect(src("app/(app)/page.tsx")).not.toMatch(/pollas-privadas|listHiddenAdminPollas/);
    expect(src("app/(app)/admin/page.tsx")).toContain("<AdminPanel footer=");
  });
});
