export type SensorMetric = "pm25" | "pm10" | "temperature" | "humidity" | "pressure";
export interface SensorPoint {
  timestamp: string;
  pm25?: number;
  pm10?: number;
  temperature?: number;
  humidity?: number;
  pressure?: number;
  observedAt?: Partial<Record<SensorMetric, string>>;
}
export interface SensorChartPoint extends SensorPoint {
  ranges?: Partial<Record<SensorMetric, { min: number; max: number }>>;
}
export interface SensorWeatherTwin {
  city: string;
  country: string;
  locative: string;
  temperatureC: number;
  humidityPct: number;
  observedAt: number;
}
export interface PersonalSensorData {
  sensorId: string;
  sensorName: string;
  source: string;
  sourceUrl: string;
  checkedAt: string;
  updatedAt: string | null;
  status: "ok" | "stale" | "unavailable";
  error?: string | null;
  bucketMinutes: number;
  latest: Partial<Record<SensorMetric, { value: number; timestamp: string }>>;
  points: SensorPoint[];
  weatherTwins?: SensorWeatherTwin[];
}
