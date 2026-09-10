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
  gridPurchase?: number;
  gridFeedIn?: number;
  battery?: number;
  batteryCharge?: number;
  batteryDischarge?: number;
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

export interface BulgariaEnergyMixPoint {
  timestamp: string;
  nuclear: number;
  coal: number;
  gas: number;
  hydro: number;
  solar: number;
  wind: number;
  other: number;
  imports: number;
  load: number;
  renewableSharePct: number;
}

export type BulgariaPowerPlantType = "nuclear" | "coal" | "gas" | "hydro" | "solar" | "wind" | "other";

export interface BulgariaPowerPlantDay {
  date: string;
  energyMwh: number;
  averageMw: number;
  peakMw: number;
  hourlyMw: number[];
  hourlyCoverage?: number[];
  observedHours?: number;
}

export interface BulgariaPowerPlant {
  id: string;
  name: string;
  type: BulgariaPowerPlantType;
  latitude: number;
  longitude: number;
  capacityMw?: number;
  days: BulgariaPowerPlantDay[];
}

export interface BulgariaEnergyMixData {
  source: "live" | "demo";
  updatedAt: string;
  availableFrom?: string;
  availableUntil?: string;
  unit: "MW";
  resolutionMinutes: number;
  license: string;
  sourceUrl: string;
  sourceName?: string;
  points: BulgariaEnergyMixPoint[];
  plants?: BulgariaPowerPlant[];
  plantsUpdatedAt?: string;
  plantDataFrom?: string;
  plantDataUntil?: string;
  household?: {
    hourly: EnergyChartPoint[];
    daily: EnergyChartPoint[];
    monthly: EnergyChartPoint[];
  };
}

export interface SolarData {
  status: "online" | "offline" | "warning";
  currentPowerKw: number;
  batteryTemperatureC?: number;
  batteryVoltageV?: number;
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

export interface WeatherTwin {
  city: string;
  country: string;
  locative: string;
  temperatureC: number;
  humidityPct: number;
  score: number;
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
    weatherTwins?: WeatherTwin[];
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
