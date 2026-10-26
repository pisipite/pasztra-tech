import { isValidClimateValues } from "./climateValidity.mjs";

const HOUR_MS = 60 * 60_000;
const LOOKBACK_MS = 3 * HOUR_MS;
const FRESH_MS = HOUR_MS;
const TARGET_TOLERANCE_MS = 35 * 60_000;
const LATEST_TOLERANCE_MS = 30 * 60_000;
const MAX_SAMPLE_GAP_MS = HOUR_MS;

export function dewPointC(temperatureC, humidityPct) {
  if (!isValidClimateValues(temperatureC, humidityPct) || temperatureC <= -45 || temperatureC >= 80) return null;
  // Magnus approximation: the air's dew point, not a wall-surface temperature.
  const gamma = Math.log(humidityPct / 100) + 17.62 * temperatureC / (243.12 + temperatureC);
  const result = 243.12 * gamma / (17.62 - gamma);
  return Number.isFinite(result) ? result : null;
}

export function recentClimateChange(history, current, nowMs = Date.now()) {
  const currentMs = Date.parse(current?.updatedAt ?? "");
  if (!isValidClimateValues(current?.temperatureC, current?.humidityPct)
    || !Number.isFinite(currentMs) || !Number.isFinite(nowMs)
    || currentMs > nowMs + 5 * 60_000 || nowMs - currentMs > FRESH_MS) {
    return { status: "stale" };
  }

  const samples = (Array.isArray(history) ? history : [])
    .map((sample) => ({ ...sample, timeMs: Date.parse(sample?.timestamp ?? "") }))
    .filter((sample) => Number.isFinite(sample.timeMs)
      && sample.timeMs <= currentMs && isValidClimateValues(sample.temperature, sample.humidity))
    .sort((a, b) => a.timeMs - b.timeMs);
  const latest = samples.at(-1);
  if (!latest || currentMs - latest.timeMs > LATEST_TOLERANCE_MS
    || Math.abs(latest.temperature - current.temperatureC) > 0.11
    || Math.abs(latest.humidity - current.humidityPct) > 0.11) {
    return { status: "insufficient" };
  }

  const targetMs = currentMs - LOOKBACK_MS;
  const baseline = samples.reduce((best, sample) =>
    Math.abs(sample.timeMs - targetMs) < Math.abs((best?.timeMs ?? Infinity) - targetMs) ? sample : best, null);
  if (!baseline || Math.abs(baseline.timeMs - targetMs) > TARGET_TOLERANCE_MS) {
    return { status: "insufficient" };
  }
  const interval = samples.filter((sample) => sample.timeMs >= baseline.timeMs && sample.timeMs <= latest.timeMs);
  if (interval.some((sample, index) => index > 0 && sample.timeMs - interval[index - 1].timeMs > MAX_SAMPLE_GAP_MS)) {
    return { status: "insufficient" };
  }

  return {
    status: "ok",
    temperatureDeltaC: current.temperatureC - baseline.temperature,
    humidityDeltaPoints: current.humidityPct - baseline.humidity,
    from: new Date(baseline.timeMs).toISOString(),
    to: current.updatedAt,
  };
}
