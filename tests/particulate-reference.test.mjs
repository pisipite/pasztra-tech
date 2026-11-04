import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { addCalendarDays, calendarDate } from "../shared/timeZone.mjs";

const source = await readFile(new URL("../src/blocks/personal-sensor/particulateReference.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  .replaceAll('"../../timeZone"', JSON.stringify(new URL("../shared/timeZone.mjs", import.meta.url).href));
const moduleUrl = `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
const { lastDailyParticulate, pm10DailyLimit, pm10LimitForDay, PARTICULATE_LIMITS, WHO_PM25_DAILY_GUIDELINE } = await import(moduleUrl);
const lastDailyPm10 = (points, ...args) => lastDailyParticulate(points, "pm10", ...args);
const INTERVAL = 10 * 60_000;

function sample(start, slot, value, observedOffset = 5 * 60_000) {
  const timestamp = new Date(start + slot * INTERVAL).toISOString();
  return { timestamp, pm10: value, observedAt: { pm10: new Date(start + slot * INTERVAL + observedOffset).toISOString() } };
}

test("compares only a closed Bulgarian day with at least 75% independent 10-minute samples", () => {
  const start = calendarDate(2026, 11, 2).getTime();
  const end = addCalendarDays(start, 1).getTime();
  const points = Array.from({ length: 108 }, (_, slot) => sample(start, slot, slot ? 12 : 0));
  const result = lastDailyPm10(points, start, end, end);
  assert.equal(result.dayStart, start);
  assert.equal(result.expectedSlots, 144);
  assert.equal(result.sampleCount, 108);
  assert.equal(result.coverage, .75);
  assert.ok(Math.abs(result.average - 12 * 107 / 108) < 1e-10, "real zero is included");
  assert.equal(lastDailyPm10(points.slice(1), start, end, end).average, null);
  assert.equal(lastDailyPm10(points, start, end, end - 1).average, null, "a day in progress is never compared");
  assert.equal(lastDailyPm10(points, start, end, end - 1).dayStart, null);
});

test("daily coverage ignores invalid readings, duplicate slots and invalid observation timestamps", () => {
  const start = calendarDate(2026, 11, 2).getTime();
  const end = addCalendarDays(start, 1).getTime();
  const points = Array.from({ length: 108 }, (_, slot) => sample(start, slot, 10));
  points.push(sample(start, 0, 20, 6 * 60_000));
  points.push(sample(start, 0, 99, 4 * 60_000));
  points.push(sample(start, 108, -10));
  points.push(sample(start, 109, 100, 11 * 60_000));
  points.push({ timestamp: new Date(start + 110 * INTERVAL).toISOString(), pm10: null });
  const result = lastDailyPm10(points, start, end, end);
  assert.equal(result.sampleCount, 108);
  assert.ok(Math.abs(result.average - 1090 / 108) < 1e-10);
});

test("a broader period uses its most recent closed day, not an earlier convenient measurement", () => {
  const start = calendarDate(2026, 11, 1).getTime();
  const secondDay = addCalendarDays(start, 1).getTime();
  const currentDay = addCalendarDays(start, 2).getTime();
  const end = addCalendarDays(start, 7).getTime();
  const points = Array.from({ length: 144 }, (_, slot) => sample(start, slot, 10));
  const result = lastDailyPm10(points, start, end, currentDay + 2 * 3_600_000);
  assert.equal(result.dayStart, secondDay);
  assert.equal(result.coverage, 0);
  assert.equal(result.average, null, "older complete days must not conceal the latest day's outage");
});

test("Bulgarian summer-time changes have 138 and 150 ten-minute slots", () => {
  for (const [month, day, expected] of [[3, 29, 138], [10, 25, 150]]) {
    const start = calendarDate(2026, month, day).getTime();
    const end = addCalendarDays(start, 1).getTime();
    const points = Array.from({ length: expected }, (_, slot) => sample(start, slot, 25));
    const result = lastDailyPm10(points, start, end, end);
    assert.equal(result.expectedSlots, expected);
    assert.equal(result.coverage, 1);
    assert.equal(result.average, 25);
  }
});

test("PM2.5 and PM10 are averaged independently and require their own 75% coverage", () => {
  const start = calendarDate(2026, 11, 2).getTime();
  const end = addCalendarDays(start, 1).getTime();
  const points = Array.from({ length: 108 }, (_, slot) => {
    const point = sample(start, slot, 12);
    return { ...point, pm25: slot ? 4 : 0, observedAt: { ...point.observedAt, pm25: point.observedAt.pm10 } };
  });
  const fine = lastDailyParticulate(points, "pm25", start, end, end);
  const coarse = lastDailyParticulate(points, "pm10", start, end, end);
  assert.equal(fine.dayStart, start);
  assert.equal(fine.coverage, .75);
  assert.ok(Math.abs(fine.average - 4 * 107 / 108) < 1e-10, "PM2.5 zero is a real sample");
  assert.equal(coarse.average, 12);
  points[0].pm25 = -1;
  assert.equal(lastDailyParticulate(points, "pm25", start, end, end).average, null);
  assert.equal(lastDailyParticulate(points, "pm10", start, end, end).average, 12, "missing PM2.5 does not discard valid PM10");
  assert.equal(lastDailyParticulate(points, "pm25", start, end, end - 1).dayStart, null, "a partial day has no daily comparison");
});

test("EU limits switch on the Bulgarian measurement day's calendar year", () => {
  assert.equal(pm10LimitForDay(calendarDate(2029, 12, 31).getTime()).pm10Daily, 50);
  assert.equal(pm10LimitForDay(calendarDate(2030, 1, 1).getTime()).pm10Daily, 45);
  assert.equal(pm10DailyLimit(2029).pm10Days, 35);
  assert.equal(pm10DailyLimit(2030).pm10Days, 18);
  assert.equal(PARTICULATE_LIMITS.current.pm25Annual, 25);
  assert.equal(PARTICULATE_LIMITS.from2030.pm25Annual, 10);
  assert.equal(PARTICULATE_LIMITS.bulgarianIndicativePm25Annual, 20);
  assert.equal(WHO_PM25_DAILY_GUIDELINE, 15);
});
