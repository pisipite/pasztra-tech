import type { SolarForecastPoint } from "../../types";

// Forecast points represent hourly model intervals, not observed readings.
export function remainingForecast(points: SolarForecastPoint[], now: number, baseLoadKw: number) {
  let energyKwh = 0, surplusKwh = 0, hours = 0;
  const intervals = points.flatMap((point) => {
    const start = Date.parse(point.timestamp), end = start + 3_600_000;
    if (!Number.isFinite(start) || !Number.isFinite(point.expectedPowerKw) || end <= now) return [];
    const from = Math.max(start, now), duration = (end - from) / 3_600_000;
    energyKwh += Math.max(0, point.expectedPowerKw) * duration;
    surplusKwh += Math.max(0, point.expectedPowerKw - baseLoadKw) * duration;
    hours += duration;
    return [{ from, end, surplus: Math.max(0, point.expectedPowerKw - baseLoadKw) * duration }];
  });
  const best = intervals.reduce<typeof intervals[number] | undefined>((best, item) => !best || item.surplus > best.surplus ? item : best, undefined);
  return { energyKwh, surplusKwh, hours, best: best && best.surplus > 0 ? best : undefined };
}
