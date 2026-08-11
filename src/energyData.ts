import type { ClimatePoint, DashboardData, EnergyChartPoint, PeriodKey } from "./types";

function climateBucketKey(timestamp: string, period: PeriodKey) {
  const time = new Date(timestamp);
  const year = time.getFullYear();
  const month = String(time.getMonth() + 1).padStart(2, "0");
  return period === "year"
    ? `${year}-${month}`
    : `${year}-${month}-${String(time.getDate()).padStart(2, "0")}`;
}

function averageClimateByPeriod(climate: ClimatePoint[], period: PeriodKey) {
  if (period === "day" || !climate.every((point) => point.timestamp)) return climate;

  const groups = new Map<string, {
    first: ClimatePoint;
    temperatureTotal: number;
    temperatureCount: number;
    humidityTotal: number;
    humidityCount: number;
  }>();

  for (const point of climate) {
    const key = climateBucketKey(point.timestamp!, period);
    const group = groups.get(key) ?? {
      first: point,
      temperatureTotal: 0,
      temperatureCount: 0,
      humidityTotal: 0,
      humidityCount: 0,
    };
    if (Number.isFinite(point.temperature)) {
      group.temperatureTotal += point.temperature;
      group.temperatureCount += 1;
    }
    if (Number.isFinite(point.humidity)) {
      group.humidityTotal += point.humidity;
      group.humidityCount += 1;
    }
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => ({
    ...group.first,
    temperature: group.temperatureCount ? group.temperatureTotal / group.temperatureCount : group.first.temperature,
    humidity: group.humidityCount ? group.humidityTotal / group.humidityCount : group.first.humidity,
  }));
}

function closestEnergyPoint(points: EnergyChartPoint[], climatePoint: ClimatePoint, period: PeriodKey) {
  if (!climatePoint.timestamp) return -1;
  if (period !== "day") {
    const key = climateBucketKey(climatePoint.timestamp, period);
    return points.findIndex((point) => point.timestamp && climateBucketKey(point.timestamp, period) === key);
  }

  const climateTime = new Date(climatePoint.timestamp).getTime();
  let match = -1;
  let smallestDistance = 11 * 60_000;
  points.forEach((point, index) => {
    if (!point.timestamp) return;
    const distance = Math.abs(new Date(point.timestamp).getTime() - climateTime);
    if (distance < smallestDistance) {
      smallestDistance = distance;
      match = index;
    }
  });
  return match;
}

export function mergeEnergyAndClimate(data: DashboardData, period: PeriodKey) {
  const climate = averageClimateByPeriod(data.govee.chart, period);
  const energy: EnergyChartPoint[] = data.solar.energyChart ?? data.solar.chart.map((point, index) => ({
    label: point.label,
    pv: point.value,
    temperature: climate[index]?.temperature,
    humidity: climate[index]?.humidity,
  }));
  const merged = energy.map((point) => ({ ...point }));

  climate.forEach((climatePoint, climateIndex) => {
    let match = closestEnergyPoint(merged, climatePoint, period);
    if (match < 0 && climate.length === merged.length) match = climateIndex;
    const climateValues = { temperature: climatePoint.temperature, humidity: climatePoint.humidity };
    if (match >= 0) merged[match] = { ...merged[match], ...climateValues };
    else merged.push({ label: climatePoint.label, timestamp: climatePoint.timestamp, ...climateValues });
  });

  return merged.sort((a, b) => {
    if (!a.timestamp || !b.timestamp) return 0;
    return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
  });
}

export function batteryChargeValue(point: EnergyChartPoint) {
  if (Number.isFinite(point.batteryCharge)) return -Math.abs(point.batteryCharge!);
  return Number.isFinite(point.battery) && point.battery! < 0 ? point.battery : undefined;
}

export function batteryDischargeValue(point: EnergyChartPoint) {
  if (Number.isFinite(point.batteryDischarge)) return Math.abs(point.batteryDischarge!);
  return Number.isFinite(point.battery) && point.battery! > 0 ? point.battery : undefined;
}
