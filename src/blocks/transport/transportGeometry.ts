import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { Aircraft, FlightRoute } from "./transportData";

export type CountyData = FeatureCollection<Polygon | MultiPolygon>;
export type LatLon = [latitude: number, longitude: number];

function insideRing([latitude, longitude]: LatLon, ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > latitude) !== (yj > latitude) && longitude < (xj - xi) * (latitude - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function insideCounties(point: LatLon, counties: CountyData) {
  return counties.features.some(({ geometry }) => {
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    return polygons.some(([outer, ...holes]) => insideRing(point, outer) && !holes.some((hole) => insideRing(point, hole)));
  });
}

// The route is sampled before clipping. This keeps only portions inside the two
// counties; boundary intersections are approximate to about 1 km.
export function clipToCounties(points: LatLon[], counties: CountyData): LatLon[][] {
  const segments: LatLon[][] = [];
  let current: LatLon[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const distanceKm = Math.hypot((b[0] - a[0]) * 111, (b[1] - a[1]) * 83);
    const steps = Math.max(1, Math.ceil(distanceKm));
    for (let step = i === 1 ? 0 : 1; step <= steps; step++) {
      const t = step / steps;
      const sample: LatLon = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      if (insideCounties(sample, counties)) current.push(sample);
      else if (current.length) {
        if (current.length > 1) segments.push(current);
        current = [];
      }
    }
  }
  if (current.length > 1) segments.push(current);
  return segments;
}

const radians = (degrees: number) => degrees * Math.PI / 180;
const degrees = (angle: number) => angle * 180 / Math.PI;

function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const deltaLat = radians(b.latitude - a.latitude), deltaLon = radians(b.longitude - a.longitude);
  const value = Math.sin(deltaLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(deltaLon / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(value)));
}

// Validate older snapshots too: a still-running collector may have published
// a callsign match without the newer routeVerified flag.
export function trustedFlightRoute(aircraft: Aircraft): FlightRoute | null {
  const route = aircraft.route;
  if (!route || aircraft.routeVerified === false || !Number.isFinite(aircraft.latitude) || !Number.isFinite(aircraft.longitude)) return null;
  const direct = distanceKm(route.origin, route.destination);
  if (direct < 30) return null;
  const fromOrigin = distanceKm(route.origin, aircraft);
  const toDestination = distanceKm(aircraft, route.destination);
  if (fromOrigin + toDestination - direct > Math.max(120, direct * 0.15)) return null;
  if (Number.isFinite(aircraft.heading) && toDestination > 100) {
    const lat1 = radians(aircraft.latitude), lat2 = radians(route.destination.latitude);
    const deltaLon = radians(route.destination.longitude - aircraft.longitude);
    const bearing = (degrees(Math.atan2(Math.sin(deltaLon) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon))) + 360) % 360;
    if (Math.abs(((aircraft.heading! - bearing + 540) % 360) - 180) > 100) return null;
  }
  return route;
}

function destinationPoint([latitude, longitude]: LatLon, bearingDegrees: number, distanceKm: number): LatLon {
  const angular = distanceKm / 6371;
  const lat = radians(latitude), lon = radians(longitude), bearing = radians(bearingDegrees);
  const nextLat = Math.asin(Math.sin(lat) * Math.cos(angular) + Math.cos(lat) * Math.sin(angular) * Math.cos(bearing));
  const nextLon = lon + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat), Math.cos(angular) - Math.sin(lat) * Math.sin(nextLat));
  return [degrees(nextLat), degrees(nextLon)];
}

export function estimatedExit(start: LatLon, destination: LatLon | null, heading: number | null): LatLon | null {
  // A current measured heading is more trustworthy than a route database's
  // destination. It also avoids drawing a turn across the county on selection.
  if (Number.isFinite(heading)) return destinationPoint(start, heading!, 280);
  if (destination) {
    const lat1 = radians(start[0]), lat2 = radians(destination[0]), deltaLon = radians(destination[1] - start[1]);
    const bearing = degrees(Math.atan2(Math.sin(deltaLon) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon)));
    const deltaLat = lat2 - lat1;
    const distance = 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2)));
    return destinationPoint(start, bearing, Math.min(distance, 280));
  }
  return null;
}
