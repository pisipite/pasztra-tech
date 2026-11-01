import { dateFromInput, endOfWeek, startOfWeek, timestampInPeriod } from "../../dateUtils";
import { addCalendarDays, addCalendarMonths, dateKey, startOfDay } from "../../timeZone";
import type { PeriodKey } from "../../types";
import type { SensorMetric, SensorPoint } from "./types";

export const SENSOR_METRICS: SensorMetric[] = ["pm25", "pm10", "temperature", "humidity", "pressure"];

// The arrow represents the net change between two real measurements, not a
// claim that values moved continuously in the same direction for an hour.
export function recentSensorTrend(
  points: SensorPoint[], metric: SensorMetric,
  latest: { value: number; timestamp: string } | undefined, now = Date.now(),
): { delta: number; from: string; to: string } | null {
  const latestMs = Date.parse(latest?.timestamp ?? "");
  if (!latest || !Number.isFinite(latest.value) || !Number.isFinite(latestMs)
    || latestMs > now || now - latestMs > 30 * 60_000) return null;
  const target = latestMs - 60 * 60_000;
  const samples = points.flatMap((point) => {
    const timestamp = point.observedAt?.[metric];
    const time = Date.parse(timestamp ?? "");
    const value = point[metric];
    return timestamp && Number.isFinite(time) && time >= target - 15 * 60_000 && time <= latestMs
      && typeof value === "number" && Number.isFinite(value) ? [{ timestamp, time, value }] : [];
  }).sort((a, b) => a.time - b.time);
  const final = samples.at(-1);
  if (!final || final.time !== latestMs || final.value !== latest.value) return null;
  const baseline = samples.reduce<typeof samples[number] | null>((best, sample) =>
    Math.abs(sample.time - target) < Math.abs((best?.time ?? Infinity) - target) ? sample : best, null);
  if (!baseline || Math.abs(baseline.time - target) > 15 * 60_000 || baseline.time >= latestMs) return null;
  const interval = samples.filter((sample) => sample.time >= baseline.time);
  if (interval.length < 4 || interval.some((sample, index) => index > 0 && sample.time - interval[index - 1].time > 25 * 60_000)) return null;
  return { delta: latest.value - baseline.value, from: baseline.timestamp, to: latest.timestamp };
}

export function sensorPeriodBounds(period: PeriodKey, anchor: Date, from: string, to: string): [number, number] {
  if (period === "custom" && from && to) return [dateFromInput(from).getTime(), dateFromInput(to, true).getTime() + 1];
  if (period === "week") return [startOfWeek(anchor).getTime(), endOfWeek(anchor).getTime() + 1];
  const start = period === "year" ? dateFromInput(`${dateKey(anchor).slice(0, 4)}-01-01`)
    : period === "month" ? dateFromInput(`${dateKey(anchor).slice(0, 7)}-01`) : startOfDay(anchor);
  const end = period === "year" ? addCalendarMonths(start, 12) : period === "month" ? addCalendarMonths(start, 1) : addCalendarDays(start, 1);
  return [start.getTime(), end.getTime()];
}

export function sensorChartData(points: SensorPoint[], period: PeriodKey, anchor: Date, from: string, to: string, now = Date.now()) {
  const [start, end] = sensorPeriodBounds(period, anchor, from, to);
  const days = (end - start) / 86_400_000;
  const resolution = period === "day" || (period === "custom" && days <= 2.1) ? "sample"
    : period === "week" || (period === "custom" && days <= 14.1) ? "hour" : "day";
  const groups = new Map<string, { timestamp: string; totals: Partial<Record<SensorMetric, number>>; counts: Partial<Record<SensorMetric, number>> }>();
  for (const point of points) {
    const time = Date.parse(point.timestamp);
    if (!Number.isFinite(time) || time > now || !timestampInPeriod(point.timestamp, period, anchor, from, to)) continue;
    const groupTime = resolution === "sample" ? time : resolution === "hour" ? Math.floor(time / 3_600_000) * 3_600_000 : startOfDay(point.timestamp).getTime();
    const key = String(groupTime);
    const group = groups.get(key) ?? { timestamp: new Date(groupTime).toISOString(), totals: {}, counts: {} };
    for (const metric of SENSOR_METRICS) {
      const value = point[metric];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      group.totals[metric] = (group.totals[metric] ?? 0) + value;
      group.counts[metric] = (group.counts[metric] ?? 0) + 1;
    }
    groups.set(key, group);
  }
  const data = [...groups.values()].map((group) => {
    const values: SensorPoint = { timestamp: group.timestamp };
    for (const metric of SENSOR_METRICS) if (group.counts[metric]) values[metric] = group.totals[metric]! / group.counts[metric]!;
    return values;
  }).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return { data, start, end, resolution, gapMs: resolution === "sample" ? 15 * 60_000 : resolution === "hour" ? 90 * 60_000 : 36 * 3_600_000 };
}
