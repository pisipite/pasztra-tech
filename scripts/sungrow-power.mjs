// Prefer each historical reading's own unit. Some GoSungrow readings have an
// empty unit; only then use the same point's declared queryDeviceList unit.
// getPowerStationData supplies p83033_unit / p83106_unit for its power lists.
export const SUNGROW_FLOW_SCHEMA = 4;

function scalar(value) {
  if (value && typeof value === "object") {
    if (value.valid === false) return undefined;
    return scalar(value.value ?? value.value_float ?? value.value_int
      ?? value.float ?? value.integer ?? value.string ?? value.stringValue ?? value.value_string ?? value.point);
  }
  return value;
}

export function powerKw(value, unit) {
  const raw = scalar(value);
  if (raw === null || raw === undefined || typeof raw === "boolean" || String(raw).trim() === "") return Number.NaN;
  const amount = Number(raw);
  if (!Number.isFinite(amount)) return Number.NaN;
  const sampleUnit = scalar(value?.unit);
  const declaredUnit = String(sampleUnit ?? "").trim() ? sampleUnit : scalar(unit);
  const scale = { w: 0.001, kw: 1, mw: 1000 }[String(declaredUnit ?? "").trim().toLowerCase()];
  if (scale === undefined) {
    throw new Error(`Sungrow teljesítmény: hiányzó vagy ismeretlen mértékegység (${declaredUnit ?? "nincs"}).`);
  }
  return amount * scale;
}

export function devicePointUnits(pointData) {
  if (!Array.isArray(pointData)) return {};
  return Object.fromEntries(pointData.flatMap((point) => {
    const id = String(scalar(point?.point_id ?? point?.pointId) ?? "").trim();
    const unit = String(scalar(point?.unit) ?? "").trim();
    return id && unit ? [[id, unit]] : [];
  }));
}

export function powerKwList(values, unit) {
  // Keep missing samples in place: filtering them would shift all later times.
  return Array.isArray(values) ? values.map((value) => powerKw(value, unit)) : [];
}

export function extractDeviceSamples(root, pointFields, parseTimestamp, pointUnits = {}) {
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
        const value = powerFields.has(field) ? powerKw(raw, pointUnits[pointId]) : Number(number);
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
  return [pv, load, grid].every(Number.isFinite) ? load - pv - grid : measuredBattery;
}

export function isCurrentSungrowDay(value) {
  return value?.flowSchema === SUNGROW_FLOW_SCHEMA
    && Array.isArray(value.energyChart) && value.energyChart.length > 0;
}

// Only observed adjacent intervals contribute; a shortened current-day series
// must never be stretched to 24 hours. Omit incomplete counters, not zero-fill.
export function integratePowerDay(points) {
  const fields = { pv: ["pv", 1], load: ["load", 1], gridPurchase: ["grid", 1], gridFeedIn: ["grid", -1], batteryCharge: ["battery", -1], batteryDischarge: ["battery", 1] };
  const totals = {};
  if (points.length < 2) return totals;
  for (const [output, [field, sign]] of Object.entries(fields)) {
    let total = 0;
    let complete = true;
    for (let index = 0; index < points.length - 1; index++) {
      const point = points[index], next = points[index + 1];
      const hours = (Date.parse(next.timestamp) - Date.parse(point.timestamp)) / 3_600_000;
      if (!(hours > 0 && hours <= .5) || !Number.isFinite(point[field]) || !Number.isFinite(next[field])) { complete = false; break; }
      total += Math.max(0, sign * point[field]) * hours;
    }
    if (complete) totals[output] = Math.round(total * 1000) / 1000;
  }
  return totals;
}
