export type SourceStatus = "ok" | "stale" | "unavailable";
export type TransportSource = { status: SourceStatus; name: string; updatedAt?: string; message?: string; url?: string };
export type Airport = { name: string; city: string; code: string; latitude: number; longitude: number };
export type FlightRoute = { origin: Airport; destination: Airport; flightNumber?: string };
export type FlightPoint = { latitude: number; longitude: number; at: string };
export type Aircraft = {
  id: string; callsign: string; country: string; latitude: number; longitude: number;
  altitudeM: number | null; speedKmh: number | null; heading: number | null; seenAt: string;
  route?: FlightRoute | null; routeVerified?: boolean; routeCheckedAt?: string; trail?: FlightPoint[];
};
export type Train = {
  id: string; label: string; latitude: number; longitude: number;
  delayMinutes?: number | null; seenAt: string; tripId?: string; bearing?: number | null;
  route?: { origin: string; destination: string } | null;
};
export type RoadEvent = {
  id: string; title: string; latitude: number; longitude: number;
  category?: string; description?: string; updatedAt?: string; endAt?: string;
  delayMinutes?: number | null; planned?: boolean; path?: number[][];
};
export type BorderCrossing = {
  id: string; name: string; country: string; latitude: number; longitude: number;
  status: "normal" | "busy" | "restricted" | "unknown";
  description: string; reportedOn: string; sourceUrl?: string;
};
export type TransportSnapshot = {
  fetchedAt: string;
  sources: { aircraft: TransportSource; trains: TransportSource; roads: TransportSource; borders?: TransportSource };
  aircraft: Aircraft[]; trains: Train[]; roads: RoadEvent[]; borders?: BorderCrossing[];
};

export const TRANSPORT_LINKS = {
  opensky: "https://opensky-network.org/",
  bdz: "https://radar.bdz.bg/bg",
  bdzNap: "https://sipbg.gov.bg/bgnap/portal/bg/catalog/710c84db-9f73-46b2-9731-d0df793a6133",
  roads: "https://sipbg.gov.bg/bgnap/portal/bg/instructions",
  mvr: "https://www.mvr.bg/press/актуална-информация/актуална-информация/актуално",
  tomtom: "https://www.tomtom.com/traffic-index/",
  osm: "https://www.openstreetmap.org/copyright",
} as const;

export function validSnapshot(value: unknown): value is TransportSnapshot {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<TransportSnapshot>;
  return Boolean(data.sources?.aircraft && data.sources?.trains && data.sources?.roads
    && Array.isArray(data.aircraft) && Array.isArray(data.trains) && Array.isArray(data.roads)
    && (!data.borders || Array.isArray(data.borders))
    && typeof data.fetchedAt === "string");
}

export function sourceLabel(source: TransportSource | undefined, stale = false) {
  if (!source || source.status === "unavailable") return "Még nincs bekötve";
  if (source.status === "stale" || stale) return "Korábbi adat";
  return "Élő adat";
}
