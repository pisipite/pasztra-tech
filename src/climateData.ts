import { timestampInPeriod } from "./dateUtils";
import type { ClimatePoint, PeriodKey } from "./types";

const dayLabel = new Intl.DateTimeFormat("hu-HU", { month: "short", day: "numeric" });
const monthLabel = new Intl.DateTimeFormat("hu-HU", { month: "short" });

export function climatePointsForPeriod(
  history: ClimatePoint[],
  period: PeriodKey,
  anchor: Date,
  customStart: string,
  customEnd: string,
) {
  const filtered = history.filter((point) => timestampInPeriod(point.timestamp, period, anchor, customStart, customEnd));
  if (period === "day" || filtered.some((point) => !point.timestamp)) return filtered;

  const groups = new Map<string, { timestamp: string; temperature: number; humidity: number; count: number }>();
  for (const point of filtered) {
    const date = new Date(point.timestamp!);
    const key = period === "year"
      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
      : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const timestamp = period === "year"
      ? new Date(date.getFullYear(), date.getMonth(), 1, 12).toISOString()
      : new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12).toISOString();
    const group = groups.get(key) ?? { timestamp, temperature: 0, humidity: 0, count: 0 };
    group.temperature += point.temperature;
    group.humidity += point.humidity;
    group.count += 1;
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const timestamp = new Date(group.timestamp);
    return {
      timestamp: group.timestamp,
      label: period === "year" ? monthLabel.format(timestamp) : dayLabel.format(timestamp),
      temperature: group.temperature / group.count,
      humidity: group.humidity / group.count,
    };
  });
}
