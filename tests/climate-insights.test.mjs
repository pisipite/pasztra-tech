import assert from "node:assert/strict";
import test from "node:test";
import { dewPointC, recentClimateChange } from "../shared/climateInsights.mjs";

const NOW = Date.parse("2026-10-26T12:00:00Z");
const current = { temperatureC: 21.5, humidityPct: 58, updatedAt: new Date(NOW).toISOString() };
const history = Array.from({ length: 10 }, (_, index) => ({
  timestamp: new Date(NOW - (9 - index) * 20 * 60_000).toISOString(),
  temperature: index === 0 ? 22.1 : index === 9 ? 21.5 : 22,
  humidity: index === 0 ? 54 : index === 9 ? 58 : 56,
}));

test("dew point is a finite estimate from temperature and relative humidity", () => {
  assert.ok(Math.abs(dewPointC(20, 50) - 9.3) < 0.15);
  assert.equal(dewPointC(0, 100), 0, "zero Celsius is a valid reading");
  assert.equal(dewPointC(20, 0), null);
  assert.equal(dewPointC(Number.NaN, 50), null);
});

test("three-hour changes use actual covered, matching climate samples", () => {
  const change = recentClimateChange(history, current, NOW);
  assert.equal(change.status, "ok");
  assert.ok(Math.abs(change.temperatureDeltaC + 0.6) < 1e-10);
  assert.equal(change.humidityDeltaPoints, 4);
  assert.equal(change.from, history[0].timestamp);
});

test("missing endpoints, gaps and mismatched current readings do not create trends", () => {
  assert.equal(recentClimateChange(history.slice(2), current, NOW).status, "insufficient");
  assert.equal(recentClimateChange(history.filter((_, index) => index < 2 || index > 7), current, NOW).status, "insufficient");
  assert.equal(recentClimateChange(history, { ...current, temperatureC: 24 }, NOW).status, "insufficient");
  assert.equal(recentClimateChange(history, current, NOW + 61 * 60_000).status, "stale");
  assert.equal(recentClimateChange(history, current, NOW - 6 * 60_000).status, "stale");
});
