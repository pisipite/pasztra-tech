// Historical readings need their own units, not the current device's display
// unit. getDevicePointMinuteDataList supplies units per value;
// getPowerStationData supplies p83033_unit / p83106_unit for its power lists.
export const SUNGROW_FLOW_SCHEMA = 3;

function scalar(value) {
  if (value && typeof value === "object") {
    if (value.valid === false) return undefined;
    return scalar(value.value ?? value.value_float ?? value.value_int
      ?? value.float ?? value.integer ?? value.string ?? value.stringValue ?? value.value_string);
  }
  return value;
}

export function powerKw(value, unit) {
  const raw = scalar(value);
  if (raw === null || raw === undefined || typeof raw === "boolean" || String(raw).trim() === "") return Number.NaN;
  const amount = Number(raw);
  if (!Number.isFinite(amount)) return Number.NaN;
  const declaredUnit = scalar(value?.unit ?? unit);
  const scale = { w: 0.001, kw: 1, mw: 1000 }[String(declaredUnit ?? "").trim().toLowerCase()];
  if (scale === undefined) {
    throw new Error(`Sungrow teljesítmény: hiányzó vagy ismeretlen mértékegység (${declaredUnit ?? "nincs"}).`);
  }
  return amount * scale;
}

export function powerKwList(values, unit) {
  // Keep missing samples in place: filtering them would shift all later times.
  return Array.isArray(values) ? values.map((value) => powerKw(value, unit)) : [];
}

export function extractDeviceSamples(root, pointFields, parseTimestamp) {
  const rows = new Map();
  const queue = [root];
  const powerFields = new Set(["gridKw", "chargeKw", "dischargeKw"]);
  while (queue.length) {
    const item = queue.shift();
    if (!item || typeof item !== "object") continue;
    const timestamp = parseTimestamp(item.time_stamp ?? item.timestamp);
    if (timestamp) {
      // GoSungrow wraps values in "points"; the provider puts p8018 etc.
      // directly alongside time_stamp.
      const points = item.points ?? item;
      const row = rows.get(timestamp.toISOString()) ?? { timestamp: timestamp.toISOString() };
      for (const [pointId, field] of Object.entries(pointFields)) {
        const raw = points[pointId];
        if (raw === undefined || raw === null) continue;
        const number = scalar(raw);
        if (number === undefined || number === null || String(number).trim() === "") continue;
        const value = powerFields.has(field) ? powerKw(raw) : Number(number);
        if (Number.isFinite(value)) {
          row[field] = value;
          if (field === "soc") row.socUnit = scalar(raw?.unit);
        }
      }
      if (Object.keys(row).length > 1) rows.set(row.timestamp, row);
    }
    queue.push(...Object.values(item).filter((value) => value && typeof value === "object"));
  }
  return [...rows.values()].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

export function batteryFlowKw(pv, load, grid, measuredBattery) {
  return Number.isFinite(grid) ? load - pv - grid : measuredBattery;
}

export function isCurrentSungrowDay(value) {
  return value?.flowSchema === SUNGROW_FLOW_SCHEMA
    && Array.isArray(value.energyChart) && value.energyChart.length > 0;
}
