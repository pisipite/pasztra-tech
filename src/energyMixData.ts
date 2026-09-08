import type { BulgariaEnergyMixData, BulgariaEnergyMixPoint } from "./types";

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

  return {
    source: "demo",
    updatedAt: now.toISOString(),
    availableFrom: points[0]?.timestamp,
    availableUntil: points.at(-1)?.timestamp,
    unit: "MW",
    resolutionMinutes: 180,
    license: "Mintaadat",
    sourceUrl: "https://www.energy-charts.info/charts/power/chart.htm?c=BG&l=en",
    points,
  };
}
