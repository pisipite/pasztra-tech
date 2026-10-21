import assert from "node:assert/strict";
import test from "node:test";
import {
  SUNGROW_FLOW_SCHEMA, powerKw, powerKwList, extractDeviceSamples,
  batteryFlowKw, isCurrentSungrowDay,
} from "../scripts/sungrow-power.mjs";

const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} ≠ ${expected}`);
const parseTimestamp = (value) => Number.isFinite(Date.parse(value)) ? new Date(value) : null;

test("80 W import and 92 W export never become 80–92 kW, even on quiet days", () => {
  assert.deepEqual(powerKwList([0, 80, -92, 0], "W"), [0, 0.08, -0.092, 0]);
});

test("the scale is independent of other samples and the old 100 threshold", () => {
  for (const last of [0, 99, 100, 101, 2500]) {
    const result = powerKwList([80, last], "W");
    assert.equal(result[0], 0.08);
    closeTo(result[1], last / 1000);
  }
});

test("actual kW data is neither divided again nor clipped, including large values", () => {
  assert.deepEqual(powerKwList([0, 0.08, -0.092, 80, 100, 101, 2500], "kW"),
    [0, 0.08, -0.092, 80, 100, 101, 2500]);
  assert.equal(powerKw(1.5, "MW"), 1500);
});

test("October 19 power balance: 80 W import does not invent 78 kW charging", () => {
  const grid = powerKw(80, "W");
  closeTo(batteryFlowKw(0, 1.754, grid), 1.674);
});

test("October 20 power balance: 92 W export does not invent 93 kW discharge", () => {
  const grid = powerKw(-92, "W");
  closeTo(batteryFlowKw(0, 1.264, grid), 1.356);
});

test("battery charge and discharge use their own units, not a combined maximum", () => {
  const samples = [{ time_stamp: "2026-10-19T05:20:00Z", points: {
    p13126: { value: 80, unit: "W" },
    p13150: { value: 0.092, unit: "kW" },
    p13141: { value: 65.8, unit: "%" },
  } }];
  const [point] = extractDeviceSamples({ result_data: { data: samples } },
    { p13126: "chargeKw", p13150: "dischargeKw", p13141: "soc" }, parseTimestamp);
  assert.equal(point.chargeKw, 0.08);
  assert.equal(point.dischargeKw, 0.092);
  assert.equal(point.soc, 65.8);
  assert.equal(point.socUnit, "%");
  assert.equal(point.timestamp, "2026-10-19T05:20:00.000Z");
  assert.equal(samples[0].points.p13126.value, 80, "input remains unchanged");
});

test("PV/load power lists respect declared units and preserve missing positions", () => {
  const values = powerKwList([80, null, "", "--", { valid: false, value_float: 0 }, 100], "W");
  assert.equal(values.length, 6);
  assert.equal(values[0], 0.08);
  assert.ok(values.slice(1, 5).every(Number.isNaN));
  assert.equal(values[5], 0.1);
});

test("GoSungrow scalar wrappers and explicit per-value units are supported", () => {
  assert.equal(powerKw({ value_float: 80 }, { string: "W" }), 0.08);
  assert.equal(powerKw({ value: 0.08, unit: "kW" }, "W"), 0.08);
  assert.equal(powerKw({ value_string: "-92" }, " w "), -0.092);
});

test("unknown units fail visibly rather than guessing from the amount", () => {
  for (const unit of [undefined, "", "Wh", "%", "unexpected"]) {
    assert.throws(() => powerKw(80, unit), /mértékegység/);
    assert.throws(() => extractDeviceSamples([
      { time_stamp: "2026-10-19T05:20:00Z", p8018: { value: 80, unit } },
    ], { p8018: "gridKw" }, parseTimestamp), /mértékegység/);
  }
  assert.ok(Number.isNaN(powerKw(undefined, "W")));
});

test("historical grid samples may alternate W and kW; each uses its own unit", () => {
  const samples = extractDeviceSamples({ data: [
    { time_stamp: "2026-10-19T05:25:00Z", points: { p8018: { value: -92, unit: "W" } } },
    { time_stamp: "2026-10-19T05:15:00Z", points: { p8018: { value: 0.08, unit: "kW" } } },
    { time_stamp: "2026-10-19T05:20:00Z", points: { p8018: { value: 80, unit: "W" } } },
  ] }, { p8018: "gridKw" }, parseTimestamp);
  assert.deepEqual(samples.map((point) => point.gridKw), [0.08, 0.08, -0.092]);
  assert.deepEqual(extractDeviceSamples({ result_data: [] }, { p8018: "gridKw" }, parseTimestamp), []);
});

test("raw provider rows and missing readings do not generate zero measurements", () => {
  const result = extractDeviceSamples({ result_data: [
    { time_stamp: "2026-10-19T05:20:00Z", p8018: { value: 80, unit: "W" } },
    { time_stamp: "2026-10-19T05:25:00Z", p8018: { value: "--", unit: "W" } },
    { time_stamp: "2026-10-19T05:30:00Z", p8018: { value: null, unit: "W" } },
  ] }, { p8018: "gridKw" }, parseTimestamp);
  assert.equal(result.length, 1);
  assert.equal(result[0].gridKw, 0.08);
});

test("missing grid retains measured battery flow instead of inventing a zero grid", () => {
  assert.equal(batteryFlowKw(0, 1.7, undefined, 1.6), 1.6);
  assert.equal(batteryFlowKw(0, 1.7, Number.NaN, undefined), undefined);
});

test("old daily caches require re-fetching, current nonempty caches remain reusable", () => {
  const energyChart = [{ grid: 80, battery: -78.246 }];
  assert.equal(isCurrentSungrowDay({ flowSchema: 2, energyChart }), false);
  assert.equal(isCurrentSungrowDay({ energyChart }), false);
  assert.equal(isCurrentSungrowDay(null), false);
  assert.equal(isCurrentSungrowDay({ flowSchema: SUNGROW_FLOW_SCHEMA, energyChart: [] }), false);
  assert.equal(isCurrentSungrowDay({
    flowSchema: SUNGROW_FLOW_SCHEMA, energyChart: [{ grid: 0.08, battery: 1.674 }],
  }), true);
});
