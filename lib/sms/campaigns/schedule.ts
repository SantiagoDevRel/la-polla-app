import { colombiaDateKey, colombiaDateTimeToIso, toColombiaDateTimeInput } from "@/lib/time/colombia";

/** Colombian national holidays (Law 51/1983); Gregorian Easter algorithm. */
export function colombiaHolidays(year: number) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = (h + l - 7 * m + 114) % 31 + 1;
  const dates = new Set<string>();
  const add = (date: Date, monday = false) => {
    if (monday) date.setUTCDate(date.getUTCDate() + (8 - date.getUTCDay()) % 7);
    dates.add(date.toISOString().slice(0, 10));
  };
  for (const [mo, dy] of [[1, 1], [5, 1], [7, 20], [8, 7], [12, 8], [12, 25]]) add(new Date(Date.UTC(year, mo - 1, dy)));
  for (const [mo, dy] of [[1, 6], [3, 19], [6, 29], [8, 15], [10, 12], [11, 1], [11, 11]]) add(new Date(Date.UTC(year, mo - 1, dy)), true);
  for (const offset of [-3, -2, 43, 64, 71]) add(new Date(Date.UTC(year, month - 1, day + offset)));
  return dates;
}

export function assertCampaignTime(instant: string, closesAt: string, now = new Date()) {
  const value = new Date(instant);
  if (!Number.isFinite(value.getTime()) || value.getTime() < now.getTime() - 30_000) throw new Error("El horario ya pasó.");
  if (value >= new Date(closesAt)) throw new Error("El envío debe ser antes del cierre de la polla.");
  const local = toColombiaDateTimeInput(value);
  const date = colombiaDateKey(value);
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const hour = Number(local.slice(11, 13));
  if (day === 0 || colombiaHolidays(Number(date.slice(0, 4))).has(date) || hour < (day === 6 ? 8 : 7) || hour >= (day === 6 ? 15 : 19)) {
    throw new Error("Elige lunes a viernes de 7 a. m. a 7 p. m., o sábado de 8 a. m. a 3 p. m., sin festivos (Colombia).");
  }
}

export function nextCampaignTime(now = new Date()) {
  const date = new Date(`${colombiaDateKey(now)}T12:00:00Z`);
  for (let i = 0; i < 10; i++) {
    const input = `${date.toISOString().slice(0, 10)}T12:00`;
    const iso = colombiaDateTimeToIso(input);
    try { assertCampaignTime(iso, "9999-12-31", new Date(now.getTime() + 300_000)); return input; } catch { date.setUTCDate(date.getUTCDate() + 1); }
  }
  throw new Error("No se encontró un horario disponible.");
}
