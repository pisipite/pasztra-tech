import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { PERSONAL_SENSOR_SOURCE as SOURCE } from "./data-sources/personal-sensor-source.mjs";

const metrics = ["pm25", "pm10", "temperature", "humidity", "pressure"];
const bucketMs = SOURCE.bucketMinutes * 60_000;
const dayMs = 86_400_000;
const safeNumber = (value) => {
  if (value === undefined || value === null || typeof value === "boolean" || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function parsePersonalSensorCsv(csv) {
  const lines = String(csv).replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const columns = lines.shift()?.split(";") ?? [];
  if (!columns.includes("Time") || !columns.some((key) => ["SDS_P1", "SDS_P2", "BME280_temperature", "BME280_humidity", "BME280_pressure"].includes(key))) {
    throw new Error("A szenzor mérési fájljának formátuma ismeretlen.");
  }
  const index = Object.fromEntries(columns.map((key, position) => [key, position]));
  const result = [];
  for (const line of lines) {
    const values = line.split(";");
    const rawTime = values[index.Time]?.trim();
    if (!/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(rawTime ?? "")) continue;
    // Madavi's timestamps are UTC, including when the collector runs on Windows.
    const timestamp = new Date(`${rawTime.replaceAll("/", "-").replace(" ", "T")}Z`);
    if (!Number.isFinite(timestamp.getTime())) continue;
    const pick = (name) => safeNumber(values[index[name]]);
    const pm10 = pick("SDS_P1"), pm25 = pick("SDS_P2");
    const temperature = pick("BME280_temperature"), humidity = pick("BME280_humidity"), pressurePa = pick("BME280_pressure");
    const row = {
      timestamp: timestamp.toISOString(),
      pm10: pm10 !== null && pm10 >= 0 ? pm10 : null,
      pm25: pm25 !== null && pm25 >= 0 ? pm25 : null,
      temperature: temperature !== null && temperature >= -80 && temperature <= 80 ? temperature : null,
      humidity: humidity !== null && humidity >= 0 && humidity <= 100 ? humidity : null,
      // The BME280 archive reports Pa; display station pressure in hPa.
      pressure: pressurePa !== null && pressurePa >= 10_000 && pressurePa <= 120_000 ? pressurePa / 100 : null,
    };
    if (metrics.some((key) => row[key] !== null)) result.push(row);
  }
  return result;
}

export function personalSensorArchivePaths(html, chipId = SOURCE.chipId) {
  const id = chipId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const allowed = new RegExp(`^data_csv/(?:csv-files/(\\d{4}-\\d{2}-\\d{2})/data-${id}-\\1\\.csv|(\\d{4})/(\\d{2})/data-${id}-\\2-\\3\\.zip)$`);
  const paths = [...String(html).matchAll(/href\s*=\s*["']([^"']+)["']/gi)]
    .map((match) => match[1]).filter((path) => allowed.test(path));
  return [...new Set(paths)].sort().reverse();
}

export function mergePersonalSensorPoints(collections, now = new Date()) {
  const end = new Date(now).getTime(), start = end - SOURCE.retentionDays * dayMs;
  const buckets = new Map();
  for (const collection of collections) for (const row of Array.isArray(collection) ? collection : []) {
    const rowMs = Date.parse(row?.timestamp ?? "");
    if (!Number.isFinite(rowMs)) continue;
    const bucket = Math.floor(rowMs / bucketMs) * bucketMs;
    const existing = buckets.get(bucket) ?? { timestamp: new Date(bucket).toISOString(), observedAt: {} };
    for (const key of metrics) {
      const value = safeNumber(row[key]);
      const measuredAt = row.observedAt?.[key] ?? row.timestamp;
      const measuredMs = Date.parse(measuredAt ?? "");
      if (value === null || !Number.isFinite(measuredMs) || measuredMs < start || measuredMs > end
        || ((key === "pm10" || key === "pm25") && value < 0)
        || (key === "temperature" && (value < -80 || value > 80))
        || (key === "humidity" && (value < 0 || value > 100))
        || (key === "pressure" && (value < 100 || value > 1200))) continue;
      if (!existing.observedAt[key] || measuredMs >= Date.parse(existing.observedAt[key])) {
        existing[key] = value;
        existing.observedAt[key] = new Date(measuredMs).toISOString();
      }
    }
    if (metrics.some((key) => key in existing)) buckets.set(bucket, existing);
  }
  return [...buckets.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return null; }
}

async function request(fetchImpl, url, timeoutMs) {
  const response = await fetchImpl(url, {
    headers: { "User-Agent": "pasztra-tech/1.0 (+https://github.com/pisipite/pasztra-tech)" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`A szenzor archívuma HTTP ${response.status} választ adott.`);
  return response;
}

export async function fetchPersonalSensor(now = new Date(), options = {}) {
  now = new Date(now);
  if (!Number.isFinite(now.getTime())) throw new Error("Érvénytelen lekérdezési időpont.");
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const historyFile = options.historyFile ?? resolve(".data-history/personal-sensor.json");
  const outputFile = options.outputFile ?? resolve("public/data/personal-sensor.json");
  const savedHistory = await readJson(historyFile);
  const savedPublication = await readJson(outputFile);
  // A newly configured chip must never inherit another device's readings.
  const history = savedHistory?.sensorId === SOURCE.chipId ? savedHistory : null;
  const published = savedPublication?.sensorId === SOURCE.chipId ? savedPublication : null;
  const collections = [history?.points, published?.points];
  const archiveChecks = { ...(published?.collection?.archiveChecks ?? {}), ...(history?.collection?.archiveChecks ?? {}) };
  let error = null;
  let fetched = 0;
  try {
    const indexUrl = new URL(`csvfiles.php?sensor=${encodeURIComponent(SOURCE.chipId)}`, SOURCE.archiveBase);
    const paths = personalSensorArchivePaths(await (await request(fetchImpl, indexUrl, timeoutMs)).text());
    if (!paths.length) throw new Error("Az archívum jelenleg nem sorol fel mérési fájlt ehhez a készülékhez.");
    const today = now.toISOString().slice(0, 10);
    const tasks = paths.filter((path) => path.includes(`-${today}.csv`) || !archiveChecks[path]).slice(0, options.maxArchives ?? SOURCE.maxArchivesPerRun);
    // Long historical archives are backfilled over several runs; a slow source
    // must not hold up every other dashboard update indefinitely.
    const deadline = Date.now() + (options.archiveBudgetMs ?? 45_000);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, tasks.length) }, async () => {
      while (cursor < tasks.length && Date.now() < deadline) {
        const path = tasks[cursor++];
        try {
          const response = await request(fetchImpl, new URL(path, SOURCE.archiveBase), Math.max(1, Math.min(timeoutMs, deadline - Date.now())));
          let rows = [];
          if (path.endsWith(".zip")) {
            const compressed = new Uint8Array(await response.arrayBuffer());
            if (compressed.length > 10_000_000) throw new Error("Az archívum túl nagy.");
            let expanded = 0;
            const files = unzipSync(compressed, { filter: (file) => {
              if (!file.name.toLowerCase().endsWith(".csv")) return false;
              expanded += file.originalSize;
              if (expanded > 40_000_000) throw new Error("A kibontott archívum túl nagy.");
              return true;
            } });
            for (const [name, bytes] of Object.entries(files)) if (name.toLowerCase().endsWith(".csv")) rows.push(...parsePersonalSensorCsv(new TextDecoder().decode(bytes)));
          } else rows = parsePersonalSensorCsv(await response.text());
          collections.push(rows);
          if (rows.length && !path.includes(`-${today}.csv`)) archiveChecks[path] = true;
          fetched += rows.length;
        } catch (failure) {
          error ??= failure instanceof Error ? failure.message : "A mérési fájl nem érhető el.";
        }
      }
    }));
  } catch (failure) {
    error = failure instanceof Error ? failure.message : "A szenzor archívuma nem érhető el.";
  }
  const points = mergePersonalSensorPoints(collections, now);
  const latest = {};
  for (const point of points) for (const key of metrics) {
    const timestamp = point.observedAt?.[key];
    if (timestamp && (!latest[key] || timestamp > latest[key].timestamp)) latest[key] = { value: point[key], timestamp };
  }
  const updatedAt = Object.values(latest).map((item) => item.timestamp).sort().at(-1) ?? null;
  const fresh = updatedAt && now.getTime() - Date.parse(updatedAt) <= 30 * 60_000;
  const result = {
    source: "Madavi", sensorId: SOURCE.chipId, sensorName: SOURCE.name,
    sourceUrl: new URL(`csvfiles.php?sensor=${encodeURIComponent(SOURCE.chipId)}`, SOURCE.archiveBase).href,
    checkedAt: now.toISOString(), updatedAt,
    status: !points.length ? "unavailable" : error || !fresh ? "stale" : "ok",
    error, bucketMinutes: SOURCE.bucketMinutes, latest, points,
    collection: { archiveChecks },
  };
  await Promise.all([mkdir(dirname(historyFile), { recursive: true }), mkdir(dirname(outputFile), { recursive: true })]);
  const serialized = `${JSON.stringify(result)}\n`;
  await Promise.all([writeFile(historyFile, serialized), writeFile(outputFile, serialized)]);
  console.log(`Saját szenzor: ${fetched} beolvasott mérés, ${points.length} tárolt idősáv; ${result.status}.`);
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await fetchPersonalSensor();
}
