import type { DashboardData, RangeKey } from "./types";

const wave = (count: number, max: number, phase = 0) =>
  Array.from({ length: count }, (_, i) => {
    const daylight = Math.max(0, Math.sin(((i / (count - 1)) * Math.PI) - 0.15));
    const cloud = 0.88 + Math.sin(i * 1.8 + phase) * 0.08;
    return Math.max(0, Number((daylight * max * cloud).toFixed(2)));
  });

const labels: Record<RangeKey, string[]> = {
  today: ["06:00", "07:00", "08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00"],
  "7d": ["H", "K", "Sze", "Cs", "P", "Szo", "V"],
  "30d": Array.from({ length: 30 }, (_, index) => `${index + 1}.`),
  year: ["Jan", "Feb", "Már", "Ápr", "Máj", "Jún", "Júl", "Aug", "Szept", "Okt", "Nov", "Dec"],
};

export function makeDemoData(range: RangeKey): DashboardData {
  const solarValues = range === "today"
    ? wave(labels[range].length, 6.4, 0.2)
    : range === "7d"
      ? [24.1, 28.7, 19.4, 31.2, 30.4, 26.8, 29.6]
      : range === "30d"
        ? Array.from({ length: 30 }, (_, index) => Number((18 + Math.sin(index * .74) * 7 + Math.cos(index * .31) * 4).toFixed(1)))
        : [183, 215, 342, 428, 516, 588, 632, 410, 322, 241, 126, 71];

  const climateLabels = range === "today"
    ? ["0", "3", "6", "9", "12", "15", "18", "21", "24"]
    : labels[range];
  const now = new Date();
  const climate = climateLabels.map((label, index) => ({
    label,
    temperature: Number((22.3 + Math.sin(index * 0.72 - 1) * 1.4).toFixed(1)),
    humidity: Math.round(50 - Math.sin(index * 0.72 - 1) * 5),
  }));
  const energyChart = labels[range].map((label, index) => {
    const pv = solarValues[index] ?? 0;
    const isPower = range === "today";
    const load = isPower
      ? Number((1.2 + Math.sin(index * .83) * .35 + (index > 10 ? .4 : 0)).toFixed(2))
      : Number((pv * (.58 + Math.sin(index * .41) * .08)).toFixed(1));
    const timestamp = new Date(now);
    if (range === "today") timestamp.setHours(index + 6, 0, 0, 0);
    if (range === "7d") timestamp.setDate(now.getDate() - (labels[range].length - 1 - index));
    if (range === "30d") timestamp.setDate(index + 1);
    if (range === "year") timestamp.setMonth(index, 1);
    return {
      label,
      timestamp: timestamp.toISOString(),
      pv,
      load,
      grid: Number((load - pv).toFixed(2)),
      battery: isPower ? Number((Math.sin(index * .9) * .28).toFixed(2)) : 0,
      batterySoc: isPower ? Math.min(100, 74 + index * 1.7) : undefined,
      temperature: climate[Math.min(index, climate.length - 1)]?.temperature,
      humidity: climate[Math.min(index, climate.length - 1)]?.humidity,
    };
  });

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
      energyChart,
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
      chart: climate,
    },
  };
}
