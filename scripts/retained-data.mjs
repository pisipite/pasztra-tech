// A failed refresh is not a zero measurement. Keep source timestamps separate
// from refreshedAt (the completion time of the collection attempt).
export function sourceWarning(source, updatedAt) {
  return { source, updatedAt, message: updatedAt ? "Nem frissült; az utolsó adat látható." : "Nem érkezett adat." };
}

export function mergeDashboard({ previous, solar, govee, forecast, now = new Date(), warnings = [] }) {
  const old = previous?.source !== "demo" ? previous : undefined;
  const connection = (name, fresh, timestamp, retained) => fresh
    ? { connected: true, updatedAt: timestamp }
    : { connected: false, stale: Boolean(retained), updatedAt: retained ? old?.connections?.[name]?.updatedAt ?? old?.updatedAt : undefined };
  const connections = {
    solar: connection("solar", solar, now.toISOString(), old?.solar?.chart?.length || old?.solar?.energyChart?.length),
    climate: connection("climate", govee, govee?.devices[0]?.updatedAt, old?.govee?.devices?.length || old?.govee?.chart?.length),
  };
  const timestamps = Object.values(connections).map((item) => item.updatedAt).filter((value) => Number.isFinite(Date.parse(value)));
  return {
    source: solar && govee ? "live" : "partial",
    updatedAt: timestamps.sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) ?? old?.updatedAt ?? now.toISOString(),
    refreshedAt: now.toISOString(),
    connections,
    warnings: [
      ...(!solar ? [sourceWarning("Sungrow", connections.solar.updatedAt)] : []),
      ...(!govee ? [sourceWarning("Govee", connections.climate.updatedAt)] : []),
      ...(!forecast ? [sourceWarning("Előrejelzés", old?.forecast?.updatedAt)] : []),
      ...warnings,
    ],
    solar: solar ?? (connections.solar.stale ? { ...old.solar, status: "warning" } : {
      status: "offline", currentPowerKw: 0, todayKwh: 0, monthKwh: 0,
      lifetimeMwh: 0, selfConsumptionPct: 0, co2SavedKg: 0, houseLoadKw: 0,
      gridPowerKw: 0, chart: [], energyChart: [],
    }),
    govee: govee ?? old?.govee ?? { devices: [], chart: [] },
    ...((forecast ?? old?.forecast) ? { forecast: forecast ?? old.forecast } : {}),
  };
}

export function mergeEnergyMix(previous, fresh, household) {
  const base = fresh ?? (previous?.source !== "demo" ? previous : undefined);
  if (!base) return null;
  return {
    ...base,
    stale: !fresh || Boolean(fresh.stale),
    // Independent sources: a successful country request must not erase the
    // house history, and a country outage must not prevent house updates.
    household: household ?? previous?.household,
  };
}

export function retainNews(previous, now = new Date()) {
  if (!previous || previous.source === "demo") return null;
  return {
    ...previous,
    sources: previous.sources.map((source) => ({
      ...source, status: source.status === "setup-required" ? source.status : "offline", checkedAt: now.toISOString(),
    })),
  };
}
