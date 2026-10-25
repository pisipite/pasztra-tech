import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { isValidClimateValues } from "../shared/climateValidity.mjs";
import { integratePowerDay, batteryFlowKw } from "../scripts/sungrow-power.mjs";

async function importTs(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}
const { observedPoints, observationSegments, latestObservation, recentSoc, connectedSampleGap } = await importTs("../src/observationQuality.ts");
const { householdSummary } = await importTs("../src/blocks/bulgaria-energy/householdSummary.ts");
const at = (minute) => new Date(Date.UTC(2026, 9, 24, 9, minute)).toISOString();

test("freezing and subzero temperatures are valid, missing values are not", () => {
  assert.equal(isValidClimateValues(0, 45), true);
  assert.equal(isValidClimateValues(-12, 100), true);
  for (const [temperature, humidity] of [[0, 0], [null, 50], [undefined, 50], [NaN, 50], [12, 101]]) {
    assert.equal(isValidClimateValues(temperature, humidity), false);
  }
});

test("future zeros are excluded at the earlier of collection time and now", () => {
  const points = [0, 5, 10, 15].map((minute) => ({ timestamp: at(minute), pv: 0 }));
  assert.deepEqual(observedPoints(points, at(5), Date.parse(at(10))), points.slice(0, 2));
  assert.deepEqual(observedPoints(points, at(15), Date.parse(at(10))), points.slice(0, 3));
  assert.deepEqual(observedPoints([{ pv: 0 }, { timestamp: "bad", pv: 0 }]), []);
});

test("line paths preserve measured zero but break at nulls and missing time slots", () => {
  const points = [[0, 0], [5, 1], [10, null], [15, 2], [55, 3]].map(([minute, value]) => ({ timestamp: at(minute), value }));
  assert.deepEqual(observationSegments(points, (point) => point.value, 15 * 60_000).map((segment) => segment.map((entry) => entry.value)), [[0, 1], [2], [3]]);
  assert.equal(latestObservation(points, (point) => Number.isFinite(point.value), Date.parse(at(20))), at(15));
});

test("hourly energy and three-hourly climate samples connect; outages still split", () => {
  const hourly = [0, 60, 120, 180].map((minute) => ({ timestamp: at(minute), value: 0 }));
  const energyGap = connectedSampleGap(hourly, 15 * 60_000, 3 * 3_600_000);
  assert.equal(energyGap, 90 * 60_000);
  assert.equal(observationSegments(hourly, (point) => point.value, energyGap).length, 1);

  const climate = [0, 180, 360, 540].map((minute) => ({ timestamp: at(minute), value: 20 }));
  const climateGap = connectedSampleGap(climate, 30 * 60_000, 6 * 3_600_000);
  assert.equal(climateGap, 4.5 * 3_600_000);
  assert.equal(observationSegments(climate, (point) => point.value, climateGap).length, 1);

  const outage = [hourly[0], hourly[1], { timestamp: at(120), value: undefined }, hourly[3], { timestamp: at(240), value: 0 }];
  assert.deepEqual(observationSegments(outage, (point) => point.value, energyGap).map((segment) => segment.length), [2, 2]);
  assert.equal(connectedSampleGap([hourly[0], hourly[1], { timestamp: at(360), value: 0 }], 15 * 60_000, 3 * 3_600_000), 90 * 60_000);
});

test("missing grid or battery cannot imply an all-solar household", () => {
  for (const point of [{ load: 1.8 }, { load: 1.8, gridPurchase: 0 }, { load: 1.8, batteryDischarge: 0 }]) {
    const summary = householdSummary([point], false);
    assert.equal(summary.hasLoad, true);
    assert.equal(summary.load, 1.8);
    assert.equal(summary.hasBreakdown, false);
  }
});

test("explicit zero counters remain usable and absence stays distinct from zero", () => {
  const summary = householdSummary([{ load: 1.8, gridPurchase: 0, batteryDischarge: 0 }], false);
  assert.equal(summary.hasBreakdown, true);
  assert.equal(summary.directPv, 1.8);
  assert.equal(householdSummary([{ load: 0, gridPurchase: 0, batteryDischarge: 0 }], false).hasLoad, true);
  assert.equal(householdSummary([{}], false).hasLoad, false);
});

test("source shares are withheld when reported supply exceeds consumption", () => {
  const summary = householdSummary([{ load: 2, gridPurchase: 2, batteryDischarge: 1 }], false);
  assert.equal(summary.hasLoad, true);
  assert.equal(summary.hasBreakdown, false);
});

test("official energy totals are used directly, without power reintegration", () => {
  const summary = householdSummary([{ load: 102.2, gridPurchase: 4.6, batteryDischarge: 40.6 }], false);
  assert.equal(summary.load, 102.2);
  assert.ok(Math.abs(summary.directPv - 57) < 1e-9);
  assert.equal(summary.estimated, false);
});

test("power integration neither bridges outages nor stretches a partial day to 24 hours", () => {
  const points = [0, 5, 55].map((minute) => ({ timestamp: at(minute), load: 2, grid: 1, battery: 0 }));
  const summary = householdSummary(points, true);
  assert.ok(Math.abs(summary.load - 2 / 12) < 1e-9);
  assert.equal(summary.hasBreakdown, false);
  assert.equal(summary.estimated, true);
  const complete = [0, 5, 10].map((minute) => ({ timestamp: at(minute), pv: 3, load: 2 }));
  assert.deepEqual(integratePowerDay(complete), { pv: .5, load: .333 });
  assert.deepEqual(integratePowerDay(points), {});
  assert.equal(batteryFlowKw(undefined, 1, .5, .2), .2);
  assert.equal(batteryFlowKw(undefined, 1, .5, undefined), undefined);
});

test("planner SOC must be recent and observed, including a legitimate 0 percent", () => {
  const points = [{ timestamp: at(0), batterySoc: 0 }, { timestamp: at(55), batterySoc: 90 }];
  assert.equal(recentSoc(points, Date.parse(at(20))).batterySoc, 0);
  assert.equal(recentSoc(points, Date.parse(at(50))), undefined);
  assert.equal(recentSoc([{ batterySoc: 80 }], Date.parse(at(20))), undefined);
});
