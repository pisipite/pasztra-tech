export interface ClimateHistorySample {
  timestamp?: string;
  temperature: number;
  humidity: number;
}

export interface CurrentClimateReading {
  temperatureC: number;
  humidityPct: number;
  updatedAt: string;
}

export type ClimateChange =
  | { status: "stale" | "insufficient" }
  | { status: "ok"; temperatureDeltaC: number; humidityDeltaPoints: number; from: string; to: string };

export function dewPointC(temperatureC: number, humidityPct: number): number | null;
export function recentClimateChange(history: ClimateHistorySample[], current: CurrentClimateReading, nowMs?: number): ClimateChange;
