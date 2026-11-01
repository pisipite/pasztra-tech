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
}
