import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fetchAirQuality, measurementTimestamp, mergeAirQualityStations, parseAirQualityApi, parseAirQualityArchive } from "../scripts/air-quality.mjs";

const now = new Date("2026-10-02T12:00:00Z");
const raw = (overrides = {}) => ({
  timestamp: "2026-10-02 11:59:01",
  location: { latitude: "42.266", longitude: "23.110", indoor: 0, country: "BG" },
  sensor: { id: 43449, sensor_type: { name: "SDS011" } },
  sensordatavalues: [{ value_type: "P1", value: "3.28" }, { value_type: "P2", value: "2.60" }],
  ...overrides,
});
const station = parseAirQualityApi([raw()])[0];
const csv = "sensor_id;sensor_type;location;lat;lon;timestamp;P1;durP1;ratioP1;P2;durP2;ratioP2\n43449;SDS011;29041;42.266;23.110;2026-10-01T00:01:31;3.28;;;2.60;;\n";

async function isolatedOptions(t, extra = {}) {
  const directory = await mkdtemp(join(tmpdir(), "rila-air-quality-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { historyFile: join(directory, "history.json"), outputFile: join(directory, "public.json"), historyUrl: "", archiveDays: 0, ...extra };
}

test("UTC timestamps preserve the actual observation time", () => {
  assert.equal(measurementTimestamp("2026-10-02 11:59:01"), "2026-10-02T11:59:01.000Z");
  assert.equal(measurementTimestamp("2026-10-02T14:59:01+03:00"), "2026-10-02T11:59:01.000Z");
  assert.equal(measurementTimestamp("not a date"), null);
  assert.equal(measurementTimestamp(null), null);
});

test("API uses outdoor regional P1/PM10 and P2/PM2.5 measurements only", () => {
  const parsed = parseAirQualityApi([
    raw(),
    raw({ location: { ...raw().location, indoor: 1 } }),
    raw({ location: { ...raw().location, latitude: "43" } }),
    raw({ sensordatavalues: [{ value_type: "temperature", value: "18" }] }),
  ]);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, "43449");
  assert.equal(parsed[0].townId, "dupnitsa");
  assert.deepEqual(parsed[0].points, [{ timestamp: "2026-10-02T11:59:01.000Z", pm10: 3.28, pm25: 2.6 }]);
});

test("missing, invalid and negative particle values stay missing, while zero is valid", () => {
  for (const missing of [null, "", " ", "NaN", "-1", false]) {
    const parsed = parseAirQualityApi([raw({ sensordatavalues: [{ value_type: "P1", value: missing }, { value_type: "P2", value: "0" }] })]);
    assert.deepEqual(parsed[0].points[0], { timestamp: "2026-10-02T11:59:01.000Z", pm10: null, pm25: 0 });
  }
});

test("history retains at most one actual sample per 20-minute slot and expires old or future data", () => {
  const history = { ...station, points: [
    { timestamp: "2025-09-20T00:00:00Z", pm10: 100, pm25: 100 },
    { timestamp: "2026-10-02T12:01:00Z", pm10: 100, pm25: 100 },
    { timestamp: "2026-10-02T11:42:00Z", pm10: 10, pm25: 5 },
    { timestamp: "2026-10-02T11:22:00Z", pm10: 8, pm25: null },
  ] };
  const result = mergeAirQualityStations([[history], [station], [station]], now);
  assert.deepEqual(result[0].points, [
    { timestamp: "2026-10-02T11:22:00.000Z", pm10: 8, pm25: null },
    { timestamp: "2026-10-02T11:59:01.000Z", pm10: 3.28, pm25: 2.6 },
  ]);
});

test("archive CSV rejects foreign sensors and distant historical locations", () => {
  const mixed = `${csv}43450;SDS011;29041;42.266;23.110;2026-10-01T00:02:31;999;;;999;;\n43449;SDS011;29041;42.350;23.550;2026-10-01T00:03:31;999;;;999;;\n`;
  const parsed = parseAirQualityArchive(mixed, station);
  assert.deepEqual(parsed.points, [{ timestamp: "2026-10-01T00:01:31.000Z", pm10: 3.28, pm25: 2.6 }]);
  assert.throws(() => parseAirQualityArchive("<!doctype html>", station));
});

test("an API outage publishes retained measurements with stale status and original update time", async (t) => {
  const options = await isolatedOptions(t, { fetchImpl: async () => { throw new Error("offline"); } });
  await writeFile(options.historyFile, JSON.stringify({ stations: [station] }));
  const result = await fetchAirQuality(now, options);
  assert.equal(result.status, "stale");
  assert.equal(result.updatedAt, "2026-10-02T11:59:01.000Z");
  assert.equal(result.checkedAt, now.toISOString());
  assert.equal(result.error, "offline");
  assert.equal(result.coverage.sampleCount, 1);
  assert.deepEqual(JSON.parse(await readFile(options.outputFile, "utf8")), result);
});

test("a complete outage without history publishes an explicit empty state", async (t) => {
  const options = await isolatedOptions(t, { fetchImpl: async () => { throw new Error("offline"); } });
  const result = await fetchAirQuality(now, options);
  assert.equal(result.source, "measured");
  assert.equal(result.status, "unavailable");
  assert.equal(result.updatedAt, null);
  assert.deepEqual(result.stations, []);
  assert.equal(result.coverage.sampleCount, 0);
});

test("published history restores the cache and completed archive days are not fetched again", async (t) => {
  let archiveRequests = 0;
  const historyUrl = "https://example.test/air-quality.json";
  const options = await isolatedOptions(t, { historyUrl, archiveDays: 1, fetchImpl: async (url) => {
    if (url === historyUrl) return { ok: true, json: async () => ({ stations: [station] }) };
    if (url.includes("archive.sensor.community")) {
      archiveRequests += 1;
      return { ok: true, text: async () => csv };
    }
    return { ok: true, json: async () => [raw()] };
  } });
  const first = await fetchAirQuality(now, options);
  assert.equal(first.status, "ok");
  assert.equal(first.stations[0].points.length, 2);
  assert.equal(first.coverage.archiveDays, 1);
  const second = await fetchAirQuality(now, options);
  assert.equal(archiveRequests, 1);
  assert.deepEqual(second.stations, first.stations);
});

test("a failed archive request remains retryable instead of becoming a completed day", async (t) => {
  let archiveRequests = 0;
  const options = await isolatedOptions(t, { archiveDays: 1, fetchImpl: async (url) => {
    if (url.includes("archive.sensor.community")) {
      archiveRequests += 1;
      return archiveRequests === 1 ? { ok: false, status: 404 } : { ok: true, text: async () => csv };
    }
    return { ok: true, json: async () => [raw()] };
  } });
  const first = await fetchAirQuality(now, options);
  assert.equal(first.collection.archiveChecks["43449/2026-10-01"].status, "failed");
  await fetchAirQuality(new Date("2026-10-02T13:00:00Z"), options);
  assert.equal(archiveRequests, 1);
  const retried = await fetchAirQuality(new Date("2026-10-02T19:00:00Z"), options);
  assert.equal(archiveRequests, 2);
  assert.equal(retried.collection.archiveChecks["43449/2026-10-01"].status, "ok");
});
