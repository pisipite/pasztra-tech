import { timestampInPeriod } from "./dateUtils";
import type { ClimatePoint, PeriodKey } from "./types";

const dayLabel = new Intl.DateTimeFormat("hu-HU", { month: "short", day: "numeric" });
const monthLabel = new Intl.DateTimeFormat("hu-HU", { month: "short" });

export type ClimateAggregation = "min" | "average" | "max";

export function climatePointsForPeriod(
  history: ClimatePoint[],
  period: PeriodKey,
  anchor: Date,
  customStart: string,
  customEnd: string,
  aggregation: ClimateAggregation = "average",
) {
  const filtered = history.filter((point) => timestampInPeriod(point.timestamp, period, anchor, customStart, customEnd));
  if (period === "day" || filtered.some((point) => !point.timestamp)) return filtered;

  const groups = new Map<string, { timestamp: string; temperatureTotal: number; humidityTotal: number; temperatureMin: number; temperatureMax: number; humidityMin: number; humidityMax: number; count: number }>();
  for (const point of filtered) {
    const date = new Date(point.timestamp!);
    const key = period === "year"
      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
      : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const timestamp = period === "year"
      ? new Date(date.getFullYear(), date.getMonth(), 1, 12).toISOString()
      : new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12).toISOString();
    const group = groups.get(key) ?? { timestamp, temperatureTotal: 0, humidityTotal: 0, temperatureMin: point.temperature, temperatureMax: point.temperature, humidityMin: point.humidity, humidityMax: point.humidity, count: 0 };
    group.temperatureTotal += point.temperature;
    group.humidityTotal += point.humidity;
    group.temperatureMin = Math.min(group.temperatureMin, point.temperature);
    group.temperatureMax = Math.max(group.temperatureMax, point.temperature);
    group.humidityMin = Math.min(group.humidityMin, point.humidity);
    group.humidityMax = Math.max(group.humidityMax, point.humidity);
    group.count += 1;
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const timestamp = new Date(group.timestamp);
    return {
      timestamp: group.timestamp,
      label: period === "year" ? monthLabel.format(timestamp) : dayLabel.format(timestamp),
      temperature: aggregation === "min" ? group.temperatureMin : aggregation === "max" ? group.temperatureMax : group.temperatureTotal / group.count,
      humidity: aggregation === "min" ? group.humidityMin : aggregation === "max" ? group.humidityMax : group.humidityTotal / group.count,
    };
  });
}
