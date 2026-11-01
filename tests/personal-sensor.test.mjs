import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { fetchPersonalSensor, mergePersonalSensorPoints, parsePersonalSensorCsv, personalSensorArchivePaths } from "../scripts/personal-sensor.mjs";

const chip = "esp8266-13753058";
const header = "Time;SDS_P1;SDS_P2;BME280_temperature;BME280_humidity;BME280_pressure\n";
const csv = header + "2026/10/30 20:04:43;14.98;4.75;0;42.63;101333.81\n2026/10/30 20:07:09;;;1.5;43.85;101333.75\n";
const todayPath = `data_csv/csv-files/2026-10-30/data-${chip}-2026-10-30.csv`;
const zipPath = `data_csv/2026/09/data-${chip}-2026-09.zip`;
const html = `<a href='${todayPath}'>today</a><a href='${zipPath}'>history</a><a href='https://bad.test/${todayPath}'>bad</a>`;
const now = new Date("2026-10-30T20:08:00Z");

test("SDS and BME values, UTC and pressure units are parsed without inventing zeros", () => {
  const rows = parsePersonalSensorCsv(csv);
  assert.equal(rows[0].timestamp, "2026-10-30T20:04:43.000Z");
  assert.equal(rows[0].pm10, 14.98);
  assert.equal(rows[0].pm25, 4.75);
  assert.equal(rows[0].temperature, 0);
  assert.ok(Math.abs(rows[0].pressure - 1013.3381) < 1e-8);
  assert.equal(rows[1].pm10, null);
  assert.throws(() => parsePersonalSensorCsv("<html>error</html>"));
});

test("only exact paths for the requested chip and date are accepted", () => {
  assert.deepEqual(personalSensorArchivePaths(html), [todayPath, zipPath]);
  assert.deepEqual(personalSensorArchivePaths(`<a href='data_csv/csv-files/2026-10-30/data-esp8266-000-2026-10-30.csv'>x</a>`), []);
});

test("each metric keeps its own real observation timestamp inside a bucket", () => {
  const points = mergePersonalSensorPoints([parsePersonalSensorCsv(csv)], now);
  assert.equal(points.length, 1);
  assert.equal(points[0].pm25, 4.75);
  assert.equal(points[0].temperature, 1.5);
  assert.equal(points[0].observedAt.pm25, "2026-10-30T20:04:43.000Z");
  assert.equal(points[0].observedAt.temperature, "2026-10-30T20:07:09.000Z");
});

test("invalid cached values do not become measurements", () => {
  const points = mergePersonalSensorPoints([[{ timestamp: now.toISOString(), pm25: false, pm10: -1, humidity: 140, temperature: 0 }]], now);
  assert.equal(points.length, 1);
  assert.equal(points[0].temperature, 0);
  assert.equal(points[0].pm25, undefined);
  assert.equal(points[0].pm10, undefined);
  assert.equal(points[0].humidity, undefined);
});

test("a different chip's cached data is never attributed to this sensor", async () => {
  const root = await mkdtemp(join(tmpdir(), "personal-sensor-other-"));
  const historyFile = join(root, "history.json"), outputFile = join(root, "public.json");
  await writeFile(historyFile, JSON.stringify({ sensorId: "esp8266-other", points: [{ timestamp: now.toISOString(), pm25: 12 }] }));
  const result = await fetchPersonalSensor(now, { historyFile, outputFile, fetchImpl: async () => { throw new Error("offline"); } });
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.points, []);
});

test("collector backfills the archive and preserves measurements during an outage", async () => {
  const root = await mkdtemp(join(tmpdir(), "personal-sensor-"));
  const historyFile = join(root, "history.json"), outputFile = join(root, "public.json");
  const archive = zipSync({ "data.csv": strToU8(header + "2026/09/02 12:00:00;4;2;17;60;100000\n") });
  const fetchImpl = async (url) => {
    const path = String(url);
    if (path.includes("csvfiles.php")) return new Response(html);
    if (path.endsWith(todayPath)) return new Response(csv);
    if (path.endsWith(zipPath)) return new Response(archive);
    throw new Error("Unexpected URL");
  };
  const first = await fetchPersonalSensor(now, { historyFile, outputFile, fetchImpl });
  assert.equal(first.status, "ok");
  assert.equal(first.points.length, 2);
  assert.equal(first.latest.pm25.value, 4.75);
  assert.equal(first.latest.temperature.value, 1.5);
  assert.equal(first.collection.archiveChecks[zipPath], true);
  const second = await fetchPersonalSensor(new Date(now.getTime() + 60_000), { historyFile, outputFile, fetchImpl: async () => { throw new Error("offline"); } });
  assert.equal(second.status, "stale");
  assert.equal(second.points.length, 2);
  assert.equal(JSON.parse(await readFile(outputFile, "utf8")).latest.pm25.value, 4.75);
});
