// Static dashboard snapshot: OpenSky, ADSBDB routes and the official BDZ GTFS-RT feed.
import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { ADSBDB_BASE, BDZ_VEHICLES_URL } from "./transport-sources.mjs";
import { loadCounties, pointInCounties } from "./transport-geo.mjs";
import { loadTrainRoutes } from "./transport-timetable.mjs";

const output = fileURLToPath(new URL("../public/data/transport-live.json", import.meta.url));
export const OPENSKY_BOUNDS = { lamin: 41.3, lomin: 22.3, lamax: 43.0, lomax: 24.6 };
const intervalMs = 5 * 60_000;

export function normalizeOpenSky(payload, fetchedAt = new Date().toISOString()) {
  if (!payload || !Number.isFinite(payload.time) || !Array.isArray(payload.states) && payload.states !== null) throw new Error("Érvénytelen OpenSky-válasz.");
  const aircraft = (payload.states ?? []).flatMap((row) => {
    if (!Array.isArray(row) || typeof row[0] !== "string" || !Number.isFinite(row[5]) || !Number.isFinite(row[6]) || row[8] === true) return [];
    const positionTime = Number(row[3]);
    if (!Number.isFinite(positionTime) || payload.time - positionTime > 120 || positionTime > payload.time + 30) return [];
    return [{
      id: row[0], callsign: typeof row[1] === "string" ? row[1].trim() : "", country: typeof row[2] === "string" ? row[2] : "",
      longitude: row[5], latitude: row[6],
      altitudeM: Number.isFinite(row[13]) ? row[13] : Number.isFinite(row[7]) ? row[7] : null,
      speedKmh: Number.isFinite(row[9]) ? Math.round(row[9] * 3.6) : null,
      heading: Number.isFinite(row[10]) ? row[10] : null,
      seenAt: new Date(positionTime * 1000).toISOString(),
    }];
  });
  return {
    fetchedAt, bounds: OPENSKY_BOUNDS,
    sources: {
      aircraft: { status: "ok", name: "OpenSky Network", updatedAt: new Date(payload.time * 1000).toISOString() },
      trains: { status: "unavailable", name: "BDZ / bolgár NAP", message: "A GTFS-RT még nem lett lekérve." },
      roads: { status: "unavailable", name: "Bolgár közúti NAP", message: "Hitelesített élő eseményfolyam még nincs beállítva." },
    },
    aircraft, trains: [], roads: [],
  };
}

function airport(value) {
  if (!value || !Number.isFinite(value.latitude) || !Number.isFinite(value.longitude)) return null;
  return {
    name: String(value.name || ""), city: String(value.municipality || value.name || "Ismeretlen"),
    code: String(value.iata_code || value.icao_code || ""), latitude: value.latitude, longitude: value.longitude,
  };
}

export function normalizeFlightRoute(payload) {
  const route = payload?.response?.flightroute;
  const origin = airport(route?.origin), destination = airport(route?.destination);
  return origin && destination ? { origin, destination, flightNumber: typeof route.callsign_iata === "string" ? route.callsign_iata : "" } : null;
}

export function appendFlightTrail(previous, aircraft) {
  const gap = Date.parse(aircraft.seenAt) - Date.parse(previous?.seenAt);
  const sameFlight = previous?.callsign === aircraft.callsign && Number.isFinite(gap) && gap >= 0 && gap < 20 * 60_000;
  const trail = sameFlight ? [...(previous.trail ?? [{ latitude: previous.latitude, longitude: previous.longitude, at: previous.seenAt }])] : [];
  const last = trail.at(-1);
  if (!last || Date.parse(aircraft.seenAt) > Date.parse(last.at) && Math.hypot(aircraft.latitude - last.latitude, aircraft.longitude - last.longitude) > 0.0005) {
    trail.push({ latitude: aircraft.latitude, longitude: aircraft.longitude, at: aircraft.seenAt });
  }
  return trail.slice(-96);
}

export function normalizeBdz(feed, counties, fetchedAt = new Date().toISOString()) {
  const feedTime = Number(feed?.header?.timestamp);
  if (!Number.isFinite(feedTime) || !Array.isArray(feed?.entity)) throw new Error("Érvénytelen BDZ GTFS-RT adat.");
  const updatedAt = new Date(feedTime * 1000).toISOString();
  const age = Date.parse(fetchedAt) - feedTime * 1000;
  const trains = feed.entity.flatMap((entity) => {
    const vehicle = entity.vehicle;
    const lat = vehicle?.position?.latitude, lon = vehicle?.position?.longitude;
    const timestamp = Number(vehicle?.timestamp ?? feedTime);
    if (!pointInCounties(lon, lat, counties) || !Number.isFinite(timestamp) || feedTime - timestamp > 15 * 60) return [];
    const id = String(vehicle.vehicle?.id || entity.id || "");
    if (!id) return [];
    return [{
      id, label: String(vehicle.vehicle?.label || `Vonat ${id}`).replace(/^Train\s+/i, "Vonat "),
      latitude: lat, longitude: lon, seenAt: new Date(timestamp * 1000).toISOString(),
      tripId: String(vehicle.trip?.tripId || ""), bearing: Number.isFinite(vehicle.position.bearing) ? vehicle.position.bearing : null,
    }];
  });
  return { trains, source: { status: age >= -60_000 && age <= 15 * 60_000 ? "ok" : "stale", name: "BDZ GTFS-RT · bolgár NAP", updatedAt } };
}

async function readPrevious() {
  try { return JSON.parse(await readFile(output, "utf8")); } catch { return null; }
}

async function save(snapshot) {
  const temporary = `${output}.tmp`;
  await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await rename(temporary, output);
}

async function lookUpRoute(callsign, fetcher) {
  if (!/^[A-Z0-9]{3,10}$/i.test(callsign)) return null;
  try {
    const response = await fetcher(`${ADSBDB_BASE}/${encodeURIComponent(callsign)}`, { signal: AbortSignal.timeout(8_000) });
    return response.ok ? normalizeFlightRoute(await response.json()) : null;
  } catch { return null; }
}

async function enrichAircraft(aircraft, previous, fetcher) {
  const oldById = new Map((previous?.aircraft ?? []).map((item) => [item.id, item]));
  const pending = [];
  for (const item of aircraft) {
    const old = oldById.get(item.id);
    item.trail = appendFlightTrail(old, item);
    const routeCacheMs = old?.route && "flightNumber" in old.route ? 6 * 60 * 60_000 : 20 * 60_000;
    if (old?.callsign === item.callsign && Date.now() - Date.parse(old.routeCheckedAt) < routeCacheMs) {
      item.route = old.route ?? null;
      item.routeCheckedAt = old.routeCheckedAt;
    } else pending.push(item);
  }
  for (let i = 0; i < pending.length; i += 6) {
    await Promise.all(pending.slice(i, i + 6).map(async (item) => {
      item.route = await lookUpRoute(item.callsign, fetcher);
      item.routeCheckedAt = new Date().toISOString();
    }));
  }
  return aircraft;
}

export async function collectTransport({ fetcher = fetch } = {}) {
  const previous = await readPrevious();
  const snapshot = previous && typeof previous === "object" ? previous : normalizeOpenSky({ time: Math.floor(Date.now() / 1000), states: null });
  snapshot.fetchedAt = new Date().toISOString();
  const counties = await loadCounties();
  const aircraftTask = (async () => {
    const url = new URL("https://opensky-network.org/api/states/all");
    for (const [key, value] of Object.entries(OPENSKY_BOUNDS)) url.searchParams.set(key, String(value));
    try {
      const response = await fetcher(url, { headers: { Accept: "application/json", "User-Agent": "PasztraTech/1.0 (personal transport map)" }, signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`OpenSky HTTP ${response.status}`);
      const fresh = normalizeOpenSky(await response.json());
      snapshot.aircraft = await enrichAircraft(fresh.aircraft.filter((aircraft) => pointInCounties(aircraft.longitude, aircraft.latitude, counties)), previous, fetcher);
      snapshot.sources.aircraft = fresh.sources.aircraft;
    } catch (error) {
      snapshot.sources.aircraft = { status: "stale", name: "OpenSky Network", updatedAt: previous?.sources?.aircraft?.updatedAt, message: error instanceof Error ? error.message : "Ismeretlen OpenSky-hiba" };
    }
  })();
  const trainTask = (async () => {
    try {
      const response = await fetcher(BDZ_VEHICLES_URL, { headers: { Accept: "application/x-protobuf" }, signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`BDZ HTTP ${response.status}`);
      const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(await response.arrayBuffer()));
      const data = normalizeBdz(feed, counties, snapshot.fetchedAt);
      let routes = {};
      try { routes = await loadTrainRoutes({ fetcher }); }
      catch (error) { console.warn(`[transport] A BDZ útvonalak nem elérhetők: ${error instanceof Error ? error.message : String(error)}`); }
      const previousTrains = new Map((previous?.trains ?? []).map((train) => [train.id, train]));
      snapshot.trains = data.trains.map((train) => ({
        ...train,
        route: routes[train.tripId] ?? (previousTrains.get(train.id)?.tripId === train.tripId ? previousTrains.get(train.id)?.route : null) ?? null,
      }));
      snapshot.sources.trains = data.source;
    } catch (error) {
      snapshot.sources.trains = { status: "stale", name: "BDZ GTFS-RT · bolgár NAP", updatedAt: previous?.sources?.trains?.updatedAt, message: error instanceof Error ? error.message : "Ismeretlen BDZ-hiba" };
    }
  })();
  await Promise.all([aircraftTask, trainTask]);
  await save(snapshot);
  console.log(`[transport] ${snapshot.fetchedAt}: ${snapshot.aircraft.length} repülő (${snapshot.sources.aircraft.status}), ${snapshot.trains.length} vonat (${snapshot.sources.trains.status})`);
  return snapshot;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await collectTransport(); } catch (error) { console.error("[transport] Gyűjtési hiba:", error); }
    finally { running = false; }
  };
  await run();
  if (process.argv.includes("--watch")) setInterval(() => void run(), intervalMs);
}
