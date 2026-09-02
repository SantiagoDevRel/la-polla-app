// Helpers puros para los acuses (DLR) de LabsMobile.

/**
 * LabsMobile manda `timestamp=YYYY-MM-DD HH:MM:SS` en GMT.
 *
 * No usamos `new Date("YYYY-MM-DD HH:MM:SS")`: ese formato sin zona se
 * interpreta como hora LOCAL en algunos runtimes y nos inventaría cinco horas
 * de demora en Colombia. Date.UTC deja la intención explícita y además
 * validamos los componentes para rechazar fechas desbordadas como 2026-02-31.
 */
export function parseLabsMobileTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(
    value.trim(),
  );
  if (!match) return null;

  const [, y, mo, d, h, mi, s] = match;
  const parts = [y, mo, d, h, mi, s].map(Number);
  if (parts.some((part) => !Number.isInteger(part))) return null;

  const [year, month, day, hour, minute, second] = parts as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day ||
    parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute ||
    parsed.getUTCSeconds() !== second
  ) {
    return null;
  }

  return parsed;
}
