import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { AIR_QUALITY_SOURCE, AIR_QUALITY_TOWNS } from "./data-sources/air-quality-sources.mjs";

const dayMs = 86_400_000;
const sampleMs = AIR_QUALITY_SOURCE.samplingIntervalMinutes * 60_000;

function numeric(value) {
  if (value === null || value === undefined || typeof value === "boolean" || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function concentration(value) {
  const number = numeric(value);
  return number !== null && number >= 0 ? number : null;
}

export function measurementTimestamp(value) {
  // The public API and daily CSV use UTC without a suffix. Never let the
  // runner's local timezone reinterpret those measurements.
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/i.test(value)) return null;
  const normalized = value.replace(" ", "T");
  const timestamp = new Date(/[Zz]|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`);
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null;
}

function inRegion(latitude, longitude) {
  const { south, north, west, east } = AIR_QUALITY_SOURCE.bounds;
  return latitude !== null && longitude !== null
    && latitude >= south && latitude <= north && longitude >= west && longitude <= east;
}

function nearestTown(latitude, longitude) {
  const distanceSquared = (town) => (town.latitude - latitude) ** 2 + ((town.longitude - longitude) * Math.cos(latitude * Math.PI / 180)) ** 2;
  return AIR_QUALITY_TOWNS.reduce((nearest, town) => distanceSquared(town) < distanceSquared(nearest) ? town : nearest);
}

function stationMetadata(id, latitude, longitude, sensorType = "") {
  if (!/^\d+$/.test(String(id)) || !inRegion(latitude, longitude)) return null;
  const town = nearestTown(latitude, longitude);
  return {
    id: String(id),
    name: `${town.name} környéke · #${id}`,
    townId: town.id,
    latitude,
    longitude,
    sensorType: String(sensorType),
    sourceUrl: AIR_QUALITY_SOURCE.website,
  };
}

export function parseAirQualityApi(rows) {
  if (!Array.isArray(rows)) throw new Error("Sensor.Community: érvénytelen API-válasz");
  return rows.flatMap((row) => {
    const location = row?.location;
    if (!location || numeric(location.indoor) !== 0 || (location.country && location.country !== "BG")) return [];
    const station = stationMetadata(row.sensor?.id, numeric(location.latitude), numeric(location.longitude), row.sensor?.sensor_type?.name);
    const values = new Map((Array.isArray(row.sensordatavalues) ? row.sensordatavalues : []).map((value) => [value.value_type, value.value]));
    const point = { timestamp: measurementTimestamp(row.timestamp), pm10: concentration(values.get("P1")), pm25: concentration(values.get("P2")) };
    return station && point.timestamp && (point.pm10 !== null || point.pm25 !== null) ? [{ ...station, points: [point] }] : [];
  });
}

export function parseAirQualityArchive(csv, expectedStation) {
  const lines = String(csv).replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const columns = lines.shift()?.split(";") ?? [];
  if (!["sensor_id", "lat", "lon", "timestamp", "P1", "P2"].every((column) => columns.includes(column))) throw new Error("Sensor.Community: érvénytelen archív CSV");
  const index = Object.fromEntries(columns.map((column, position) => [column, position]));
  const points = [];
  for (const line of lines) {
    const values = line.split(";");
    if (values[index.sensor_id] !== String(expectedStation.id)) continue;
    const latitude = numeric(values[index.lat]);
    const longitude = numeric(values[index.lon]);
    // A relocated sensor must not put its older, distant samples on this map.
    if (!inRegion(latitude, longitude) || Math.abs(latitude - expectedStation.latitude) > 0.01 || Math.abs(longitude - expectedStation.longitude) > 0.01) continue;
    const timestamp = measurementTimestamp(values[index.timestamp]);
    const pm10 = concentration(values[index.P1]);
    const pm25 = concentration(values[index.P2]);
    if (timestamp && (pm10 !== null || pm25 !== null)) points.push({ timestamp, pm10, pm25 });
  }
  return { ...expectedStation, points };
}

export function mergeAirQualityStations(collections, now = new Date()) {
  const lastTime = new Date(now).getTime();
  const firstTime = lastTime - AIR_QUALITY_SOURCE.retentionDays * dayMs;
  const stations = new Map();
  for (const collection of collections) {
    for (const item of Array.isArray(collection) ? collection : []) {
      const metadata = stationMetadata(item?.id, numeric(item?.latitude), numeric(item?.longitude), item?.sensorType);
      if (!metadata) continue;
      const previous = stations.get(metadata.id);
      const samples = previous?.samples ?? new Map();
      for (const point of Array.isArray(item.points) ? item.points : []) {
        const timestamp = measurementTimestamp(point?.timestamp);
        const time = timestamp ? Date.parse(timestamp) : NaN;
        const pm10 = concentration(point?.pm10);
        const pm25 = concentration(point?.pm25);
        if (!(time >= firstTime && time <= lastTime) || (pm10 === null && pm25 === null)) continue;
        const bucket = Math.floor(time / sampleMs);
        const existing = samples.get(bucket);
        // Keep a real measurement, not an interpolation or invented bucket time.
        // This also deduplicates timestamps across API, cache and archive.
        if (!existing || timestamp > existing.timestamp) samples.set(bucket, { timestamp, pm10, pm25 });
        else if (timestamp === existing.timestamp) samples.set(bucket, { timestamp, pm10: pm10 ?? existing.pm10, pm25: pm25 ?? existing.pm25 });
      }
      stations.set(metadata.id, { ...metadata, samples });
    }
  }
  return [...stations.values()].filter((station) => station.samples.size).map(({ samples, ...station }) => ({
    ...station,
    points: [...samples.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
  })).sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
}

async function request(fetchImpl, url, timeoutMs, format = "json") {
  const response = await fetchImpl(url, {
    headers: { Accept: format === "json" ? "application/json" : "text/csv", "User-Agent": "pasztra-tech/1.0 (+https://github.com/pisipite/pasztra-tech)" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Sensor.Community HTTP ${response.status}`);
  return format === "json" ? response.json() : response.text();
}

async function readHistory(historyFile, historyUrl, fetchImpl, timeoutMs) {
  try {
    const stored = JSON.parse(await readFile(historyFile, "utf8"));
    if (Array.isArray(stored?.stations)) return stored;
  } catch { /* Recover from the previous published Pages deployment. */ }
  if (historyUrl) {
    try {
      const stored = await request(fetchImpl, historyUrl, timeoutMs);
      if (Array.isArray(stored?.stations)) return stored;
    } catch { /* The API can still provide current measurements. */ }
  }
  return { stations: [], collection: { archiveChecks: {} } };
}

function archiveTasks(stations, archiveChecks, now, initialDays) {
  const tasks = [];
  const midnight = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  for (let offset = 1; offset <= initialDays; offset += 1) {
    const day = new Date(midnight - offset * dayMs).toISOString().slice(0, 10);
    for (const station of stations) {
      // Archive naming is known for the verified regional SDS011 monitors.
      if (station.sensorType.toLowerCase() !== "sds011") continue;
      const key = `${station.id}/${day}`;
      const previous = archiveChecks[key];
      if (previous?.status === "ok") continue;
      // Daily exports arrive around 08:00 UTC. Missing/failed days retry later,
      // without requesting every missing file at each scheduled collection.
      if (previous?.checkedAt && now.getTime() - Date.parse(previous.checkedAt) < 6 * 60 * 60_000) continue;
      tasks.push({ key, day, station });
    }
  }
  return tasks;
}

/**
 * Collect real outdoor observations with bounded, resumable archive backfill.
 * Returns {source, checkedAt, updatedAt, sourceName, sourceUrl, status, error,
 * stations:[{id,name,latitude,longitude,points:[{timestamp,pm10,pm25}]}], ...}.
 * updatedAt is the last observation (null if none), never the collection time.
 * Optional paths/fetchImpl/limits allow isolated tests and first-time seeding.
 */
export async function fetchAirQuality(now = new Date(), options = {}) {
  now = new Date(now);
  if (!Number.isFinite(now.getTime())) throw new Error("Érvénytelen adatgyűjtési időpont");
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const archiveBudgetMs = options.archiveBudgetMs ?? 45_000;
  const initialDays = Math.min(AIR_QUALITY_SOURCE.initialArchiveDays, Math.max(0, options.archiveDays ?? AIR_QUALITY_SOURCE.initialArchiveDays));
  const historyFile = options.historyFile ?? resolve(".data-history/air-quality.json");
  const outputFile = options.outputFile ?? resolve("public/data/air-quality.json");
  let history = await readHistory(historyFile, options.historyUrl ?? process.env.AIR_QUALITY_HISTORY_URL, fetchImpl, timeoutMs);
  // The checked-in initial public snapshot is a last resort on first deploy.
  // Prefer restored cache/published history, so a seed cannot truncate history.
  if (!history.stations.length) history = await readHistory(outputFile, undefined, fetchImpl, timeoutMs);
  let current = [];
  let error = null;
  try {
    current = parseAirQualityApi(await request(fetchImpl, AIR_QUALITY_SOURCE.apiUrl, timeoutMs));
    if (!current.length) error = "A forrás jelenleg nem ad használható kültéri szállópor-mérést a környékről.";
  } catch (failure) {
    error = failure instanceof Error ? failure.message : "A mérési forrás nem érhető el.";
  }
  const knownStations = mergeAirQualityStations([history.stations, current], now);
  const retentionDate = new Date(now.getTime() - AIR_QUALITY_SOURCE.retentionDays * dayMs).toISOString().slice(0, 10);
  const archiveChecks = Object.fromEntries(Object.entries(history.collection?.archiveChecks ?? {}).filter(([key, value]) => key.split("/")[1] >= retentionDate && value && typeof value === "object"));
  const tasks = archiveTasks(knownStations, archiveChecks, now, initialDays);
  const archived = [];
  const deadline = Date.now() + archiveBudgetMs;
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, tasks.length) }, async () => {
    while (cursor < tasks.length && Date.now() < deadline) {
      const { key, day, station } = tasks[cursor++];
      const url = `${AIR_QUALITY_SOURCE.archiveUrl}${day}/${day}_sds011_sensor_${station.id}.csv`;
      try {
        const csv = await request(fetchImpl, url, Math.max(1, Math.min(timeoutMs, deadline - Date.now())), "csv");
        const parsed = parseAirQualityArchive(csv, station);
        archived.push(parsed);
        archiveChecks[key] = { checkedAt: now.toISOString(), status: parsed.points.length ? "ok" : "empty" };
      } catch {
        archiveChecks[key] = { checkedAt: now.toISOString(), status: "failed" };
      }
    }
  }));
  const stations = mergeAirQualityStations([history.stations, archived, current], now);
  const firstTimes = stations.map((station) => station.points[0].timestamp).sort();
  const lastTimes = stations.map((station) => station.points.at(-1).timestamp).sort();
  const updatedAt = lastTimes.at(-1) ?? null;
  const fresh = updatedAt && now.getTime() - Date.parse(updatedAt) <= 60 * 60_000;
  const result = {
    source: "measured",
    checkedAt: now.toISOString(),
    updatedAt,
    sourceName: AIR_QUALITY_SOURCE.name,
    sourceUrl: AIR_QUALITY_SOURCE.website,
    archiveUrl: AIR_QUALITY_SOURCE.archiveUrl,
    status: !stations.length ? "unavailable" : error || !fresh ? "stale" : "ok",
    error,
    units: "µg/m³",
    samplingIntervalMinutes: AIR_QUALITY_SOURCE.samplingIntervalMinutes,
    stations,
    coverage: {
      firstMeasurementAt: firstTimes[0] ?? null,
      lastMeasurementAt: updatedAt,
      stationCount: stations.length,
      sampleCount: stations.reduce((sum, station) => sum + station.points.length, 0),
      archiveDays: [...new Set(Object.entries(archiveChecks).filter(([, value]) => value.status === "ok").map(([key]) => key.split("/")[1]))].length,
    },
    collection: { archiveChecks },
  };
  await Promise.all([mkdir(dirname(historyFile), { recursive: true }), mkdir(dirname(outputFile), { recursive: true })]);
  const serialized = `${JSON.stringify(result)}\n`;
  await Promise.all([writeFile(historyFile, serialized, "utf8"), writeFile(outputFile, serialized, "utf8")]);
  return result;
}
