import { addCalendarDays, dateParts, startOfDay } from "../../timeZone";
import type { SensorPoint } from "./types";

// EU Directive 2024/2881, Annex I, Section 1. The 2030 limits apply to the
// date of the measured day, not the date on which the page is opened.
export const PARTICULATE_LIMITS = {
  current: { pm10Daily: 50, pm10Days: 35, pm10Annual: 40, pm25Annual: 25 },
  from2030: { pm10Daily: 45, pm10Days: 18, pm10Annual: 20, pm25Daily: 25, pm25Annual: 10 },
  bulgarianIndicativePm25Annual: 20,
  changeYear: 2030,
} as const;

export const PARTICULATE_SOURCES = {
  bulgaria: "https://eea.government.bg/bg/legislation/air/Naredba12_21.pdf",
  eu: "https://eur-lex.europa.eu/eli/dir/2024/2881/oj/eng",
  who: "https://www.who.int/news/item/07-09-2022-who-releases-new-repository-of-resources-for-air-quality-management",
} as const;

// WHO 2021 air-quality guideline, 24-hour mean (99th percentile). This is a
// health recommendation, not an EU legal limit or a regulatory alert.
export const WHO_PM25_DAILY_GUIDELINE = 15;

export function pm10DailyLimit(year: number) {
  return year >= PARTICULATE_LIMITS.changeYear ? PARTICULATE_LIMITS.from2030 : PARTICULATE_LIMITS.current;
}

type DailySummary = {
  dayStart: number | null;
  coverage: number;
  expectedSlots: number;
  sampleCount: number;
  average: number | null;
};

// One stored reading represents a 10-minute interval. We only compare the
// last closed Bulgarian calendar day within the selection, never a partial day.
// A 75% local coverage requirement avoids estimating from a handful of points;
// even with sufficient coverage this is not a regulatory reference measurement.
export function lastDailyParticulate(
  points: SensorPoint[], metric: "pm25" | "pm10", periodStart: number, periodEnd: number,
  now: number, bucketMinutes = 10,
): DailySummary {
  const empty: DailySummary = { dayStart: null, coverage: 0, expectedSlots: 0, sampleCount: 0, average: null };
  if (![periodStart, periodEnd, now, bucketMinutes].every(Number.isFinite)
    || periodStart >= periodEnd || bucketMinutes <= 0 || 60 % bucketMinutes !== 0) return empty;

  const end = startOfDay(Math.min(periodEnd, now)).getTime();
  const start = addCalendarDays(end, -1).getTime();
  if (start < periodStart || end > periodEnd || end > now) return empty;
  const bucketMs = bucketMinutes * 60_000;
  const expectedSlots = (end - start) / bucketMs;
  const buckets = new Map<number, { observedAt: number; value: number }>();
  for (const point of points) {
    const time = Date.parse(point.timestamp);
    const value = point[metric];
    if (!Number.isFinite(time) || time < start || time >= end
      || typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
    const slot = Math.floor((time - start) / bucketMs);
    const slotStart = start + slot * bucketMs;
    const observedAt = point.observedAt?.[metric] === undefined ? time : Date.parse(point.observedAt[metric]!);
    if (!Number.isFinite(observedAt) || observedAt < slotStart || observedAt >= slotStart + bucketMs || observedAt > now) continue;
    const previous = buckets.get(slot);
    if (!previous || observedAt > previous.observedAt) buckets.set(slot, { observedAt, value });
  }
  const sampleCount = buckets.size;
  const coverage = sampleCount / expectedSlots;
  const average = coverage >= .75
    ? [...buckets.values()].reduce((sum, sample) => sum + sample.value, 0) / sampleCount
    : null;
  return { dayStart: start, coverage, expectedSlots, sampleCount, average };
}

export function pm10LimitForDay(dayStart: number) {
  return pm10DailyLimit(dateParts(dayStart).year);
}
