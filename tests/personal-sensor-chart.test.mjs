import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { calendarDate } from "../shared/timeZone.mjs";

async function moduleUrl(path, replacements) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  let output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const [key, value] of Object.entries(replacements)) output = output.replaceAll(`"${key}"`, JSON.stringify(value));
  return `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
}
const timeUrl = new URL("../shared/timeZone.mjs", import.meta.url).href;
const dateUrl = await moduleUrl("../src/dateUtils.ts", { "./timeZone": timeUrl });
const sensorUrl = await moduleUrl("../src/blocks/personal-sensor/sensorData.ts", { "../../timeZone": timeUrl, "../../dateUtils": dateUrl });
const { sensorChartData, recentSensorTrend, localWeatherOutlook, precipitationOutlook } = await import(sensorUrl);
const points = [
  { timestamp: "2026-10-30T10:00:00Z", pm25: 0, temperature: 0, pressure: 1000 },
  { timestamp: "2026-10-30T10:10:00Z", pm25: 6, temperature: 2 },
  { timestamp: "2026-10-30T12:00:00Z", humidity: 50 },
  { timestamp: "2026-10-31T10:00:00Z", pm25: 99 },
];
const anchor = calendarDate(2026, 10, 30, 12);
const now = Date.parse("2026-10-30T13:00:00Z");

test("daily chart keeps real zero values and never adds missing or future points", () => {
  const result = sensorChartData(points, "day", anchor, "", "", now);
  assert.equal(result.resolution, "sample");
  assert.equal(result.data.length, 3);
  assert.equal(result.data[0].pm25, 0);
  assert.equal(result.data[0].temperature, 0);
  assert.equal(result.data[2].pm25, undefined);
});

test("weekly and monthly averages only use the available values", () => {
  const week = sensorChartData(points, "week", anchor, "", "", now);
  assert.equal(week.resolution, "hour");
  assert.equal(week.data[0].pm25, 3);
  assert.equal(week.data[0].temperature, 1);
  assert.equal(week.data[1].pm25, undefined);
  const month = sensorChartData(points, "month", anchor, "", "", now);
  assert.equal(month.resolution, "day");
  assert.equal(month.data[0].humidity, 50);
  assert.equal(month.data[0].pm25, 3);
});

test("one-hour change compares matching real samples and accepts zero Celsius", () => {
  const end = Date.parse("2026-10-30T12:00:00Z");
  const history = Array.from({ length: 7 }, (_, index) => {
    const timestamp = new Date(end - (6 - index) * 10 * 60_000).toISOString();
    return { timestamp, temperature: index, humidity: 60 - index, observedAt: { temperature: timestamp, humidity: timestamp } };
  });
  const latestTemp = { value: 6, timestamp: history.at(-1).observedAt.temperature };
  const latestHumidity = { value: 54, timestamp: history.at(-1).observedAt.humidity };
  assert.equal(recentSensorTrend(history, "temperature", latestTemp, end).delta, 6);
  assert.equal(recentSensorTrend(history, "humidity", latestHumidity, end).delta, -6);
  assert.equal(recentSensorTrend(history, "temperature", { ...latestTemp, value: 0 }, end), null, "the displayed value must match the latest stored measurement");
  assert.equal(recentSensorTrend(history, "temperature", latestTemp, end + 31 * 60_000), null, "stale measurements do not get a current arrow");
  assert.equal(recentSensorTrend(history, "temperature", latestTemp, end - 1), null, "future samples are rejected");
  assert.equal(recentSensorTrend(history.filter((_, index) => index < 2 || index > 4), "temperature", latestTemp, end), null, "large gaps suppress the trend");
  assert.equal(recentSensorTrend(history.slice(2), "temperature", latestTemp, end), null, "the baseline must be close to an hour ago");
  assert.equal(recentSensorTrend(history.map(({ observedAt, ...point }) => point), "temperature", latestTemp, end), null, "bucket time is not the real measurement time");
});

test("local outlook requires a fresh, well-covered three-hour pressure history", () => {
  const end = Date.parse("2026-10-30T12:00:00Z");
  const points = Array.from({ length: 19 }, (_, index) => {
    const timestamp = new Date(end - (18 - index) * 10 * 60_000).toISOString();
    return { timestamp, pressure: 1000 - index / 10, temperature: 10 + index / 10, humidity: 60 - index / 2,
      observedAt: { pressure: timestamp, temperature: timestamp, humidity: timestamp } };
  });
  const timestamp = points.at(-1).timestamp;
  const latest = { pressure: { value: 998.2, timestamp }, temperature: { value: 11.8, timestamp }, humidity: { value: 51, timestamp } };
  const text = localWeatherOutlook(points, latest, end);
  assert.match(text, /légnyomás csökkent/);
  assert.match(text, /melegedett/);
  assert.match(text, /csökkent a páratartalom/);
  assert.match(text, /nem csapadék-előrejelzés/);
  assert.match(localWeatherOutlook(points.slice(5), latest, end), /Nincs elegendő/);
  assert.match(localWeatherOutlook(points, latest, end + 31 * 60_000), /Nincs elegendő/);
  assert.match(localWeatherOutlook(points.filter((_, i) => i < 5 || i > 10), latest, end), /Nincs elegendő/);
});

test("precipitation uses a verified next full hour, preserving zero and rejecting stale or missing forecasts", () => {
  const now = Date.parse("2026-11-10T12:20:00Z");
  const forecast = { updatedAt: new Date(now).toISOString(), days: [{ points: [
    { timestamp: "2026-11-10T13:00:00Z", precipitationProbabilityPct: 80, precipitationProbabilityVerified: true },
    { timestamp: "2026-11-10T14:00:00Z", precipitationProbabilityPct: 0, precipitationProbabilityVerified: true },
  ] }] };
  assert.deepEqual(precipitationOutlook([], {}, forecast, now).interval, { start: Date.parse("2026-11-10T13:00:00Z"), end: Date.parse("2026-11-10T14:00:00Z"), probability: 0 });
  assert.equal(precipitationOutlook([], {}, forecast, now + 7 * 3_600_000).interval, null);
  assert.equal(precipitationOutlook([], {}, { ...forecast, days: [{ points: [{ timestamp: "2026-11-10T14:00:00Z", precipitationProbabilityPct: null, precipitationProbabilityVerified: true }] }] }, now).interval, null);
  assert.equal(precipitationOutlook([], {}, { ...forecast, days: [{ points: [{ timestamp: "2026-11-10T14:00:00Z", precipitationProbabilityPct: 0 }] }] }, now).interval, null, "old ambiguous zero is not treated as a verified forecast");
});
