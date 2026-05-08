// lib/formatCurrency.ts — Locale + currency aware money formatter.
//
// Reemplaza el formatCOP() viejo que hardcodeaba peso colombiano. Ahora
// cada polla tiene su currency (COP, USD, etc.) y el display respeta:
//   - el currency de la polla (qué moneda)
//   - el locale del viewer (cómo se separan miles/decimales)
//
// Ejemplos:
//   formatCurrency(10000, "COP", "es") → "$10.000"        (es-CO format, $)
//   formatCurrency(10000, "USD", "en") → "$10,000"        (en-US format)
//   formatCurrency(10000, "COP", "en") → "COP 10,000"     (currency code prefix)
//   formatCurrency(10000, "USD", "es") → "US$ 10.000"     (currency code prefix)

const SUPPORTED_CURRENCIES = ["COP", "USD", "EUR", "MXN", "ARS"] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export function isSupportedCurrency(value: unknown): value is Currency {
  return (
    typeof value === "string" &&
    (SUPPORTED_CURRENCIES as readonly string[]).includes(value)
  );
}

export function formatCurrency(
  amount: number,
  currency: string = "COP",
  locale: string = "es",
): string {
  const intlTag = locale === "en" ? "en-US" : "es-CO";
  const safeCurrency = isSupportedCurrency(currency) ? currency : "COP";
  try {
    return new Intl.NumberFormat(intlTag, {
      style: "currency",
      currency: safeCurrency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(Math.round(amount));
  } catch {
    return `${safeCurrency} ${Math.round(amount).toLocaleString(intlTag)}`;
  }
}

// Backward-compat: legacy callers que asumen COP. Se irán migrando a
// formatCurrency(amount, polla.currency, locale) cuando toquemos cada
// componente.
export function formatCOP(amount: number): string {
  return formatCurrency(amount, "COP", "es");
}
