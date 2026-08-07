import type { DashboardData, RangeKey } from "./types";

const wave = (count: number, max: number, phase = 0) =>
  Array.from({ length: count }, (_, i) => {
    const daylight = Math.max(0, Math.sin(((i / (count - 1)) * Math.PI) - 0.15));
    const cloud = 0.88 + Math.sin(i * 1.8 + phase) * 0.08;
    return Math.max(0, Number((daylight * max * cloud).toFixed(2)));
  });

const labels: Record<RangeKey, string[]> = {
  today: ["6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20"],
  "7d": ["H", "K", "Sze", "Cs", "P", "Szo", "V"],
  "30d": ["1", "5", "9", "13", "17", "21", "25", "30"],
};

export function makeDemoData(range: RangeKey): DashboardData {
  const solarValues = range === "today"
    ? wave(labels[range].length, 6.4, 0.2)
    : range === "7d"
      ? [24.1, 28.7, 19.4, 31.2, 30.4, 26.8, 29.6]
      : [26.2, 22.4, 30.8, 27.1, 18.9, 29.7, 31.4, 25.8];

  const climateLabels = range === "today"
    ? ["0", "3", "6", "9", "12", "15", "18", "21", "24"]
    : labels[range];

  return {
    source: "demo",
    updatedAt: new Date().toISOString(),
    solar: {
      status: "online",
      currentPowerKw: 4.82,
      todayKwh: 24.7,
      monthKwh: 428,
      lifetimeMwh: 18.6,
      selfConsumptionPct: 73,
      co2SavedKg: 11.3,
      houseLoadKw: 2.16,
      gridPowerKw: -2.66,
      chart: labels[range].map((label, index) => ({ label, value: solarValues[index] })),
    },
    govee: {
      devices: [
        {
          id: "living-room",
          name: "Govee H5179",
          room: "Nappali",
          temperatureC: 23.4,
          humidityPct: 48,
          batteryPct: 86,
          updatedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
        },
        {
          id: "bedroom",
          name: "Govee H5075",
          room: "Hálószoba",
          temperatureC: 22.1,
          humidityPct: 52,
          batteryPct: 72,
          updatedAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
        },
      ],
      chart: climateLabels.map((label, index) => ({
        label,
        temperature: Number((22.3 + Math.sin(index * 0.72 - 1) * 1.4).toFixed(1)),
        humidity: Math.round(50 - Math.sin(index * 0.72 - 1) * 5),
      })),
    },
  };
}
