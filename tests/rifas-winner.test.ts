import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RifaCreatorView, RifaPublicView } from "@/lib/rifas/shared";
import { RifaComprador } from "@/components/rifas/RifaComprador";
import { RifaGestion } from "@/components/rifas/RifaGestion";

vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

const publicView: RifaPublicView = {
  id: "00000000-0000-4000-8000-000000000186", slug: "synthetic-winner", name: "Synthetic raffle", creator_name: "Creator",
  prize_kind: "texto", prize_cop: null, prize_text: "A shirt", has_prize_image: false,
  number_count: 100, price_cop: 5000, lottery_name: "Synthetic lottery", digits_rule: "ultimas_dos",
  draw_at: "2020-01-01T23:00:00-05:00", visibility: "publica", status: "resuelta", winning_number: 0,
  show_winner_public: true, winner: { name: "Synthetic Winner", avatar_url: "junior" }, hidden: false,
  hidden_reason: null, closed: true, reservation_minutes: 30, board: [], counts: { pagado: 1, reservado: 0 }, draws: [],
  viewer: { signed_in: false, is_creator: false, is_admin: false, can_reserve: false, reported: false,
    pending_amount_cop: 0, has_payout_account: false, tickets: [], proofs: [] }, payment: null,
};

describe("raffle winner UI", () => {
  it("shows the winner's name and existing pollito only with disclosure enabled", () => {
    const html = renderToStaticMarkup(createElement(RifaComprador, { initial: publicView }));
    expect(html).toContain("Synthetic Winner");
    expect(html).toContain('alt="Pollito del ganador"');
    expect(html).toContain("00");
    const hidden = renderToStaticMarkup(createElement(RifaComprador, { initial: { ...publicView, show_winner_public: false } }));
    expect(hidden).not.toContain("Synthetic Winner");
    expect(hidden).not.toContain('alt="Pollito del ganador"');
    expect(hidden).toContain("Número ganador");
  });

  it("offers managers a visible result link after closure", () => {
    const html = renderToStaticMarkup(createElement(RifaComprador, { initial: { ...publicView, status: "abierta",
      winner: null, winning_number: null, viewer: { ...publicView.viewer, signed_in: true, is_creator: true } } }));
    expect(html).toContain("¿Qué número ganó?");
    expect(html).toContain("/rifa/synthetic-winner/gestionar");
  });

  it("asks for a manual number and explicit Yes/No only after draw time", () => {
    const initial: RifaCreatorView = { ...publicView, status: "abierta", winning_number: null, winner: null,
      payment: { method: "nequi", account: "15550101861", holder: "Synthetic" }, tickets: [], proofs: [],
      summary: { pagado: 0, reservado: 0, pending_proofs: 0, collected_cop: 0 }, events: [] };
    const html = renderToStaticMarkup(createElement(RifaGestion, { initial, shareUrl: "https://example.invalid/rifa" }));
    expect(html).toContain("¿Qué número ganó?");
    expect(html).toContain('id="numero-ganador"');
    expect(html).toContain("Mostrar ganador públicamente");
    expect(html.match(/name="ganador-publico"/g)).toHaveLength(2);
    expect(html).not.toContain('name="ganador-publico" checked');
    const before = renderToStaticMarkup(createElement(RifaGestion, { initial: { ...initial, draw_at: "2099-01-01T00:00:00-05:00" }, shareUrl: "https://example.invalid/rifa" }));
    expect(before).not.toContain('id="numero-ganador"');
  });
});
