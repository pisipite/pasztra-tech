import { timestampInPeriod } from "./dateUtils";
import { dateKey, dateTimeFormatter, parseLocalDateTime } from "./timeZone";
import type { ClimatePoint, PeriodKey } from "./types";

const dayLabel = dateTimeFormatter({ month: "short", day: "numeric" });
const monthLabel = dateTimeFormatter({ month: "short" });

export type ClimateAggregation = "min" | "average" | "max";

export function isValidClimateValues(temperature: unknown, humidity: unknown) {
  return typeof temperature === "number"
    && Number.isFinite(temperature)
    && temperature !== 0
    && typeof humidity === "number"
    && Number.isFinite(humidity)
    && humidity !== 0;
}

export function climatePointsForPeriod(
  history: ClimatePoint[],
  period: PeriodKey,
  anchor: Date,
  customStart: string,
  customEnd: string,
  aggregation: ClimateAggregation = "average",
) {
  const filtered = history.filter((point) => isValidClimateValues(point.temperature, point.humidity)
    && timestampInPeriod(point.timestamp, period, anchor, customStart, customEnd));
  if (period === "day" || filtered.some((point) => !point.timestamp)) return filtered;

  const groups = new Map<string, { timestamp: string; temperatureTotal: number; humidityTotal: number; temperatureMin: number; temperatureMax: number; humidityMin: number; humidityMax: number; count: number }>();
  for (const point of filtered) {
    const key = dateKey(point.timestamp!).slice(0, period === "year" ? 7 : 10);
    const timestamp = parseLocalDateTime(`${key}${period === "year" ? "-01" : ""}T12:00:00`).toISOString();
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
