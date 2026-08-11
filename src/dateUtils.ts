import type { PeriodKey, RangeKey } from "./types";

export const DAY_MS = 86_400_000;

const periodRanges: Record<PeriodKey, RangeKey> = {
  day: "today",
  week: "7d",
  month: "30d",
  year: "year",
  custom: "30d",
};

const dayFormatter = new Intl.DateTimeFormat("hu-HU", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const monthFormatter = new Intl.DateTimeFormat("hu-HU", {
  year: "numeric",
  month: "long",
});

export function dateInputValue(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dateFromInput(value: string, endOfDay = false) {
  return new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}`);
}

export function startOfWeek(value: Date) {
  const date = new Date(value);
  const weekday = date.getDay() || 7;
  date.setDate(date.getDate() - weekday + 1);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function endOfWeek(value: Date) {
  const date = startOfWeek(value);
  date.setDate(date.getDate() + 6);
  date.setHours(23, 59, 59, 999);
  return date;
}

export function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

export function periodLabel(period: PeriodKey, anchor: Date, customStart: string, customEnd: string) {
  if (period === "day") return dayFormatter.format(anchor);
  if (period === "week") return `${dayFormatter.format(startOfWeek(anchor))} – ${dayFormatter.format(endOfWeek(anchor))}`;
  if (period === "month") return monthFormatter.format(anchor);
  if (period === "year") return `${anchor.getFullYear()}`;
  const from = customStart ? dayFormatter.format(dateFromInput(customStart)) : "–";
  const to = customEnd ? dayFormatter.format(dateFromInput(customEnd)) : "–";
  return `${from} – ${to}`;
}

export function timestampInPeriod(timestamp: string | undefined, period: PeriodKey, anchor: Date, customStart: string, customEnd: string) {
  if (!timestamp) return true;
  const time = new Date(timestamp);
  if (period === "day") return sameDay(time, anchor);
  if (period === "week") return time >= startOfWeek(anchor) && time <= endOfWeek(anchor);
  if (period === "month") return time.getFullYear() === anchor.getFullYear() && time.getMonth() === anchor.getMonth();
  if (period === "year") return time.getFullYear() === anchor.getFullYear();
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
  if (period === "month") return anchor.getFullYear() === today.getFullYear() && anchor.getMonth() === today.getMonth();
  if (period === "year") return anchor.getFullYear() === today.getFullYear();
  return false;
}
