import type { EnergyChartPoint } from "../../types";

export function householdSummary(points: EnergyChartPoint[], powerValues: boolean) {
  let load = 0, grid = 0, battery = 0;
  let hasLoad = false;
  let complete = points.length > 0;
  for (const [index, point] of points.entries()) {
    // Integrate only adjacent observed intervals, never across an outage or past
    // the final reading. Aggregated kWh counters are used without integration.
    const next = points[index + 1];
    const hours = next ? (Date.parse(next.timestamp ?? "") - Date.parse(point.timestamp ?? "")) / 3_600_000 : 0;
    if (powerValues && !next) continue;
    if (powerValues && (!Number.isFinite(hours) || hours <= 0 || hours > .5)) { complete = false; continue; }
    const factor = powerValues ? hours : 1;
    if (!Number.isFinite(point.load) || (powerValues && !Number.isFinite(next?.load))) { complete = false; continue; }
    hasLoad = true;
    const demand = Math.max(0, point.load!) * factor;
    load += demand;
    const imported = powerValues ? point.grid : point.gridPurchase;
    const discharged = powerValues ? point.battery : point.batteryDischarge;
    if (!Number.isFinite(imported) || !Number.isFinite(discharged)) { complete = false; continue; }
    grid += Math.min(demand, Math.max(0, imported!) * factor);
    battery += Math.min(Math.max(0, demand - Math.max(0, imported!) * factor), Math.max(0, discharged!) * factor);
  }
  return { load, grid, battery, directPv: Math.max(0, load - grid - battery), hasLoad, hasBreakdown: hasLoad && complete, estimated: powerValues || points.some((point) => point.estimated) };
}
