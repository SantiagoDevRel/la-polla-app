/** Shared by browser and bot. A result must be interpreted before announcing it. */
export const CASA_CONTRACT = 2;
export const CASA_HEADERS = { "Content-Type": "application/json", "X-Casa-Contract": "2" };

export type CasaSettlement = {
  contract: 2;
  outcome: "money_awarded" | "object_awarded" | "object_draw_pending" | "house_retained_zero_points";
  prize_cop: number;
  winners: number;
  each_cop: number;
  top_points: number;
  draw_id?: string;
};

export function settlementMessage(result: CasaSettlement): string {
  switch (result.outcome) {
    case "money_awarded": return `Reparto registrado para ${result.winners} ${result.winners === 1 ? "ganador" : "ganadores"}. Total: $${result.prize_cop.toLocaleString("es-CO")}.`;
    case "object_awarded": return "Premio adjudicado. Falta registrar la entrega del objeto.";
    case "object_draw_pending": return "Hay empate en el primer puesto. El premio queda pendiente del sorteo de desempate.";
    case "house_retained_zero_points": return "Polla resuelta sin adjudicaciones: todos los participantes terminaron con cero puntos.";
    default: throw new Error("Resultado de reparto desconocido. Actualiza la app.");
  }
}
