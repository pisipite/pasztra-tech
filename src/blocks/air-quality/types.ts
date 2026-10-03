export interface AirQualityPoint {
  timestamp: string;
  pm10: number | null;
  pm25: number | null;
}

export interface AirQualityStation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  sourceUrl?: string;
  points: AirQualityPoint[];
}

export interface AirQualityData {
  source: "measured";
  checkedAt: string;
  updatedAt: string | null;
  status: "ok" | "stale" | "unavailable";
  sourceName: string;
  sourceUrl: string;
  samplingIntervalMinutes?: number;
  stations: AirQualityStation[];
}

export type Pollutant = "pm25" | "pm10";
