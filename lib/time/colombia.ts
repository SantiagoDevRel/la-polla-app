/** All player/admin calendar dates use Colombia, regardless of the device zone. */
export const COLOMBIA_TIME_ZONE = "America/Bogota";

type DateValue = string | Date;

const calendarFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: COLOMBIA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function calendarParts(value: DateValue) {
  const parts = calendarFormatter.formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)!.value;
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

/** Format an instant. Locale changes wording, never the time zone. */
export function formatColombiaDateTime(
  value: DateValue,
  options: Intl.DateTimeFormatOptions,
  locale = "es-CO",
): string {
  return new Intl.DateTimeFormat(locale, {
    ...options,
    timeZone: COLOMBIA_TIME_ZONE,
  }).format(new Date(value));
}

/** Calendar key for grouping instants into the day actually seen in Colombia. */
export function colombiaDateKey(value: DateValue): string {
  return calendarParts(value).date;
}

/** datetime-local has no zone: its displayed fields must be Colombia's fields. */
export function toColombiaDateTimeInput(value: DateValue): string {
  const { date, time } = calendarParts(value);
  return `${date}T${time}`;
}

/** Scheduling inputs use Colombia's UTC-05:00 offset, never the browser's zone. */
export function colombiaDateTimeToIso(input: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input)) {
    throw new RangeError("Fecha y hora de Colombia inválidas");
  }
  const value = new Date(`${input}:00-05:00`);
  if (!Number.isFinite(value.getTime()) || toColombiaDateTimeInput(value) !== input) {
    throw new RangeError("Fecha y hora de Colombia inválidas");
  }
  return value.toISOString();
}

/** Existing creation default: the following Saturday at noon in Colombia. */
export function nextColombiaSaturdayInput(now = new Date()): string {
  const calendarDay = new Date(`${colombiaDateKey(now)}T12:00:00Z`);
  const daysUntilSaturday = (6 - calendarDay.getUTCDay() + 7) % 7 || 7;
  calendarDay.setUTCDate(calendarDay.getUTCDate() + daysUntilSaturday);
  return `${calendarDay.toISOString().slice(0, 10)}T12:00`;
}
