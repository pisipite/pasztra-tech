import type { BulgariaEnergyMixData, BulgariaEnergyMixPoint, BulgariaPowerPlant, BulgariaPowerPlantType } from "./types";

export function makeDemoBulgariaEnergyMix(): BulgariaEnergyMixData {
  const now = new Date();
  const start = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate() - 7);
  start.setHours(0, 0, 0, 0);
  const points: BulgariaEnergyMixPoint[] = [];
  const hours = Math.ceil((now.getTime() - start.getTime()) / 3_600_000);

  for (let index = 0; index <= hours; index += 3) {
    const timestamp = new Date(start.getTime() + index * 3_600_000);
    const hour = timestamp.getHours();
    const day = index / 24;
    const daylight = Math.max(0, Math.sin(((hour - 6) / 13) * Math.PI));
    const nuclear = 1820 + Math.sin(day * .08) * 45;
    const coal = 1080 + Math.sin(day * .31 + 1.2) * 210;
    const gas = 170 + Math.max(0, Math.sin(((hour - 15) / 9) * Math.PI)) * 150;
    const hydro = 250 + Math.sin(day * .57) * 80 + Math.max(0, Math.sin(((hour - 17) / 7) * Math.PI)) * 210;
    const solar = daylight * (980 + Math.sin(day * .7) * 220);
    const wind = 180 + Math.sin(day * .41 + 2.1) * 110;
    const other = 75;
    const load = 3300 + Math.max(0, Math.sin(((hour - 7) / 14) * Math.PI)) * 1250;
    const generation = nuclear + coal + gas + hydro + solar + wind + other;
    points.push({
      timestamp: timestamp.toISOString(),
      nuclear: Math.max(0, nuclear),
      coal: Math.max(0, coal),
      gas: Math.max(0, gas),
      hydro: Math.max(0, hydro),
      solar: Math.max(0, solar),
      wind: Math.max(0, wind),
      other,
      imports: Math.max(0, load - generation),
      load,
      renewableSharePct: Math.min(100, ((hydro + solar + wind + other) / generation) * 100),
    });
  }

  const plantSeeds: Array<[string, string, BulgariaPowerPlantType, number, number, number, number]> = [
    ["kozloduy", "Kozloduj Atomerőmű", "nuclear", 43.746, 23.77, 2080, .89],
    ["maritsa-east-2", "Marica Iztok 2", "coal", 42.255, 26.132, 1620, .53],
    ["aes-galabovo", "AES Galabovo", "coal", 42.162, 25.886, 670, .67],
    ["maritsa-east-3", "Marica Iztok 3", "coal", 42.147, 26.016, 908, .56],
    ["chaira", "Chaira Szivattyús Erőmű", "hydro", 42.006, 23.805, 864, .24],
    ["belmeken", "Belmeken Vízerőmű", "hydro", 42.165, 23.805, 375, .38],
    ["bobov-dol", "Bobov Dol Hőerőmű", "coal", 42.307, 23.025, 630, .31],
    ["varna", "Várnai Hőerőmű", "gas", 43.198, 27.695, 1260, .12],
  ];
  const dayFormatter = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" });
  const plants: BulgariaPowerPlant[] = plantSeeds.map(([id, name, type, latitude, longitude, capacityMw, factor], plantIndex) => ({
    id,
    name,
    type,
    latitude,
    longitude,
    capacityMw,
    days: Array.from({ length: 31 }, (_, dayIndex) => {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 36 + dayIndex);
      const variation = .86 + Math.sin(dayIndex * .61 + plantIndex) * .11;
      const averageMw = capacityMw * factor * variation;
      return {
        date: dayFormatter.format(date),
        energyMwh: Math.round(averageMw * 24 * 10) / 10,
        averageMw: Math.round(averageMw * 10) / 10,
        peakMw: Math.round(Math.min(capacityMw, averageMw * 1.18) * 10) / 10,
        hourlyMw: Array.from({ length: 24 }, (_, hour) => Math.round(Math.max(0, averageMw * (.94 + Math.sin((hour - 7) / 24 * Math.PI * 2) * .06)) * 10) / 10),
      };
    }),
  }));

  return {
    source: "demo",
    updatedAt: now.toISOString(),
    availableFrom: points[0]?.timestamp,
    availableUntil: points.at(-1)?.timestamp,
    unit: "MW",
    resolutionMinutes: 180,
    license: "Mintaadat",
    sourceUrl: "https://www.energy-charts.info/charts/power/chart.htm?c=BG&l=en",
    sourceName: "Energy-Charts.info",
    points,
    plants,
    plantsUpdatedAt: now.toISOString(),
    plantDataFrom: plants[0]?.days[0]?.date,
    plantDataUntil: plants[0]?.days.at(-1)?.date,
  };
}
