// Dates stay real instants (UTC in JSON); only calendar operations and display
// use the home's time zone, never the visitor's computer time zone.
export const TIME_ZONE = "Europe/Sofia";

export function dateTimeFormatter(options, locale = "hu-HU") {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: TIME_ZONE });
}

const partsFormatter = dateTimeFormatter({
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
}, "en-GB");
const keyFormatter = dateTimeFormatter({ year: "numeric", month: "2-digit", day: "2-digit" }, "en-CA");

export function dateParts(value) {
  return Object.fromEntries(partsFormatter.formatToParts(new Date(value))
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, Number(part.value)]));
}

export function dateKey(value) {
  return keyFormatter.format(new Date(value));
}

function wallTime(value) {
  const p = dateParts(value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

// Month is 1-based. Resolve Sofia wall time using the offsets on both sides
// of a possible DST transition. Repeated hours pick the earlier occurrence;
// nonexistent spring hours move forward by the gap (Date/Temporal semantics).
export function calendarDate(year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) {
  const target = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const wholeSecond = Math.floor(target / 1000) * 1000;
  const offsets = [...new Set([-86400000, 86400000].map((delta) => wallTime(wholeSecond + delta) - (wholeSecond + delta)))];
  const candidates = offsets.map((offset) => target - offset);
  const exact = candidates.filter((candidate) => wallTime(candidate) === wholeSecond);
  return new Date(exact.length ? Math.min(...exact) : Math.max(...candidates));
}

// Bulgarian publishers sometimes omit the zone. Explicit offsets are retained.
export function parseLocalDateTime(value) {
  const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/);
  if (!match) return new Date(value);
  return calendarDate(+match[1], +match[2], +match[3], +(match[4] ?? 0), +(match[5] ?? 0), +(match[6] ?? 0), +(match[7] ?? "0").padEnd(3, "0"));
}

export function startOfDay(value) {
  const { year, month, day } = dateParts(value);
  return calendarDate(year, month, day);
}

export function addCalendarDays(value, days) {
  const p = dateParts(value);
  return calendarDate(p.year, p.month, p.day + days, p.hour, p.minute, p.second, new Date(value).getUTCMilliseconds());
}

export function addCalendarMonths(value, months) {
  const p = dateParts(value);
  const target = new Date(Date.UTC(p.year, p.month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return calendarDate(target.getUTCFullYear(), target.getUTCMonth() + 1, Math.min(p.day, lastDay), p.hour, p.minute, p.second, new Date(value).getUTCMilliseconds());
}

export function endOfDay(value) {
  return new Date(addCalendarDays(startOfDay(value), 1).getTime() - 1);
}

export function dayFraction(value) {
  const start = startOfDay(value);
  return (new Date(value).getTime() - start.getTime()) / (addCalendarDays(start, 1).getTime() - start.getTime());
}

// Wall-clock tick labels at their actual positions in a 23/24/25-hour day.
export function dayTicks(value) {
  const { year, month, day } = dateParts(value);
  return Array.from({ length: 9 }, (_, index) => ({
    label: `${String(index * 3).padStart(2, "0")}:00`,
    ratio: index === 8 ? 1 : dayFraction(calendarDate(year, month, day, index * 3)),
  }));
}
