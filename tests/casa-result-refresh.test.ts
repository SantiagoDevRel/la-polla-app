import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));
import { pickForDisplay } from "@/components/casa/PicksBoard";

describe("puntos recibidos al refrescar la polla", () => {
  const draft = { pick1x2: null, homeScore: 3, awayScore: 1, pointsEarned: null };
  const saved = { pick1x2: null, homeScore: 2, awayScore: 1, pointsEarned: 3 };
  it("conserva el pronóstico sin guardar mientras faltan resultados", () => {
    expect(pickForDisplay({ final_verified_at: null }, draft, saved)).toBe(draft);
  });
  it("al verificar muestra el pronóstico guardado y los puntos nuevos sin remontar el tablero", () => {
    expect(pickForDisplay({ final_verified_at: "2026-09-24T20:40:00Z" }, draft, saved)).toBe(saved);
  });
  it("un partido anulado recibe cero del servidor y un borrador nunca guardado no cuenta", () => {
    expect(pickForDisplay({ final_verified_at: null, voided_at: "2026-09-24T20:40:00Z" }, saved, { ...saved, pointsEarned: 0 })?.pointsEarned).toBe(0);
    expect(pickForDisplay({ final_verified_at: "2026-09-24T20:40:00Z" }, draft, undefined)).toBeUndefined();
  });
});
