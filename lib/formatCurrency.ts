// lib/formatCurrency.ts — Formato de moneda colombiana
// Usa puntos como separador de miles, sin decimales
export function formatCOP(amount: number): string {
  return "$" + amount.toLocaleString("es-CO", { maximumFractionDigits: 0 });
}
