import type { PeriodKey, RangeKey } from "./types";
import { addCalendarDays, dateKey, dateParts, dateTimeFormatter, endOfDay, parseLocalDateTime, startOfDay } from "./timeZone";

export const DAY_MS = 86_400_000;

const periodRanges: Record<PeriodKey, RangeKey> = {
  day: "today",
  week: "7d",
  month: "30d",
  year: "year",
  custom: "30d",
};

const dayFormatter = dateTimeFormatter({
  year: "numeric",
  month: "long",
  day: "numeric",
});

const monthFormatter = dateTimeFormatter({
  year: "numeric",
  month: "long",
});

const monthDayFormatter = dateTimeFormatter({
  month: "long",
  day: "numeric",
});

function compactDateRange(start: Date, end: Date) {
  const from = dateParts(start);
  const to = dateParts(end);
  const sameYear = from.year === to.year;
  const sameMonth = sameYear && from.month === to.month;
  if (sameMonth) {
    return `${from.year}. ${dateTimeFormatter({ month: "long" }).format(start)} ${from.day}–${to.day}.`;
  }
  if (sameYear) return `${from.year}. ${monthDayFormatter.format(start)} – ${monthDayFormatter.format(end)}`;
  return `${dayFormatter.format(start)} – ${dayFormatter.format(end)}`;
}

export function dateInputValue(value: Date) {
  return dateKey(value);
}

export function dateFromInput(value: string, endOfDay = false) {
  const date = parseLocalDateTime(value);
  return endOfDay ? new Date(addCalendarDays(date, 1).getTime() - 1) : date;
}

export function startOfWeek(value: Date) {
  const p = dateParts(value);
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() || 7;
  return addCalendarDays(startOfDay(value), 1 - weekday);
}

export function endOfWeek(value: Date) {
  return endOfDay(addCalendarDays(startOfWeek(value), 6));
}

export function sameDay(a: Date, b: Date) {
  return dateKey(a) === dateKey(b);
}

export function periodLabel(period: PeriodKey, anchor: Date, customStart: string, customEnd: string) {
  if (period === "day") return dayFormatter.format(anchor);
  if (period === "week") return compactDateRange(startOfWeek(anchor), endOfWeek(anchor));
  if (period === "month") return monthFormatter.format(anchor);
  if (period === "year") return `${dateParts(anchor).year}`;
  const from = customStart ? dayFormatter.format(dateFromInput(customStart)) : "–";
  const to = customEnd ? dayFormatter.format(dateFromInput(customEnd)) : "–";
  if (customStart && customEnd) return compactDateRange(dateFromInput(customStart), dateFromInput(customEnd));
  return `${from} – ${to}`;
}

export function timestampInPeriod(timestamp: string | undefined, period: PeriodKey, anchor: Date, customStart: string, customEnd: string) {
  if (!timestamp) return true;
  const time = new Date(timestamp);
  if (!Number.isFinite(time.getTime())) return false;
  if (period === "day") return sameDay(time, anchor);
  if (period === "week") return time >= startOfWeek(anchor) && time <= endOfWeek(anchor);
  if (period === "month") return dateKey(time).slice(0, 7) === dateKey(anchor).slice(0, 7);
  if (period === "year") return dateParts(time).year === dateParts(anchor).year;
  if (!customStart || !customEnd) return true;
  return time >= dateFromInput(customStart) && time <= dateFromInput(customEnd, true);
}

export function rangeForPeriod(period: PeriodKey, from?: string, to?: string): RangeKey {
  if (period !== "custom" || !from || !to) return periodRanges[period];
  const days = Math.max(1, Math.round((dateFromInput(to).getTime() - dateFromInput(from).getTime()) / DAY_MS) + 1);
  return days > 62 ? "year" : "30d";
}

export function isCurrentPeriod(period: PeriodKey, anchor: Date, today = new Date()) {
  if (period === "day") return sameDay(anchor, today);
  if (period === "week") return sameDay(startOfWeek(anchor), startOfWeek(today));
  if (period === "month") return dateKey(anchor).slice(0, 7) === dateKey(today).slice(0, 7);
  if (period === "year") return dateParts(anchor).year === dateParts(today).year;
  return false;
}
