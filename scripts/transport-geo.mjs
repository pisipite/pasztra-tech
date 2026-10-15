import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const COUNTY_GEOJSON = fileURLToPath(new URL("../public/data/transport-oblasts.geojson", import.meta.url));

function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInCounties(lon, lat, countyData) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  return countyData.features.some(({ geometry }) => {
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
    return polygons.some(([outer, ...holes]) => inRing(lon, lat, outer) && !holes.some((hole) => inRing(lon, lat, hole)));
  });
}

export async function loadCounties() {
  return JSON.parse(await readFile(COUNTY_GEOJSON, "utf8"));
}
