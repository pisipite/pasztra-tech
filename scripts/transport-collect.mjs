// Static dashboard snapshot: OpenSky, ADSBDB routes and the official BDZ GTFS-RT feed.
import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { ADSBDB_BASE, BDZ_VEHICLES_URL, BORDER_CROSSINGS } from "./transport-sources.mjs";
import { loadCounties, pointInCounties } from "./transport-geo.mjs";
import { loadTrainRoutes } from "./transport-timetable.mjs";
import { fetchMvrBorders, fetchTomTomIncidents } from "./transport-roads.mjs";

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
      borders: { status: "unavailable", name: "Bolgár határrendészet · MVR", message: "A határjelentés még nem lett lekérve." },
    },
    aircraft, trains: [], roads: [], borders: [],
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

function distanceKm(a, b) {
  const radians = Math.PI / 180;
  const deltaLat = (b.latitude - a.latitude) * radians;
  const deltaLon = (b.longitude - a.longitude) * radians;
  const value = Math.sin(deltaLat / 2) ** 2 + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(deltaLon / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(value)));
}

function bearingDegrees(a, b) {
  const radians = Math.PI / 180;
  const lat1 = a.latitude * radians, lat2 = b.latitude * radians;
  const deltaLon = (b.longitude - a.longitude) * radians;
  return (Math.atan2(Math.sin(deltaLon) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon)) / radians + 360) % 360;
}

// Callsigns may be reused: an ADSBDB origin/destination is only a candidate until
// it agrees with this aircraft's measured position and present course.
export function isPlausibleFlightRoute(aircraft, route) {
  if (!route || !Number.isFinite(aircraft.latitude) || !Number.isFinite(aircraft.longitude)) return false;
  const { origin, destination } = route;
  const direct = distanceKm(origin, destination);
  if (direct < 30) return false;
  const fromOrigin = distanceKm(origin, aircraft);
  const toDestination = distanceKm(aircraft, destination);
  if (fromOrigin + toDestination - direct > Math.max(120, direct * 0.15)) return false;
  if (Number.isFinite(aircraft.heading) && toDestination > 100) {
    const bearing = bearingDegrees(aircraft, destination);
    const difference = Math.abs(((aircraft.heading - bearing + 540) % 360) - 180);
    if (difference > 100) return false;
  }
  return true;
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

async function readPrevious(fetcher) {
  let local = null;
  try { local = JSON.parse(await readFile(output, "utf8")); } catch { /* First collection. */ }
  const historyUrl = process.env.TRANSPORT_HISTORY_URL;
  if (!historyUrl) return local;
  try {
    const response = await fetcher(historyUrl, { signal: AbortSignal.timeout(8_000), cache: "no-store" });
    if (!response.ok) return local;
    const remote = await response.json();
    return Date.parse(remote?.fetchedAt) > Date.parse(local?.fetchedAt) ? remote : local;
  } catch { return local; }
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
    const routeCacheMs = old?.route && old.routeVerified ? 6 * 60 * 60_000 : 20 * 60_000;
    if (old?.callsign === item.callsign && Date.now() - Date.parse(old.routeCheckedAt) < routeCacheMs) {
      item.route = isPlausibleFlightRoute(item, old.route) ? old.route : null;
      item.routeVerified = Boolean(item.route);
      item.routeCheckedAt = old.routeCheckedAt;
    } else pending.push(item);
  }
  for (let i = 0; i < pending.length; i += 6) {
    await Promise.all(pending.slice(i, i + 6).map(async (item) => {
      const candidate = await lookUpRoute(item.callsign, fetcher);
      item.route = isPlausibleFlightRoute(item, candidate) ? candidate : null;
      item.routeVerified = Boolean(item.route);
      item.routeCheckedAt = new Date().toISOString();
    }));
  }
  return aircraft;
}

export async function collectTransport({ fetcher = fetch } = {}) {
  const previous = await readPrevious(fetcher);
  const snapshot = previous && typeof previous === "object" ? structuredClone(previous) : normalizeOpenSky({ time: Math.floor(Date.now() / 1000), states: null });
  snapshot.fetchedAt = new Date().toISOString();
  snapshot.sources.borders ??= { status: "unavailable", name: "Bolgár határrendészet · MVR" };
  snapshot.borders ??= [];
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
  const borderTask = (async () => {
    const lastFetch = Date.parse(previous?.sources?.borders?.updatedAt);
    if (previous?.borders?.length && Number.isFinite(lastFetch) && Date.now() - lastFetch < 60 * 60_000) return;
    try {
      const data = await fetchMvrBorders(fetcher, snapshot.fetchedAt);
      snapshot.borders = data.borders;
      snapshot.sources.borders = data.source;
    } catch (error) {
      snapshot.borders = previous?.borders?.length ? previous.borders : BORDER_CROSSINGS.map(({ search: _search, ...crossing }) => ({ ...crossing, status: "unknown", description: "A határjelentés jelenleg nem érhető el.", reportedOn: "" }));
      snapshot.sources.borders = { status: previous?.borders?.some((item) => item.reportedOn) ? "stale" : "unavailable", name: "Bolgár határrendészet · MVR", updatedAt: previous?.sources?.borders?.updatedAt, message: error instanceof Error ? error.message : "Ismeretlen MVR-hiba" };
    }
  })();
  const roadTask = (async () => {
    const key = process.env.TOMTOM_API_KEY?.trim();
    if (!key) {
      snapshot.roads = [];
      snapshot.sources.roads = { status: "unavailable", name: "TomTom Traffic", message: "A torlódásokhoz és útépítésekhez TOMTOM_API_KEY szükséges." };
      return;
    }
    const lastFetch = Date.parse(previous?.sources?.roads?.updatedAt);
    if (previous?.sources?.roads?.status === "ok" && Number.isFinite(lastFetch) && Date.now() - lastFetch < 10 * 60_000) return;
    try {
      snapshot.roads = await fetchTomTomIncidents(key, counties, fetcher, snapshot.fetchedAt);
      snapshot.sources.roads = { status: "ok", name: "TomTom Traffic", updatedAt: snapshot.fetchedAt };
    } catch (error) {
      const recent = Number.isFinite(lastFetch) && Date.now() - lastFetch < 2 * 60 * 60_000;
      snapshot.roads = recent ? previous?.roads ?? [] : [];
      snapshot.sources.roads = { status: recent ? "stale" : "unavailable", name: "TomTom Traffic", updatedAt: recent ? previous?.sources?.roads?.updatedAt : undefined, message: error instanceof Error ? error.message : "Ismeretlen TomTom-hiba" };
    }
  })();
  await Promise.all([aircraftTask, trainTask, borderTask, roadTask]);
  await save(snapshot);
  console.log(`[transport] ${snapshot.fetchedAt}: ${snapshot.aircraft.length} repülő (${snapshot.sources.aircraft.status}), ${snapshot.trains.length} vonat (${snapshot.sources.trains.status}), ${snapshot.roads.length} közúti esemény (${snapshot.sources.roads.status}), ${snapshot.borders.length} átkelő (${snapshot.sources.borders.status})`);
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
