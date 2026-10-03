import { timestampInPeriod } from "../../dateUtils";
import type { PeriodKey } from "../../types";
import type { AirQualityStation, Pollutant } from "./types";

export const TOWNS = [
  { id: "dupnica", name: "Dupnica", latitude: 42.266, longitude: 23.117 },
  { id: "blagoevgrad", name: "Blagoevgrad", latitude: 42.011, longitude: 23.098 },
  { id: "sapareva", name: "Szapareva banja", latitude: 42.289, longitude: 23.263 },
  { id: "samokov", name: "Szamokov", latitude: 42.337, longitude: 23.553 },
  { id: "rila", name: "Rila", latitude: 42.134, longitude: 23.133 },
  { id: "borovets", name: "Borovec", latitude: 42.266, longitude: 23.607 },
  { id: "razlog", name: "Razlog", latitude: 41.886, longitude: 23.467 },
  { id: "dolna", name: "Dolna banja", latitude: 42.310, longitude: 23.765 },
  { id: "boboshevo", name: "Bobosevo", latitude: 42.153, longitude: 23.001 },
] as const;

export function distanceKm(latitude: number, longitude: number, town: typeof TOWNS[number]) {
  const north = (latitude - town.latitude) * 111.2;
  const east = (longitude - town.longitude) * 111.2 * Math.cos(latitude * Math.PI / 180);
  return Math.hypot(north, east);
}

export function summarizeStations(stations: AirQualityStation[], pollutant: Pollutant, period: PeriodKey, anchor: Date, from: string, to: string) {
  return stations.map((station) => {
    const nearest = TOWNS.reduce((best, town) => distanceKm(station.latitude, station.longitude, town) < distanceKm(station.latitude, station.longitude, best) ? town : best);
    const points = station.points.filter((point) => Number.isFinite(point[pollutant]) && point[pollutant]! >= 0
      && timestampInPeriod(point.timestamp, period, anchor, from, to));
    const times = points.map((point) => point.timestamp).sort();
    return {
      ...station,
      townId: nearest.id,
      count: points.length,
      value: points.length ? points.reduce((sum, point) => sum + point[pollutant]!, 0) / points.length : null,
      first: times[0] ?? null,
      last: times.at(-1) ?? null,
    };
  });
}

export function concentrationColor(value: number | null, pollutant: Pollutant) {
  if (value === null) return "#89918b";
  const limits = pollutant === "pm25" ? [10, 20, 35, 50] : [20, 40, 60, 100];
  const colors = ["#458785", "#b3a447", "#dd9237", "#bf633f", "#8f425c"];
  return colors[limits.findIndex((limit) => value < limit)] ?? colors[4];
}

// Approximate geographic projection used by both the base map and real sensors.
export function projectPoint(latitude: number, longitude: number) {
  return { x: 55 + (longitude - 22.97) / .83 * 890, y: 50 + (42.43 - latitude) / .60 * 560 };
}
