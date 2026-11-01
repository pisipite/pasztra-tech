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
const { sensorChartData, recentSensorTrend } = await import(sensorUrl);
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
