// Regenerate the county rail overlay from the official BDZ GTFS Static feed.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { BGNAP_BASE, BDZ_STATIC_SUBSET_ID } from "./transport-sources.mjs";
import { loadCounties, pointInCounties } from "./transport-geo.mjs";

const output = fileURLToPath(new URL("../public/data/transport-railways.geojson", import.meta.url));

function parseCsv(line) {
  const fields = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const character = line[i];
    if (character === '"' && quoted && line[i + 1] === '"') { value += '"'; i++; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { fields.push(value); value = ""; }
    else value += character;
  }
  fields.push(value);
  return fields;
}

function simplify(points, tolerance = 0.0003) {
  if (points.length < 3) return points;
  const first = points[0];
  const last = points.at(-1);
  let farthest = 0;
  let farthestIndex = 0;
  const dx = last[0] - first[0];
  const dy = last[1] - first[1];
  const lengthSquared = dx * dx + dy * dy;
  for (let i = 1; i < points.length - 1; i++) {
    const t = lengthSquared ? Math.max(0, Math.min(1, ((points[i][0] - first[0]) * dx + (points[i][1] - first[1]) * dy) / lengthSquared)) : 0;
    const distance = Math.hypot(points[i][0] - first[0] - t * dx, points[i][1] - first[1] - t * dy);
    if (distance > farthest) { farthest = distance; farthestIndex = i; }
  }
  if (farthest <= tolerance) return [first, last];
  return [...simplify(points.slice(0, farthestIndex + 1), tolerance).slice(0, -1), ...simplify(points.slice(farthestIndex), tolerance)];
}

function inBounds(lon, lat) { return lon >= 22.3 && lon <= 24.6 && lat >= 41.3 && lat <= 43; }

export function railwaysFromGtfs(shapesCsv, stopsCsv, counties) {
  const shapes = new Map();
  for (const row of shapesCsv.trim().split(/\r?\n/).slice(1)) {
    const [id, latText, lonText, sequenceText] = row.split(",");
    const lat = Number(latText), lon = Number(lonText);
    if (!shapes.has(id)) shapes.set(id, []);
    shapes.get(id).push({ sequence: Number(sequenceText), coordinate: [lon, lat] });
  }
  const lines = [];
  const seen = new Set();
  const boundaryPoint = (insidePoint, outsidePoint) => {
    let inner = insidePoint, outer = outsidePoint;
    for (let step = 0; step < 12; step++) {
      const middle = [(inner[0] + outer[0]) / 2, (inner[1] + outer[1]) / 2];
      if (pointInCounties(middle[0], middle[1], counties)) inner = middle;
      else outer = middle;
    }
    return inner;
  };
  const keep = (part) => {
    if (part.length < 2) return;
    const coordinates = simplify(part).map(([lon, lat]) => [Number(lon.toFixed(5)), Number(lat.toFixed(5))]);
    const signature = JSON.stringify(coordinates);
    const reverse = JSON.stringify([...coordinates].reverse());
    if (seen.has(signature) || seen.has(reverse)) return;
    seen.add(signature);
    lines.push(coordinates);
  };
  for (const points of shapes.values()) {
    points.sort((a, b) => a.sequence - b.sequence);
    let part = [];
    let previous = null;
    let previousInside = false;
    for (const { coordinate } of points) {
      const inside = inBounds(coordinate[0], coordinate[1]) && pointInCounties(coordinate[0], coordinate[1], counties);
      if (inside) {
        if (!part.length && previous && !previousInside) part.push(boundaryPoint(coordinate, previous));
        part.push(coordinate);
      } else if (part.length) {
        if (previous && previousInside) part.push(boundaryPoint(previous, coordinate));
        keep(part);
        part = [];
      }
      previous = coordinate;
      previousInside = inside;
    }
    keep(part);
  }
  const stations = [];
  const stationKeys = new Set();
  for (const row of stopsCsv.trim().split(/\r?\n/).slice(1)) {
    const columns = parseCsv(row);
    const lat = Number(columns[4]), lon = Number(columns[5]);
    if (!pointInCounties(lon, lat, counties)) continue;
    const name = columns[2]?.trim();
    const key = `${name}:${lat.toFixed(4)}:${lon.toFixed(4)}`;
    if (!name || stationKeys.has(key)) continue;
    stationKeys.add(key);
    stations.push({ name, lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)) });
  }
  return { lines, stations };
}

export async function collectRailways({ fetcher = fetch } = {}) {
  const response = await fetcher(`${BGNAP_BASE}/subsets/${BDZ_STATIC_SUBSET_ID}/files?format=gtfs-static`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`BDZ GTFS-katalógus: HTTP ${response.status}`);
  const files = await response.json();
  const latest = files.find((file) => file.is_latest) ?? files[0];
  if (!latest?.id) throw new Error("Nincs BDZ GTFS-állomány.");
  const archiveResponse = await fetcher(`${BGNAP_BASE}/files/${latest.id}/download`, { signal: AbortSignal.timeout(60_000) });
  if (!archiveResponse.ok) throw new Error(`BDZ GTFS-letöltés: HTTP ${archiveResponse.status}`);
  const archive = unzipSync(new Uint8Array(await archiveResponse.arrayBuffer()));
  if (!archive["shapes.txt"] || !archive["stops.txt"]) throw new Error("Hiányzik a GTFS shapes.txt vagy stops.txt.");
  const { lines, stations } = railwaysFromGtfs(strFromU8(archive["shapes.txt"]), strFromU8(archive["stops.txt"]), await loadCounties());
  if (!lines.length) throw new Error("Nem találhatók vasútvonalak a két megyében.");
  const geojson = {
    type: "FeatureCollection",
    metadata: { source: "BDZ GTFS Static · Bulgarian NAP", sourceFile: latest.filename, sourceUpdatedAt: latest.created_at, generatedAt: new Date().toISOString() },
    features: [
      { type: "Feature", properties: { kind: "railways" }, geometry: { type: "MultiLineString", coordinates: lines } },
      ...stations.map((station) => ({ type: "Feature", properties: { kind: "station", name: station.name }, geometry: { type: "Point", coordinates: [station.lon, station.lat] } })),
    ],
  };
  await writeFile(output, `${JSON.stringify(geojson)}\n`, "utf8");
  console.log(`[transport] BDZ GTFS: ${lines.length} szakasz, ${stations.length} állomás; ${latest.filename}`);
  return geojson;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await collectRailways();
