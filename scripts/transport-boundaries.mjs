// One-time, simplified OSM administrative outlines; do not query Nominatim
// from every visitor's browser. Keep the generated GeoJSON in the project.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const regions = [
  { id: "kyustendil", name: "Kjusztendil megye", osmId: "R1739530" },
  { id: "blagoevgrad", name: "Blagoevgrad megye", osmId: "R1739521" },
];
const features = [];
for (const [index, region] of regions.entries()) {
  if (index) await new Promise((resolve) => setTimeout(resolve, 1200));
  const url = new URL("https://nominatim.openstreetmap.org/lookup");
  url.search = new URLSearchParams({ osm_ids: region.osmId, format: "geojson", polygon_geojson: "1", polygon_threshold: "0.002" }).toString();
  const response = await fetch(url, { headers: { "User-Agent": "PasztraTech/1.0 (personal dashboard; OSM boundary import)", Accept: "application/geo+json" } });
  if (!response.ok) throw new Error(`Nominatim ${region.name}: HTTP ${response.status}`);
  const data = await response.json();
  const geometry = data.features?.[0]?.geometry;
  if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) throw new Error(`Hiányzó megyehatár: ${region.name}`);
  features.push({ type: "Feature", properties: { id: region.id, name: region.name, osmId: region.osmId }, geometry });
}
const output = fileURLToPath(new URL("../public/data/transport-oblasts.geojson", import.meta.url));
await writeFile(output, `${JSON.stringify({ type: "FeatureCollection", features })}\n`, "utf8");
console.log(`Megyehatárok mentve: ${output}`);
