export type RangeKey = "today" | "7d" | "30d" | "year";
export type PeriodKey = "day" | "week" | "month" | "year" | "custom";

export interface ChartPoint {
  label: string;
  value: number;
}

export interface EnergyChartPoint {
  label: string;
  timestamp?: string;
  pv?: number;
  grid?: number;
  battery?: number;
  load?: number;
  batterySoc?: number;
  temperature?: number;
  humidity?: number;
}

export interface ClimatePoint {
  label: string;
  timestamp?: string;
  temperature: number;
  humidity: number;
}

export interface SolarForecastPoint {
  label: string;
  timestamp: string;
  expectedPowerKw: number;
  irradianceWm2: number;
  cloudCoverPct: number;
  precipitationProbabilityPct: number;
}

export interface SolarForecastDay {
  date: string;
  label: string;
  expectedKwh: number;
  bestWindow: string;
  points: SolarForecastPoint[];
}

export interface SolarForecast {
  updatedAt: string;
  systemKwp: number;
  tiltDeg: number;
  azimuthDeg: number;
  performanceRatio: number;
  days: SolarForecastDay[];
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
  energyChart?: EnergyChartPoint[];
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

export interface DataConnection {
  connected: boolean;
  updatedAt?: string;
}

export interface DashboardData {
  source?: "demo" | "live" | "partial";
  updatedAt: string;
  connections?: {
    solar: DataConnection;
    climate: DataConnection;
  };
  solar: SolarData;
  govee: {
    devices: GoveeDevice[];
    chart: ClimatePoint[];
  };
  forecast?: SolarForecast;
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
