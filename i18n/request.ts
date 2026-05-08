import { getRequestConfig } from "next-intl/server";
import { headers } from "next/headers";

const SUPPORTED = ["es", "en"] as const;
type Locale = (typeof SUPPORTED)[number];

export const DEFAULT_LOCALE: Locale = "es";

function isLocale(value: string | null): value is Locale {
  return value !== null && (SUPPORTED as readonly string[]).includes(value);
}

export default getRequestConfig(async () => {
  const h = await headers();
  const fromHeader = h.get("x-locale");
  const locale: Locale = isLocale(fromHeader) ? fromHeader : DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
