export type RangeKey = "today" | "7d" | "30d";

export interface ChartPoint {
  label: string;
  value: number;
}

export interface ClimatePoint {
  label: string;
  temperature: number;
  humidity: number;
}

export interface SolarData {
  status: "online" | "offline" | "warning";
  currentPowerKw: number;
  todayKwh: number;
  monthKwh: number;
  lifetimeMwh: number;
  selfConsumptionPct: number;
  co2SavedKg: number;
  houseLoadKw: number;
  gridPowerKw: number;
  chart: ChartPoint[];
}

export interface GoveeDevice {
  id: string;
  name: string;
  room: string;
  temperatureC: number;
  humidityPct: number;
  batteryPct: number;
  updatedAt: string;
}

export interface DashboardData {
  source?: "demo" | "live" | "partial";
  updatedAt: string;
  solar: SolarData;
  govee: {
    devices: GoveeDevice[];
    chart: ClimatePoint[];
  };
}

declare global {
  interface Window {
    SOLAR_HOME_CONFIG?: {
      mode?: "demo" | "live";
      endpoint?: string;
      refreshSeconds?: number;
    };
  }
}
