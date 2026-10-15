// Match BDZ live trip IDs to the first and last stops in the official GTFS timetable.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { BGNAP_BASE, BDZ_STATIC_SUBSET_ID } from "./transport-sources.mjs";

const cachePath = fileURLToPath(new URL("../.data-history/transport-timetable.json", import.meta.url));
const cacheMs = 24 * 60 * 60_000;
let memoryCache;

function parseCsv(line) {
  const fields = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && quoted && line[i + 1] === '"') { value += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { fields.push(value); value = ""; }
    else value += char;
  }
  fields.push(value);
  return fields;
}

export function trainRoutesFromGtfs(stopsCsv, stopTimesCsv) {
  const stops = new Map();
  for (const row of stopsCsv.trim().split(/\r?\n/).slice(1)) {
    const fields = parseCsv(row);
    if (fields[0] && fields[2]) stops.set(fields[0], fields[2]);
  }
  const endpoints = new Map();
  for (const row of stopTimesCsv.trim().split(/\r?\n/).slice(1)) {
    const [tripId, , , stopId, sequenceText] = row.split(",", 5);
    const sequence = Number(sequenceText);
    if (!tripId || !stops.has(stopId) || !Number.isFinite(sequence)) continue;
    const endpoint = endpoints.get(tripId) ?? { first: Infinity, last: -Infinity, origin: "", destination: "" };
    if (sequence < endpoint.first) { endpoint.first = sequence; endpoint.origin = stops.get(stopId); }
    if (sequence > endpoint.last) { endpoint.last = sequence; endpoint.destination = stops.get(stopId); }
    endpoints.set(tripId, endpoint);
  }
  return Object.fromEntries([...endpoints].flatMap(([tripId, endpoint]) =>
    endpoint.origin && endpoint.destination ? [[tripId, { origin: endpoint.origin, destination: endpoint.destination }]] : []));
}

export async function loadTrainRoutes({ fetcher = fetch, now = Date.now() } = {}) {
  if (!memoryCache) {
    try { memoryCache = JSON.parse(await readFile(cachePath, "utf8")); } catch { memoryCache = null; }
  }
  if (memoryCache?.routes && now - Date.parse(memoryCache.checkedAt) < cacheMs) return memoryCache.routes;
  try {
    const response = await fetcher(`${BGNAP_BASE}/subsets/${BDZ_STATIC_SUBSET_ID}/files?format=gtfs-static`, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`BDZ GTFS-katalógus: HTTP ${response.status}`);
    const files = await response.json();
    const latest = files.find((file) => file.is_latest) ?? files[0];
    if (!latest?.id) throw new Error("Nincs BDZ GTFS-menetrend.");
    let routes = memoryCache?.fileId === latest.id ? memoryCache.routes : null;
    if (!routes) {
      const archiveResponse = await fetcher(`${BGNAP_BASE}/files/${latest.id}/download`, { signal: AbortSignal.timeout(60_000) });
      if (!archiveResponse.ok) throw new Error(`BDZ GTFS-letöltés: HTTP ${archiveResponse.status}`);
      const archive = unzipSync(new Uint8Array(await archiveResponse.arrayBuffer()));
      if (!archive["stops.txt"] || !archive["stop_times.txt"]) throw new Error("Hiányzik a BDZ megálló- vagy járatlista.");
      routes = trainRoutesFromGtfs(strFromU8(archive["stops.txt"]), strFromU8(archive["stop_times.txt"]));
    }
    memoryCache = { checkedAt: new Date(now).toISOString(), fileId: latest.id, routes };
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify(memoryCache), "utf8");
    return routes;
  } catch (error) {
    if (memoryCache?.routes) {
      console.warn(`[transport] A BDZ menetrend nem frissült: ${error instanceof Error ? error.message : String(error)}`);
      return memoryCache.routes;
    }
    throw error;
  }
}
