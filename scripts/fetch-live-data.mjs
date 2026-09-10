import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { entsoeMetadata, fetchEntsoeBulgariaMix } from "./entsoe-energy-mix.mjs";
import { repairNuclearDropouts } from "./energy-mix-repair.mjs";

const execFileAsync = promisify(execFile);
const outputDir = resolve("public/data");
const historyDir = resolve(".data-history");
const historyFile = resolve(historyDir, "govee-history.json");
const energyHistoryFile = resolve(historyDir, "sungrow-energy-history.json");
const bulgariaMixHistoryFile = resolve(historyDir, "bulgaria-energy-mix.json");
const weatherTwinHistoryFile = resolve(historyDir, "weather-twins.json");
const sungrowDayHistoryDir = resolve(historyDir, "sungrow-days");
const now = new Date();
const pad = (value) => String(value).padStart(2, "0");
const dayId = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
const monthId = dayId.slice(0, 6);
const yearId = dayId.slice(0, 4);
const climateRetentionMs = 370 * 86_400_000;
const weatherTwinCacheMs = 30 * 60_000;
const sungrowDayRetention = Math.max(7, Math.min(62, numberFromEnvironment("SUNGROW_DAY_HISTORY_DAYS", 31)));

function numberFromEnvironment(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function localDateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localMonthKey(value) {
  return localDateKey(value).slice(0, 7);
}

function isValidClimateSample(sample) {
  return Number.isFinite(sample?.temperature)
    && sample.temperature !== 0
    && Number.isFinite(sample?.humidity)
    && sample.humidity !== 0;
}

function averageClimate(samples, keyType) {
  const groups = new Map();
  for (const sample of samples.filter(isValidClimateSample)) {
    const key = keyType === "month" ? localMonthKey(sample.timestamp) : localDateKey(sample.timestamp);
    const group = groups.get(key) ?? { temperature: 0, humidity: 0, count: 0 };
    group.temperature += sample.temperature;
    group.humidity += sample.humidity;
    group.count += 1;
    groups.set(key, group);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, group]) => {
    const [year, month, day = "1"] = key.split("-").map(Number);
    const timestamp = new Date(year, month - 1, day, 12).toISOString();
    return {
      label: keyType === "month"
        ? new Intl.DateTimeFormat("hu-HU", { month: "short" }).format(new Date(timestamp))
        : `${day}.${month}.`,
      timestamp,
      temperature: group.temperature / group.count,
      humidity: group.humidity / group.count,
    };
  });
}

async function readClimateHistory() {
  try {
    return JSON.parse(await readFile(historyFile, "utf8"));
  } catch { /* restore from the last published Pages deployment */ }

  const historyUrl = process.env.CLIMATE_HISTORY_URL;
  if (!historyUrl) return [];
  try {
    const response = await fetch(historyUrl, { headers: { Accept: "application/json" } });
    if (!response.ok) return [];
    return await response.json();
  } catch {
    return [];
  }
}

async function updateClimateHistory(govee) {
  const stored = await readClimateHistory();
  const current = govee.devices[0];
  const bucketTime = Math.floor(now.getTime() / 300_000) * 300_000;
  const sample = {
    timestamp: new Date(bucketTime).toISOString(),
    temperature: current.temperatureC,
    humidity: current.humidityPct,
  };
  const earliest = now.getTime() - climateRetentionMs;
  const byTimestamp = new Map(
    (Array.isArray(stored) ? stored : [])
      .filter((item) => isValidClimateSample(item) && new Date(item?.timestamp).getTime() >= earliest)
      .map((item) => [item.timestamp, item]),
  );
  if (isValidClimateSample(sample)) byTimestamp.set(sample.timestamp, sample);
  const history = [...byTimestamp.values()].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  await Promise.all([mkdir(historyDir, { recursive: true }), mkdir(outputDir, { recursive: true })]);
  const serialized = `${JSON.stringify(history, null, 2)}\n`;
  await Promise.all([
    writeFile(historyFile, serialized, "utf8"),
    writeFile(resolve(outputDir, "govee-history.json"), serialized, "utf8"),
  ]);

  const todayKey = localDateKey(now);
  const days = Object.fromEntries([...new Set(history.map((item) => localDateKey(item.timestamp)))].map((key) => [key, history
    .filter((item) => localDateKey(item.timestamp) === key)
    .map((item) => ({
      label: new Intl.DateTimeFormat("hu-HU", { hour: "2-digit", minute: "2-digit" }).format(new Date(item.timestamp)),
      ...item,
    }))]));
  return {
    today: days[todayKey] ?? [],
    "7d": averageClimate(history, "day"),
    "30d": averageClimate(history, "day"),
    year: averageClimate(history, "month"),
    days,
  };
}

function demoDashboard(range) {
  const chart = range === "today"
    ? [0, 0.2, 1.1, 2.6, 4.1, 5.2, 5.8, 5.5, 4.7, 3.3, 1.8, 0.5, 0].map((value, index) => ({ label: String(index + 6), value }))
    : range === "7d"
      ? [24.1, 28.7, 19.4, 31.2, 30.4, 26.8, 29.6].map((value, index) => ({ label: String(index + 1), value }))
      : range === "30d"
        ? [26.2, 22.4, 30.8, 27.1, 18.9, 29.7, 31.4, 25.8].map((value, index) => ({ label: String(index * 4 + 1), value }))
        : [183, 215, 342, 428, 516, 588, 632, 410, 322, 241, 126, 71].map((value, index) => ({ label: String(index + 1), value }));
  return {
    source: "demo",
    updatedAt: now.toISOString(),
    connections: {
      solar: { connected: false },
      climate: { connected: false },
    },
    solar: {
      status: "online",
      currentPowerKw: 4.82,
      batteryTemperatureC: 26.4,
      batteryVoltageV: 391.8,
      todayKwh: 24.7,
      monthKwh: 428,
      lifetimeMwh: 18.6,
      selfConsumptionPct: 73,
      co2SavedKg: 5.8,
      houseLoadKw: 2.16,
      gridPowerKw: -2.66,
      chart,
    },
    govee: {
      devices: [{ id: "demo", name: "Govee thermo-hygrometer", room: "Nappali", temperatureC: 23.4, humidityPct: 48, batteryPct: 86, updatedAt: now.toISOString() }],
      chart: [{ label: pad(now.getHours()), temperature: 23.4, humidity: 48 }],
    },
  };
}

const normalizeKey = (value) => String(value).toLowerCase().replace(/[^a-z0-9]/g, "");

function textValue(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") {
    return textValue(value.string ?? value.value ?? value.point ?? value.ps_key ?? value.stringValue, fallback);
  }
  return fallback;
}

function deepFind(root, names) {
  const wanted = names.map(normalizeKey);
  const queue = [root];
  const seen = new Set();
  while (queue.length) {
    const item = queue.shift();
    if (!item || typeof item !== "object" || seen.has(item)) continue;
    seen.add(item);
    for (const [key, value] of Object.entries(item)) {
      const current = normalizeKey(key);
      if (wanted.some((name) => current === name || current.endsWith(name))) return value;
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return undefined;
}

function numberValue(value, fallback = 0) {
  if (value && typeof value === "object") {
    return numberValue(value.value ?? value.value_float ?? value.value_int ?? value.float ?? value.integer ?? value.string ?? value.stringValue, fallback);
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numberList(value) {
  return Array.isArray(value) ? value.map((item) => numberValue(item, Number.NaN)).filter(Number.isFinite) : [];
}

function powerKwList(value) {
  const values = numberList(value);
  const maximum = Math.max(0, ...values.map(Math.abs));
  return maximum > 100 ? values.map((item) => item / 1000) : values;
}

function currentValue(values) {
  if (!values.length) return 0;
  const minute = now.getHours() * 60 + now.getMinutes();
  const index = Math.min(values.length - 1, Math.floor((minute / 1440) * values.length));
  return values[index] ?? values.at(-1) ?? 0;
}

function sungrowTimestamp(value) {
  return `${value.getFullYear()}${pad(value.getMonth() + 1)}${pad(value.getDate())}${pad(value.getHours())}${pad(value.getMinutes())}${pad(value.getSeconds())}`;
}

function parseSungrowTimestamp(value) {
  const raw = textValue(value);
  if (/^\d{14}$/.test(raw)) {
    return new Date(Number(raw.slice(0, 4)), Number(raw.slice(4, 6)) - 1, Number(raw.slice(6, 8)), Number(raw.slice(8, 10)), Number(raw.slice(10, 12)), Number(raw.slice(12, 14)));
  }
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function findBatteryDevice(root) {
  const devices = deepFind(root, ["pageList"]);
  if (!Array.isArray(devices)) return null;
  const socCandidates = ["p13141", "p83129", "p83252"];

  for (const device of devices) {
    const pointData = deepFind(device, ["pointData"]);
    if (!Array.isArray(pointData)) continue;
    const ids = new Set(pointData.map((point) => textValue(deepFind(point, ["pointId"]))).filter(Boolean));
    const soc = socCandidates.find((point) => ids.has(point));
    if (!ids.has("p13126") || !ids.has("p13150") || !soc) continue;
    const psKey = textValue(deepFind(device, ["psKey"]));
    if (psKey) return {
      psKey,
      charge: "p13126",
      discharge: "p13150",
      soc,
      temperature: ids.has("p13143") ? "p13143" : undefined,
      voltage: ids.has("p13138") ? "p13138" : undefined,
    };
  }
  return null;
}

function findGridMeterDevice(root) {
  const devices = deepFind(root, ["pageList"]);
  if (!Array.isArray(devices)) return null;

  const candidates = devices.flatMap((device) => {
    const pointData = deepFind(device, ["pointData"]);
    if (!Array.isArray(pointData)) return [];
    const ids = new Set(pointData.map((point) => textValue(deepFind(point, ["pointId"]))).filter(Boolean));
    const psKey = textValue(deepFind(device, ["psKey"]));
    return psKey && ids.has("p8018") ? [{ psKey, power: "p8018" }] : [];
  });

  return candidates.find((device) => /_7(?:_|$)/.test(device.psKey)) ?? candidates[0] ?? null;
}

function extractPointSamples(root, pointFields) {
  const pointIds = Object.keys(pointFields);
  const rows = new Map();
  const queue = [{ value: root, key: "", pointId: undefined }];
  const seen = new Set();
  const add = (timestampValue, pointId, rawValue) => {
    const timestamp = parseSungrowTimestamp(timestampValue);
    const value = numberValue(rawValue, Number.NaN);
    if (!timestamp || !Number.isFinite(value)) return;
    const key = timestamp.toISOString();
    const row = rows.get(key) ?? { timestamp: key };
    row[pointFields[pointId]] = value;
    rows.set(key, row);
  };

  while (queue.length) {
    const { value, key: parentKey, pointId: inheritedPointId } = queue.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);

    const points = value.points;
    if (points && typeof points === "object" && !Array.isArray(points)) {
      const timestamp = value.timestamp ?? parentKey;
      for (const [key, rawValue] of Object.entries(points)) {
        const pointId = pointIds.find((candidate) => normalizeKey(key).endsWith(normalizeKey(candidate)));
        if (pointId) add(timestamp, pointId, rawValue);
      }
    }

    for (const [key, child] of Object.entries(value)) {
      const pointId = pointIds.find((candidate) => normalizeKey(key).endsWith(normalizeKey(candidate))) ?? inheritedPointId;
      if (pointId && child && typeof child === "object" && !Array.isArray(child)) {
        for (const [timestamp, rawValue] of Object.entries(child)) {
          if (/^\d{14}$/.test(timestamp)) add(timestamp, pointId, rawValue);
        }
        const timestamp = deepFind(child, ["timestamp", "timeStamp"]);
        const rawValue = deepFind(child, ["value", "valueFloat", "valueInt"]);
        if (timestamp !== undefined && rawValue !== undefined) add(timestamp, pointId, rawValue);
      }
      if (pointId && /^\d{14}$/.test(key) && (typeof child !== "object" || child === null)) add(key, pointId, child);
      if (child && typeof child === "object") queue.push({ value: child, key, pointId });
    }
  }
  return [...rows.values()].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function extractBatterySamples(root, batteryDevice) {
  return extractPointSamples(root, Object.fromEntries([
    [batteryDevice.charge, "chargeKw"],
    [batteryDevice.discharge, "dischargeKw"],
    [batteryDevice.soc, "soc"],
    [batteryDevice.temperature, "temperatureC"],
    [batteryDevice.voltage, "voltageV"],
  ].filter(([pointId]) => pointId))).map((sample) => ({
    ...sample,
    chargeKw: Number.isFinite(sample.chargeKw) ? Math.abs(sample.chargeKw) : sample.chargeKw,
    dischargeKw: Number.isFinite(sample.dischargeKw) ? Math.abs(sample.dischargeKw) : sample.dischargeKw,
  }));
}

function mergeSamples(sampleLists) {
  const byTimestamp = new Map();
  for (const samples of sampleLists) {
    for (const sample of samples) {
      byTimestamp.set(sample.timestamp, { ...byTimestamp.get(sample.timestamp), ...sample });
    }
  }
  return [...byTimestamp.values()].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function normalizeBatteryPower(samples) {
  const maximum = Math.max(0, ...samples.flatMap((sample) => [sample.chargeKw, sample.dischargeKw].filter(Number.isFinite)).map(Math.abs));
  if (maximum <= 100) return samples;
  return samples.map((sample) => ({
    ...sample,
    chargeKw: Number.isFinite(sample.chargeKw) ? sample.chargeKw / 1000 : sample.chargeKw,
    dischargeKw: Number.isFinite(sample.dischargeKw) ? sample.dischargeKw / 1000 : sample.dischargeKw,
  }));
}

function normalizeGridPower(samples) {
  const maximum = Math.max(0, ...samples.map((sample) => sample.gridKw).filter(Number.isFinite).map(Math.abs));
  if (maximum <= 100) return samples;
  return samples.map((sample) => ({
    ...sample,
    gridKw: Number.isFinite(sample.gridKw) ? sample.gridKw / 1000 : sample.gridKw,
  }));
}

function normalizeBatterySoc(samples, socPoint) {
  return samples.map((sample) => {
    if (!Number.isFinite(sample.soc)) return sample;

    // The battery-level device point (p13141) is returned as a 0-1 ratio by
    // iSolarCloud even though GoSungrow labels its unit as percent.
    const percent = socPoint === "p13141" && sample.soc >= 0 && sample.soc <= 1
      ? sample.soc * 100
      : sample.soc;

    return { ...sample, soc: Math.min(100, Math.max(0, percent)) };
  });
}

function nearestSample(samples, timestamp) {
  const target = new Date(timestamp).getTime();
  let closest;
  let distance = 31 * 60_000;
  for (const sample of samples) {
    const currentDistance = Math.abs(new Date(sample.timestamp).getTime() - target);
    if (currentDistance < distance) {
      closest = sample;
      distance = currentDistance;
    }
  }
  return closest;
}

function dayIdFor(value) {
  const date = new Date(value);
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function buildDayCharts(date, production, load, batterySamples = [], gridSamples = []) {
  const chart = production.map((value, index) => {
    const minute = Math.floor((index / Math.max(production.length - 1, 1)) * 1439);
    return { label: `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`, value };
  });
  const energyChart = chart.map((point, index) => {
    const timestamp = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const minute = Math.floor((index / Math.max(chart.length - 1, 1)) * 1439);
    timestamp.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
    const loadValue = load[index] ?? 0;
    const batterySample = nearestSample(batterySamples, timestamp);
    const gridSample = nearestSample(gridSamples, timestamp);
    const grid = gridSample?.gridKw;
    const measuredBattery = Number.isFinite(batterySample?.chargeKw) || Number.isFinite(batterySample?.dischargeKw)
      ? (batterySample?.dischargeKw ?? 0) - (batterySample?.chargeKw ?? 0)
      : undefined;
    // Positive grid means import, positive battery means discharge. With a real
    // grid-meter value the battery flow follows directly from the power balance.
    const battery = Number.isFinite(grid) ? loadValue - point.value - grid : measuredBattery;
    return {
      label: point.label,
      timestamp: timestamp.toISOString(),
      pv: point.value,
      load: loadValue,
      ...(Number.isFinite(grid) ? { grid } : {}),
      ...(Number.isFinite(battery) ? { battery } : {}),
      ...(batterySample ? {
        batteryCharge: batterySample.chargeKw,
        batteryDischarge: batterySample.dischargeKw,
        batterySoc: batterySample.soc,
      } : {}),
    };
  });
  return { flowSchema: 2, chart, energyChart };
}

function summarizeHouseholdDay(dateKey, dayData) {
  const points = dayData?.energyChart ?? [];
  if (!points.length) return null;
  const hoursPerPoint = 24 / points.length;
  const totals = { pv: 0, load: 0, gridPurchase: 0, gridFeedIn: 0, batteryCharge: 0, batteryDischarge: 0 };
  for (const point of points) {
    totals.pv += Math.max(0, Number(point.pv) || 0) * hoursPerPoint;
    totals.load += Math.max(0, Number(point.load) || 0) * hoursPerPoint;
    totals.gridPurchase += Math.max(0, Number(point.grid) || 0) * hoursPerPoint;
    totals.gridFeedIn += Math.max(0, -(Number(point.grid) || 0)) * hoursPerPoint;
    totals.batteryCharge += Math.max(0, -(Number(point.battery) || 0)) * hoursPerPoint;
    totals.batteryDischarge += Math.max(0, Number(point.battery) || 0) * hoursPerPoint;
  }
  const [year, month, day] = dateKey.split("-").map(Number);
  const rounded = Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Math.round(value * 1000) / 1000]));
  return {
    label: `${day}.${month}.`,
    timestamp: new Date(year, month - 1, day, 12).toISOString(),
    ...rounded,
    grid: Math.round((totals.gridPurchase - totals.gridFeedIn) * 1000) / 1000,
  };
}

function householdDailySeries(reported, dayHistory) {
  const byDay = new Map(reported.filter((point) => point.timestamp).map((point) => [localDateKey(point.timestamp), point]));
  for (const [dateKey, dayData] of dayHistory) {
    const summary = summarizeHouseholdDay(dateKey, dayData);
    // The Sungrow daily energy counters are authoritative. Reconstructed totals
    // from the five-minute power curve only fill days missing from that series.
    if (summary && !byDay.has(dateKey)) byDay.set(dateKey, summary);
  }
  return [...byDay.values()].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

async function readCachedSungrowDay(key) {
  try {
    const value = JSON.parse(await readFile(resolve(sungrowDayHistoryDir, `${key}.json`), "utf8"));
    return value?.flowSchema === 2 && Array.isArray(value?.energyChart) && value.energyChart.length ? value : null;
  } catch {
    return null;
  }
}

async function writeCachedSungrowDay(key, value) {
  await mkdir(sungrowDayHistoryDir, { recursive: true });
  await writeFile(resolve(sungrowDayHistoryDir, `${key}.json`), `${JSON.stringify(value)}\n`, "utf8");
}

async function getArchivedSungrowDays(psId, currentDayCharts, batteryHistory, gridHistory) {
  const requested = Array.from({ length: sungrowDayRetention }, (_, offset) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    return { date, key: localDateKey(date) };
  });
  const results = new Map([[localDateKey(now), currentDayCharts]]);
  await writeCachedSungrowDay(localDateKey(now), currentDayCharts);

  const missing = [];
  for (const item of requested.slice(1)) {
    const cached = await readCachedSungrowDay(item.key);
    if (cached) results.set(item.key, cached);
    else missing.push(item);
  }

  for (let index = 0; index < missing.length; index += 4) {
    const batch = missing.slice(index, index + 4);
    const fetched = await Promise.all(batch.map(async ({ date, key }) => {
      try {
        const response = await sungrowJson("AppService.getPowerStationData", [`DateId:${dayIdFor(date)}`, "DateType:1", `PsId:${psId}`]);
        const production = powerKwList(deepFind(response, ["p83033List"]));
        const load = powerKwList(deepFind(response, ["p83106List"]));
        if (!production.length) return null;
        const value = buildDayCharts(date, production, load, batteryHistory, gridHistory);
        await writeCachedSungrowDay(key, value);
        return [key, value];
      } catch (error) {
        console.error(`Sungrow napi archívum (${key}): ${error.message}`);
        return null;
      }
    }));
    fetched.filter(Boolean).forEach(([key, value]) => results.set(key, value));
  }

  console.log(`Sungrow részletes napi archívum: ${results.size}/${requested.length} nap.`);
  return results;
}

function unitToMwh(value) {
  const amount = numberValue(value);
  const unit = String(value?.unit ?? "kWh").toLowerCase();
  if (unit === "mwh") return amount;
  if (unit === "wh") return amount / 1_000_000;
  return amount / 1_000;
}

function parseJsonOutput(stdout) {
  const text = stdout.trim();
  try { return JSON.parse(text); } catch { /* remove optional CLI preamble */ }
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("A GoSungrow nem adott vissza JSON-t.");
  return JSON.parse(text.slice(first, last + 1));
}

function sungrowEnvironment() {
  return {
    ...process.env,
    GOSUNGROW_QUIET: "true",
    GOSUNGROW_HOST: process.env.SUNGROW_HOST || "https://gateway.isolarcloud.eu",
    GOSUNGROW_APPKEY: process.env.SUNGROW_APPKEY || "B0455FBE7AA0328DB57B59AA729F05D8",
    GOSUNGROW_USER: process.env.SUNGROW_USER,
    GOSUNGROW_PASSWORD: process.env.SUNGROW_PASSWORD,
  };
}

async function sungrowJson(endpoint, args) {
  const bin = process.env.GOSUNGROW_BIN;
  if (!bin) throw new Error("A GoSungrow bináris nem érhető el.");
  const env = sungrowEnvironment();
  const { stdout } = await execFileAsync(bin, ["data", "json", endpoint, ...args], { env, maxBuffer: 20 * 1024 * 1024, timeout: 120_000 });
  return parseJsonOutput(stdout);
}

async function resolveSungrowPsId() {
  const configured = String(process.env.SUNGROW_PS_ID || "").trim();
  if (/^\d+$/.test(configured)) return configured;

  const bin = process.env.GOSUNGROW_BIN;
  if (!bin) throw new Error("A GoSungrow bináris nem érhető el.");
  const { stdout } = await execFileAsync(bin, ["show", "ps", "tree"], {
    env: sungrowEnvironment(),
    maxBuffer: 20 * 1024 * 1024,
    timeout: 120_000,
  });
  const ids = [...new Set([...stdout.matchAll(/PsId:(\d+)/g)].map((match) => match[1]))];
  if (ids.length === 1) {
    console.log(`Sungrow erőmű automatikusan kiválasztva: ${ids[0]}.`);
    return ids[0];
  }
  if (ids.length > 1) throw new Error(`Több Sungrow erőmű található (${ids.join(", ")}); add meg a megfelelő numerikus SUNGROW_PS_ID-t.`);
  throw new Error("Nem található Sungrow erőmű az iSolarCloud-fiókban.");
}

async function getBatteryTelemetry(psId, devices) {
  const batteryDevice = findBatteryDevice(devices);
  if (!batteryDevice) {
    console.error("Sungrow akkumulátor-adatpontok nem találhatók ennél az erőműnél.");
    return { today: [], history: [] };
  }

  const query = (start, end, interval, includeDetails = false) => {
    const requiredPoints = new Set([batteryDevice.charge, batteryDevice.discharge, batteryDevice.soc]);
    const points = [
      batteryDevice.charge,
      batteryDevice.discharge,
      batteryDevice.soc,
      ...(includeDetails ? [batteryDevice.temperature, batteryDevice.voltage] : []),
    ].filter(Boolean);
    return Promise.all(points.map((point) => sungrowJson("AppService.queryMutiPointDataList", [
        `PsId:${psId}`,
        `StartTimeStamp:${sungrowTimestamp(start)}`,
        `EndTimeStamp:${sungrowTimestamp(end)}`,
        `MinuteInterval:${interval}`,
        `Points:${batteryDevice.psKey}.${point}`,
      ]).then((response) => extractBatterySamples(response, batteryDevice)).catch((error) => {
        if (requiredPoints.has(point)) throw error;
        console.error(`Sungrow opcionális akkumulátor-adatpont (${point}): ${error.message}`);
        return [];
      })))
      .then(mergeSamples)
      .then(normalizeBatteryPower)
      .then((samples) => normalizeBatterySoc(samples, batteryDevice.soc));
  };

  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const [todayResult, historyResult] = await Promise.allSettled([
    query(dayStart, now, 5, true),
    query(yearStart, now, 60),
  ]);
  if (todayResult.status === "rejected") console.error(`Sungrow napi akkumulátor-adatok: ${todayResult.reason.message}`);
  if (historyResult.status === "rejected") console.error(`Sungrow összesített akkumulátor-adatok: ${historyResult.reason.message}`);
  if (todayResult.status === "fulfilled" || historyResult.status === "fulfilled") {
    console.log(`Sungrow akkumulátor-minták: napi ${todayResult.status === "fulfilled" ? todayResult.value.length : 0}, összesített ${historyResult.status === "fulfilled" ? historyResult.value.length : 0}.`);
  }
  return {
    today: todayResult.status === "fulfilled" ? todayResult.value : [],
    history: historyResult.status === "fulfilled" ? historyResult.value : [],
  };
}

async function getGridTelemetry(psId, devices) {
  const meterDevice = findGridMeterDevice(devices);
  if (!meterDevice) {
    console.error("Sungrow hálózati mérő (p8018) nem található ennél az erőműnél.");
    return { today: [], history: [] };
  }

  console.log(`Sungrow hálózati mérő: ${meterDevice.psKey}.${meterDevice.power}.`);
  const query = (start, end, interval) => sungrowJson("AppService.queryMutiPointDataList", [
    `PsId:${psId}`,
    `StartTimeStamp:${sungrowTimestamp(start)}`,
    `EndTimeStamp:${sungrowTimestamp(end)}`,
    `MinuteInterval:${interval}`,
    `Points:${meterDevice.psKey}.${meterDevice.power}`,
  ]).then((response) => normalizeGridPower(extractPointSamples(response, { [meterDevice.power]: "gridKw" })));

  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const [todayResult, historyResult] = await Promise.allSettled([
    query(dayStart, now, 5),
    query(yearStart, now, 60),
  ]);
  if (todayResult.status === "rejected") console.error(`Sungrow napi hálózati teljesítmény: ${todayResult.reason.message}`);
  if (historyResult.status === "rejected") console.error(`Sungrow korábbi hálózati teljesítmény: ${historyResult.reason.message}`);
  console.log(`Sungrow hálózati minták: napi ${todayResult.status === "fulfilled" ? todayResult.value.length : 0}, korábbi ${historyResult.status === "fulfilled" ? historyResult.value.length : 0}.`);
  return {
    today: todayResult.status === "fulfilled" ? todayResult.value : [],
    history: historyResult.status === "fulfilled" ? historyResult.value : [],
  };
}

function ownValue(root, name) {
  if (!root || typeof root !== "object") return undefined;
  const wanted = normalizeKey(name);
  const entry = Object.entries(root).find(([key]) => normalizeKey(key) === wanted);
  return entry?.[1];
}

function energyKwh(row, pointId) {
  const value = numberValue(ownValue(row, pointId), Number.NaN);
  if (!Number.isFinite(value)) return undefined;
  const unit = textValue(ownValue(row, `${pointId}Unit`), "kWh").toLowerCase();
  if (unit === "wh") return value / 1_000;
  if (unit === "mwh") return value * 1_000;
  return value;
}

function reportRowKey(row, period) {
  for (const field of ["timeStamp", "dateId"]) {
    const raw = textValue(ownValue(row, field));
    const compact = raw.replace(/\D/g, "");
    if (/^(19|20)\d{4}/.test(compact) && period === "month") return `${compact.slice(0, 4)}-${compact.slice(4, 6)}`;
    if (/^(19|20)\d{6}/.test(compact) && period === "day") return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  }
  const timestamp = parseSungrowTimestamp(ownValue(row, "timeStamp"));
  if (timestamp) return period === "month" ? localMonthKey(timestamp) : localDateKey(timestamp);
  return undefined;
}

function energyMapFromReport(report, listName, period, points) {
  const rows = deepFind(report, [listName]);
  if (!Array.isArray(rows)) return new Map();
  const entries = rows.flatMap((row) => {
    const key = reportRowKey(row, period);
    if (!key) return [];
    const values = Object.fromEntries(Object.entries(points).flatMap(([name, pointId]) => {
      const value = energyKwh(row, pointId);
      return Number.isFinite(value) ? [[name, value]] : [];
    }));
    if (!Object.keys(values).length) return [];
    if (Number.isFinite(values.gridPurchase) || Number.isFinite(values.gridFeedIn)) {
      values.grid = (values.gridPurchase ?? 0) - (values.gridFeedIn ?? 0);
    }
    return [[key, values]];
  });
  return new Map(entries);
}

const dailyEnergyPoints = {
  pv: "p83077",
  gridPurchase: "p83102",
  gridFeedIn: "p83072",
  batteryCharge: "p83088",
  batteryDischarge: "p83089",
  load: "p83118",
};

const monthlyEnergyPoints = {
  pv: "p83078",
  gridPurchase: "p83103",
  gridFeedIn: "p83073",
  batteryCharge: "p83088",
  batteryDischarge: "p83091",
  load: "p83118",
};

async function readCachedEnergyHistory() {
  try {
    const stored = JSON.parse(await readFile(energyHistoryFile, "utf8"));
    return {
      daily: new Map(Object.entries(stored?.daily ?? stored).filter(([key, value]) => /^\d{4}-\d{2}-\d{2}$/.test(key) && value && typeof value === "object")),
      monthly: new Map(Object.entries(stored?.monthly ?? {}).filter(([key, value]) => /^\d{4}-\d{2}$/.test(key) && value && typeof value === "object")),
    };
  } catch {
    return { daily: new Map(), monthly: new Map() };
  }
}

async function writeCachedEnergyHistory(daily, monthly) {
  await mkdir(historyDir, { recursive: true });
  const orderedDaily = Object.fromEntries([...daily.entries()].sort(([a], [b]) => a.localeCompare(b)));
  const orderedMonthly = Object.fromEntries([...monthly.entries()].sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(energyHistoryFile, `${JSON.stringify({ daily: orderedDaily, monthly: orderedMonthly })}\n`, "utf8");
}

function dailyHistoryMonthIds() {
  const first = new Date(Math.min(2025, now.getFullYear()), 0, 1, 12);
  const last = new Date(now.getFullYear(), now.getMonth(), 1, 12);
  const ids = [];
  for (const cursor = new Date(first); cursor <= last; cursor.setMonth(cursor.getMonth() + 1)) {
    ids.push(`${cursor.getFullYear()}${pad(cursor.getMonth() + 1)}`);
  }
  return ids;
}

function energyHistoryHasMonth(daily, requestedMonthId) {
  const prefix = `${requestedMonthId.slice(0, 4)}-${requestedMonthId.slice(4, 6)}-`;
  return [...daily.keys()].some((key) => key.startsWith(prefix));
}

function energyHistoryYearIds() {
  const firstYear = Math.min(2025, now.getFullYear());
  return Array.from({ length: now.getFullYear() - firstYear + 1 }, (_, index) => String(firstYear + index));
}

function energyHistoryHasYear(monthly, requestedYearId) {
  return [...monthly.keys()].some((key) => key.startsWith(`${requestedYearId}-`));
}

async function getEnergyHistory(psId) {
  const { daily, monthly } = await readCachedEnergyHistory();
  const requestedMonths = dailyHistoryMonthIds();
  const missingMonths = requestedMonths.filter((id) => id === monthId || !energyHistoryHasMonth(daily, id));
  const requestedYears = energyHistoryYearIds();
  const missingYears = requestedYears.filter((id) => id === yearId || !energyHistoryHasYear(monthly, id));

  for (const requestedMonthId of missingMonths) {
    try {
      const report = await sungrowJson("AppService.getHouseholdStoragePsReport", [`DateId:${requestedMonthId}`, "DateType:2", `PsId:${psId}`]);
      const monthDays = energyMapFromReport(report, "monthDataDayList", "day", dailyEnergyPoints);
      monthDays.forEach((value, key) => daily.set(key, value));
    } catch (error) {
      console.error(`Sungrow napi energia (${requestedMonthId}): ${error.message}`);
    }
  }

  for (const requestedYearId of missingYears) {
    try {
      const report = await sungrowJson("AppService.getHouseholdStoragePsReport", [`DateId:${requestedYearId}`, "DateType:3", `PsId:${psId}`]);
      const yearMonths = energyMapFromReport(report, "yearDataMonthList", "month", monthlyEnergyPoints);
      yearMonths.forEach((value, key) => monthly.set(key, value));
    } catch (error) {
      console.error(`Sungrow havi energia (${requestedYearId}): ${error.message}`);
    }
  }

  if (daily.size || monthly.size) await writeCachedEnergyHistory(daily, monthly);
  console.log(`Sungrow energiaelőzmény: ${daily.size} nap, ${monthly.size} hónap; most lekérve: ${missingMonths.length} hónap és ${missingYears.length} év.`);
  return { daily, monthly };
}

async function getSungrow() {
  if (!process.env.SUNGROW_USER || !process.env.SUNGROW_PASSWORD) return null;
  const psId = await resolveSungrowPsId();
  const [day, month, overview, devices] = await Promise.all([
    sungrowJson("AppService.getPowerStationData", [`DateId:${dayId}`, "DateType:1", `PsId:${psId}`]),
    sungrowJson("AppService.getPowerStationData", [`DateId:${monthId}`, "DateType:2", `PsId:${psId}`]),
    sungrowJson("WebAppService.showPSView", [`PsId:${psId}`]),
    sungrowJson("AppService.queryDeviceList", [`PsId:${psId}`]).catch((error) => {
      console.error(`Sungrow akkumulátor-eszközlista: ${error.message}`);
      return null;
    }),
  ]);
  const [battery, grid, energyHistory] = await Promise.all([
    getBatteryTelemetry(psId, devices),
    getGridTelemetry(psId, devices),
    getEnergyHistory(psId),
  ]);
  const year = await sungrowJson("AppService.getPowerStationData", [`DateId:${yearId}`, "DateType:3", `PsId:${psId}`]).catch((error) => {
    console.error(`Sungrow éves összesítés nem érhető el: ${error.message}`);
    return null;
  });

  const production = powerKwList(deepFind(day, ["p83033List"]));
  const load = powerKwList(deepFind(day, ["p83106List"]));
  const dailyEnergy = numberList(deepFind(month, ["p83022List"]));
  const monthlyEnergy = year ? numberList(deepFind(year, ["p83022List"])) : [];
  const currentPowerKw = currentValue(production);
  const houseLoadKw = currentValue(load);
  const latestBatteryValue = (key) => [...battery.today].reverse().find((sample) => Number.isFinite(sample[key]))?.[key];
  const latestGridPowerKw = [...grid.today].reverse().find((sample) => Number.isFinite(sample.gridKw))?.gridKw;
  const todayKwh = numberValue(deepFind(day, ["dayPowerQuantityTotal", "p83022"]), dailyEnergy.at(-1) ?? 0);
  const monthKwh = dailyEnergy.reduce((sum, value) => sum + value, 0);
  const usedDirectly = Math.min(Math.max(houseLoadKw, 0), Math.max(currentPowerKw, 0));
  const selfConsumptionPct = currentPowerKw > 0 ? Math.round((usedDirectly / currentPowerKw) * 100) : 0;
  const co2Factor = numberValue(process.env.CO2_KG_PER_KWH, 0.233);

  const today = buildDayCharts(now, production, load, battery.today, grid.today);
  const todayChart = today.chart;
  const todayEnergy = today.energyChart;
  const dayHistory = await getArchivedSungrowDays(psId, today, battery.history, grid.history);
  const monthChart = dailyEnergy.map((value, index) => ({ label: `${index + 1}.`, value }));
  const yearChart = monthlyEnergy.map((value, index) => ({ label: ["Jan", "Feb", "Már", "Ápr", "Máj", "Jún", "Júl", "Aug", "Szept", "Okt", "Nov", "Dec"][index] ?? String(index + 1), value }));
  const dailyEnergyReport = energyHistory.daily;
  const monthlyEnergyReport = energyHistory.monthly;
  const reportDays = [...dailyEnergyReport.keys()];
  const currentMonthKeys = Array.from({ length: now.getDate() }, (_, index) => localDateKey(new Date(now.getFullYear(), now.getMonth(), index + 1, 12)));
  const dailyEnergyKeys = [...new Set([...reportDays, ...currentMonthKeys])].filter((key) => key <= localDateKey(now)).sort();
  const monthEnergy = dailyEnergyKeys.map((key) => {
    const [year, month, day] = key.split("-").map(Number);
    const timestamp = new Date(year, month - 1, day, 12);
    const point = year === now.getFullYear() && month === now.getMonth() + 1 ? monthChart[day - 1] : undefined;
    return { label: `${day}.${month}.`, timestamp: timestamp.toISOString(), ...(point ? { pv: point.value } : {}), ...dailyEnergyReport.get(key) };
  });
  const currentYearKeys = Array.from({ length: Math.max(yearChart.length, now.getMonth() + 1) }, (_, index) => localMonthKey(new Date(now.getFullYear(), index, 1, 12)));
  const monthlyEnergyKeys = [...new Set([...monthlyEnergyReport.keys(), ...currentYearKeys])].filter((key) => key <= localMonthKey(now)).sort();
  const yearEnergy = monthlyEnergyKeys.map((key) => {
    const [year, month] = key.split("-").map(Number);
    const timestamp = new Date(year, month - 1, 1, 12);
    const point = year === now.getFullYear() ? yearChart[month - 1] : undefined;
    const label = ["Jan", "Feb", "Már", "Ápr", "Máj", "Jún", "Júl", "Aug", "Szept", "Okt", "Nov", "Dec"][month - 1];
    return { label, timestamp: timestamp.toISOString(), ...(point ? { pv: point.value } : {}), ...monthlyEnergyReport.get(key) };
  });

  return {
    metrics: {
      status: "online",
      currentPowerKw,
      batteryTemperatureC: latestBatteryValue("temperatureC"),
      batteryVoltageV: latestBatteryValue("voltageV"),
      todayKwh,
      monthKwh,
      lifetimeMwh: unitToMwh(deepFind(overview, ["totalAllPower"])),
      selfConsumptionPct,
      co2SavedKg: todayKwh * co2Factor,
      houseLoadKw,
      gridPowerKw: latestGridPowerKw,
    },
    charts: {
      today: todayChart.length ? todayChart : [{ label: pad(now.getHours()), value: currentPowerKw }],
      "7d": monthChart.slice(0, now.getDate()).slice(-7),
      "30d": monthChart.slice(0, now.getDate()).slice(-30),
      year: yearChart,
    },
    energyCharts: {
      today: todayEnergy,
      "7d": monthEnergy,
      "30d": monthEnergy,
      year: yearEnergy,
    },
    dayHistory,
  };
}

function forecastSetting(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const configured = Number(raw);
  return Number.isFinite(configured) ? configured : fallback;
}

function timestampWithOffset(localTime, offsetSeconds) {
  const sign = offsetSeconds >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetSeconds);
  return `${localTime}:00${sign}${pad(Math.floor(absolute / 3600))}:${pad(Math.floor((absolute % 3600) / 60))}`;
}

function bestConsumptionWindow(points, length = 3) {
  let bestIndex = 0;
  let bestTotal = -1;
  for (let index = 0; index <= points.length - length; index += 1) {
    const total = points.slice(index, index + length).reduce((sum, point) => sum + point.expectedPowerKw, 0);
    if (total > bestTotal) {
      bestIndex = index;
      bestTotal = total;
    }
  }
  const start = Number(points[bestIndex]?.label.slice(0, 2) ?? 0);
  return `${pad(start)}:00–${pad(Math.min(24, start + length))}:00`;
}

async function getSolarForecast() {
  // A nyilvános repóban csak közelítő koordináta szerepel; a pontos érték GitHub Secrettel adható meg.
  const latitude = forecastSetting("SOLAR_LATITUDE", 42.13);
  const longitude = forecastSetting("SOLAR_LONGITUDE", 23.22);
  const systemKwp = forecastSetting("SOLAR_SYSTEM_KWP", 5);
  const tiltDeg = forecastSetting("SOLAR_TILT_DEG", 27);
  const azimuthDeg = forecastSetting("SOLAR_AZIMUTH_DEG", 12);
  const performanceRatio = forecastSetting("SOLAR_PERFORMANCE_RATIO", .82);
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("hourly", "global_tilted_irradiance,cloud_cover,precipitation_probability");
  url.searchParams.set("tilt", String(tiltDeg));
  url.searchParams.set("azimuth", String(azimuthDeg));
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "3");

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Open-Meteo: HTTP ${response.status}`);
  const body = await response.json();
  const times = body.hourly?.time ?? [];
  const irradiance = body.hourly?.global_tilted_irradiance ?? [];
  const cloudCover = body.hourly?.cloud_cover ?? [];
  const precipitation = body.hourly?.precipitation_probability ?? [];
  const groups = new Map();

  times.forEach((localTime, index) => {
    const date = localTime.slice(0, 10);
    const gti = Math.max(0, numberValue(irradiance[index]));
    const point = {
      label: localTime.slice(11, 16),
      timestamp: timestampWithOffset(localTime, numberValue(body.utc_offset_seconds)),
      expectedPowerKw: Math.min(systemKwp, systemKwp * (gti / 1000) * performanceRatio),
      irradianceWm2: gti,
      cloudCoverPct: numberValue(cloudCover[index]),
      precipitationProbabilityPct: numberValue(precipitation[index]),
    };
    const day = groups.get(date) ?? [];
    day.push(point);
    groups.set(date, day);
  });

  const days = [...groups.entries()].slice(0, 3).map(([date, points], index) => ({
    date,
    label: index === 0 ? "Ma" : index === 1 ? "Holnap" : "Holnapután",
    expectedKwh: points.reduce((sum, point) => sum + point.expectedPowerKw, 0),
    bestWindow: bestConsumptionWindow(points),
    points,
  }));

  if (!days.length) throw new Error("Az Open-Meteo nem adott vissza előrejelzési adatot.");
  return { updatedAt: now.toISOString(), systemKwp, tiltDeg, azimuthDeg, performanceRatio, days };
}

async function getGovee() {
  const apiKey = process.env.GOVEE_API_KEY;
  if (!apiKey) return null;
  const headers = { "Content-Type": "application/json", "Govee-API-Key": apiKey };
  const devicesResponse = await fetch("https://openapi.api.govee.com/router/api/v1/user/devices", { headers });
  if (!devicesResponse.ok) throw new Error(`Govee eszközlista: HTTP ${devicesResponse.status}`);
  const devicesBody = await devicesResponse.json();
  const devices = devicesBody.data ?? devicesBody.payload ?? [];
  const device = devices.find((item) => process.env.GOVEE_DEVICE_ID && item.device === process.env.GOVEE_DEVICE_ID)
    ?? devices.find((item) => process.env.GOVEE_DEVICE_SKU && item.sku === process.env.GOVEE_DEVICE_SKU)
    ?? devices.find((item) => item.capabilities?.some((capability) => capability.instance === "sensorTemperature"));
  if (!device) throw new Error("Nem található hőmérsékletet mérő Govee eszköz.");

  const stateResponse = await fetch("https://openapi.api.govee.com/router/api/v1/device/state", {
    method: "POST",
    headers,
    body: JSON.stringify({ requestId: randomUUID(), payload: { sku: device.sku, device: device.device } }),
  });
  if (!stateResponse.ok) throw new Error(`Govee állapot: HTTP ${stateResponse.status}`);
  const stateBody = await stateResponse.json();
  const capabilities = stateBody.payload?.capabilities ?? [];
  const state = (instance) => capabilities.find((item) => item.instance === instance)?.state?.value;
  const temperatureCapability = device.capabilities?.find((item) => item.instance === "sensorTemperature");
  const declaredUnit = JSON.stringify(temperatureCapability?.parameters?.unit ?? "").toLowerCase();
  let temperatureC = numberValue(state("sensorTemperature"));
  if (declaredUnit.includes("fahrenheit") || temperatureC > 60) temperatureC = (temperatureC - 32) * 5 / 9;
  const humidityPct = numberValue(state("sensorHumidity"));
  const battery = capabilities.find((item) => /battery/i.test(item.instance ?? ""));

  if (!isValidClimateSample({ temperature: temperatureC, humidity: humidityPct })) {
    throw new Error("A mérő 0 értéket adott vissza; a hibás minta kihagyva.");
  }

  return {
    devices: [{
      id: device.device,
      name: device.deviceName || device.sku,
      room: process.env.GOVEE_ROOM_NAME || device.deviceName || "Otthon",
      temperatureC,
      humidityPct,
      batteryPct: numberValue(battery?.state?.value, 100),
      updatedAt: now.toISOString(),
    }],
    chart: [{ label: pad(now.getHours()), temperature: temperatureC, humidity: humidityPct }],
  };
}

const weatherTwinCities = [
  ["Szófia", "Bulgária", "Szófiában", 42.6977, 23.3219],
  ["Athén", "Görögország", "Athénban", 37.9838, 23.7275],
  ["Isztambul", "Törökország", "Isztambulban", 41.0082, 28.9784],
  ["Bukarest", "Románia", "Bukarestben", 44.4268, 26.1025],
  ["Belgrád", "Szerbia", "Belgrádban", 44.7866, 20.4489],
  ["Szkopje", "Észak-Macedónia", "Szkopjéban", 41.9981, 21.4254],
  ["Szaloniki", "Görögország", "Szalonikiben", 40.6401, 22.9444],
  ["Róma", "Olaszország", "Rómában", 41.9028, 12.4964],
  ["Madrid", "Spanyolország", "Madridban", 40.4168, -3.7038],
  ["Lisszabon", "Portugália", "Lisszabonban", 38.7223, -9.1393],
  ["Párizs", "Franciaország", "Párizsban", 48.8566, 2.3522],
  ["London", "Egyesült Királyság", "Londonban", 51.5074, -0.1278],
  ["Berlin", "Németország", "Berlinben", 52.52, 13.405],
  ["Bécs", "Ausztria", "Bécsben", 48.2082, 16.3738],
  ["Prága", "Csehország", "Prágában", 50.0755, 14.4378],
  ["Varsó", "Lengyelország", "Varsóban", 52.2297, 21.0122],
  ["Budapest", "Magyarország", "Budapesten", 47.4979, 19.0402],
  ["Zágráb", "Horvátország", "Zágrábban", 45.815, 15.9819],
  ["Szarajevó", "Bosznia-Hercegovina", "Szarajevóban", 43.8563, 18.4131],
  ["Tirana", "Albánia", "Tiranában", 41.3275, 19.8187],
  ["Valletta", "Málta", "Vallettában", 35.8989, 14.5146],
  ["Reykjavík", "Izland", "Reykjavíkban", 64.1466, -21.9426],
  ["Oslo", "Norvégia", "Oslóban", 59.9139, 10.7522],
  ["Stockholm", "Svédország", "Stockholmban", 59.3293, 18.0686],
  ["Helsinki", "Finnország", "Helsinkiben", 60.1699, 24.9384],
  ["Moszkva", "Oroszország", "Moszkvában", 55.7558, 37.6173],
  ["Tbiliszi", "Grúzia", "Tbilisziben", 41.7151, 44.8271],
  ["Jereván", "Örményország", "Jerevánban", 40.1872, 44.5152],
  ["Kairó", "Egyiptom", "Kairóban", 30.0444, 31.2357],
  ["Casablanca", "Marokkó", "Casablancában", 33.5731, -7.5898],
  ["Marrákes", "Marokkó", "Marrákesben", 31.6295, -7.9811],
  ["Tunisz", "Tunézia", "Tuniszban", 36.8065, 10.1815],
  ["Fokváros", "Dél-Afrika", "Fokvárosban", -33.9249, 18.4241],
  ["Johannesburg", "Dél-Afrika", "Johannesburgban", -26.2041, 28.0473],
  ["Nairobi", "Kenya", "Nairobiban", -1.2921, 36.8219],
  ["Lagos", "Nigéria", "Lagosban", 6.5244, 3.3792],
  ["Accra", "Ghána", "Accrában", 5.6037, -0.187],
  ["Dakar", "Szenegál", "Dakarban", 14.7167, -17.4677],
  ["Dubaj", "Egyesült Arab Emírségek", "Dubajban", 25.2048, 55.2708],
  ["Rijád", "Szaúd-Arábia", "Rijádban", 24.7136, 46.6753],
  ["Tel-Aviv", "Izrael", "Tel-Avivban", 32.0853, 34.7818],
  ["Delhi", "India", "Delhiben", 28.6139, 77.209],
  ["Mumbai", "India", "Mumbaiban", 19.076, 72.8777],
  ["Bangkok", "Thaiföld", "Bangkokban", 13.7563, 100.5018],
  ["Szingapúr", "Szingapúr", "Szingapúrban", 1.3521, 103.8198],
  ["Hanoi", "Vietnám", "Hanoiban", 21.0278, 105.8342],
  ["Hongkong", "Kína", "Hongkongban", 22.3193, 114.1694],
  ["Tajpej", "Tajvan", "Tajpejben", 25.033, 121.5654],
  ["Tokió", "Japán", "Tokióban", 35.6762, 139.6503],
  ["Szöul", "Dél-Korea", "Szöulban", 37.5665, 126.978],
  ["Peking", "Kína", "Pekingben", 39.9042, 116.4074],
  ["Sanghaj", "Kína", "Sanghajban", 31.2304, 121.4737],
  ["Sydney", "Ausztrália", "Sydneyben", -33.8688, 151.2093],
  ["Melbourne", "Ausztrália", "Melbourne-ben", -37.8136, 144.9631],
  ["Auckland", "Új-Zéland", "Aucklandben", -36.8509, 174.7645],
  ["New York", "Egyesült Államok", "New Yorkban", 40.7128, -74.006],
  ["Chicago", "Egyesült Államok", "Chicagóban", 41.8781, -87.6298],
  ["Miami", "Egyesült Államok", "Miamiban", 25.7617, -80.1918],
  ["Los Angeles", "Egyesült Államok", "Los Angelesben", 34.0522, -118.2437],
  ["Vancouver", "Kanada", "Vancouverben", 49.2827, -123.1207],
  ["Toronto", "Kanada", "Torontóban", 43.6532, -79.3832],
  ["Mexikóváros", "Mexikó", "Mexikóvárosban", 19.4326, -99.1332],
  ["Havanna", "Kuba", "Havannában", 23.1136, -82.3666],
  ["Bogotá", "Kolumbia", "Bogotában", 4.711, -74.0721],
  ["Lima", "Peru", "Limában", -12.0464, -77.0428],
  ["Santiago", "Chile", "Santiagóban", -33.4489, -70.6693],
  ["Buenos Aires", "Argentína", "Buenos Airesben", -34.6037, -58.3816],
  ["São Paulo", "Brazília", "São Paulóban", -23.5505, -46.6333],
  ["Rio de Janeiro", "Brazília", "Rio de Janeiróban", -22.9068, -43.1729],
  ["Ljubljana", "Szlovénia", "Ljubljanában", 46.0569, 14.5058],
  ["Pozsony", "Szlovákia", "Pozsonyban", 48.1486, 17.1077],
  ["Kijev", "Ukrajna", "Kijevben", 50.4501, 30.5234],
  ["Kisinyov", "Moldova", "Kisinyovban", 47.0105, 28.8638],
  ["Riga", "Lettország", "Rigában", 56.9496, 24.1052],
  ["Tallinn", "Észtország", "Tallinnban", 59.437, 24.7536],
  ["Vilnius", "Litvánia", "Vilniusban", 54.6872, 25.2797],
  ["Koppenhága", "Dánia", "Koppenhágában", 55.6761, 12.5683],
  ["Dublin", "Írország", "Dublinban", 53.3498, -6.2603],
  ["Brüsszel", "Belgium", "Brüsszelben", 50.8503, 4.3517],
  ["Amszterdam", "Hollandia", "Amszterdamban", 52.3676, 4.9041],
  ["Zürich", "Svájc", "Zürichben", 47.3769, 8.5417],
  ["Milánó", "Olaszország", "Milánóban", 45.4642, 9.19],
  ["Barcelona", "Spanyolország", "Barcelonában", 41.3874, 2.1686],
  ["Marseille", "Franciaország", "Marseille-ben", 43.2965, 5.3698],
  ["München", "Németország", "Münchenben", 48.1351, 11.582],
  ["Hamburg", "Németország", "Hamburgban", 53.5511, 9.9937],
  ["Manchester", "Egyesült Királyság", "Manchesterben", 53.4808, -2.2426],
  ["Edinburgh", "Egyesült Királyság", "Edinburghban", 55.9533, -3.1883],
  ["Porto", "Portugália", "Portóban", 41.1579, -8.6291],
  ["Podgorica", "Montenegró", "Podgoricában", 42.4304, 19.2594],
  ["Pristina", "Koszovó", "Pristinában", 42.6629, 21.1655],
  ["Izmir", "Törökország", "Izmirben", 38.4237, 27.1428],
  ["Ankara", "Törökország", "Ankarában", 39.9334, 32.8597],
  ["Nicosia", "Ciprus", "Nicosiában", 35.1856, 33.3823],
  ["Ammán", "Jordánia", "Ammánban", 31.9539, 35.9106],
  ["Bejrút", "Libanon", "Bejrútban", 33.8938, 35.5018],
  ["Bagdad", "Irak", "Bagdadban", 33.3152, 44.3661],
  ["Teherán", "Irán", "Teheránban", 35.6892, 51.389],
  ["Baku", "Azerbajdzsán", "Bakuban", 40.4093, 49.8671],
  ["Asztana", "Kazahsztán", "Asztanában", 51.1694, 71.4491],
  ["Taskent", "Üzbegisztán", "Taskentben", 41.2995, 69.2401],
  ["Doha", "Katar", "Dohában", 25.2854, 51.531],
  ["Kuvaitváros", "Kuvait", "Kuvaitvárosban", 29.3759, 47.9774],
  ["Maszkat", "Omán", "Maszkatban", 23.588, 58.3829],
  ["Alexandria", "Egyiptom", "Alexandriában", 31.2001, 29.9187],
  ["Algír", "Algéria", "Algírban", 36.7538, 3.0588],
  ["Addisz-Abeba", "Etiópia", "Addisz-Abebában", 8.9806, 38.7578],
  ["Kampala", "Uganda", "Kampalában", 0.3476, 32.5825],
  ["Kigali", "Ruanda", "Kigaliban", -1.9441, 30.0619],
  ["Dar es-Salaam", "Tanzánia", "Dar es-Salaamban", -6.7924, 39.2083],
  ["Luanda", "Angola", "Luandában", -8.839, 13.2894],
  ["Maputo", "Mozambik", "Maputóban", -25.9692, 32.5732],
  ["Harare", "Zimbabwe", "Hararéban", -17.8252, 31.0335],
  ["Gaborone", "Botswana", "Gaboronéban", -24.6282, 25.9231],
  ["Windhoek", "Namíbia", "Windhoekben", -22.5609, 17.0658],
  ["Abidjan", "Elefántcsontpart", "Abidjanban", 5.36, -4.0083],
  ["Kinshasa", "Kongói Demokratikus Köztársaság", "Kinshasában", -4.4419, 15.2663],
  ["Karacsi", "Pakisztán", "Karacsiban", 24.8607, 67.0011],
  ["Lahor", "Pakisztán", "Lahorban", 31.5204, 74.3587],
  ["Katmandu", "Nepál", "Katmanduban", 27.7172, 85.324],
  ["Dakka", "Banglades", "Dakkában", 23.8103, 90.4125],
  ["Colombo", "Srí Lanka", "Colombóban", 6.9271, 79.8612],
  ["Yangon", "Mianmar", "Yangonban", 16.8409, 96.1735],
  ["Phnompen", "Kambodzsa", "Phnompenben", 11.5564, 104.9282],
  ["Kuala Lumpur", "Malajzia", "Kuala Lumpurban", 3.139, 101.6869],
  ["Jakarta", "Indonézia", "Jakartában", -6.2088, 106.8456],
  ["Manila", "Fülöp-szigetek", "Manilában", 14.5995, 120.9842],
  ["Ho Si Minh-város", "Vietnám", "Ho Si Minh-városban", 10.8231, 106.6297],
  ["Oszaka", "Japán", "Oszakában", 34.6937, 135.5023],
  ["Szapporó", "Japán", "Szapporóban", 43.0618, 141.3545],
  ["Puszan", "Dél-Korea", "Puszanban", 35.1796, 129.0756],
  ["Kanton", "Kína", "Kantonban", 23.1291, 113.2644],
  ["Csengtu", "Kína", "Csengtuban", 30.5728, 104.0668],
  ["Csungking", "Kína", "Csungkingban", 29.4316, 106.9123],
  ["Vuhan", "Kína", "Vuhanban", 30.5928, 114.3055],
  ["Ulánbátor", "Mongólia", "Ulánbátorban", 47.8864, 106.9057],
  ["Brisbane", "Ausztrália", "Brisbane-ben", -27.4698, 153.0251],
  ["Perth", "Ausztrália", "Perthben", -31.9505, 115.8605],
  ["Adelaide", "Ausztrália", "Adelaide-ben", -34.9285, 138.6007],
  ["Wellington", "Új-Zéland", "Wellingtonban", -41.2866, 174.7756],
  ["Honolulu", "Egyesült Államok", "Honoluluban", 21.3069, -157.8583],
  ["Seattle", "Egyesült Államok", "Seattle-ben", 47.6062, -122.3321],
  ["San Francisco", "Egyesült Államok", "San Franciscóban", 37.7749, -122.4194],
  ["Denver", "Egyesült Államok", "Denverben", 39.7392, -104.9903],
  ["Dallas", "Egyesült Államok", "Dallasban", 32.7767, -96.797],
  ["Houston", "Egyesült Államok", "Houstonban", 29.7604, -95.3698],
  ["Atlanta", "Egyesült Államok", "Atlantában", 33.749, -84.388],
  ["Boston", "Egyesült Államok", "Bostonban", 42.3601, -71.0589],
  ["Washington", "Egyesült Államok", "Washingtonban", 38.9072, -77.0369],
  ["Phoenix", "Egyesült Államok", "Phoenixben", 33.4484, -112.074],
  ["Montréal", "Kanada", "Montréalban", 45.5017, -73.5673],
  ["Calgary", "Kanada", "Calgaryban", 51.0447, -114.0719],
  ["Ottawa", "Kanada", "Ottawában", 45.4215, -75.6972],
  ["Guatemalaváros", "Guatemala", "Guatemalavárosban", 14.6349, -90.5069],
  ["San José", "Costa Rica", "San Joséban", 9.9281, -84.0907],
  ["Panamaváros", "Panama", "Panamavárosban", 8.9824, -79.5199],
  ["Quito", "Ecuador", "Quitóban", -0.1807, -78.4678],
  ["Medellín", "Kolumbia", "Medellínben", 6.2442, -75.5812],
  ["Caracas", "Venezuela", "Caracasban", 10.4806, -66.9036],
  ["La Paz", "Bolívia", "La Pazban", -16.4897, -68.1193],
  ["Asunción", "Paraguay", "Asunciónban", -25.2637, -57.5759],
  ["Montevideo", "Uruguay", "Montevideóban", -34.9011, -56.1645],
  ["Salvador", "Brazília", "Salvadorban", -12.9777, -38.5016],
  ["Recife", "Brazília", "Recifében", -8.0476, -34.877],
  ["Manaus", "Brazília", "Manausban", -3.119, -60.0217],
];

async function readWeatherTwinCache(temperatureC, humidityPct) {
  try {
    const cache = JSON.parse(await readFile(weatherTwinHistoryFile, "utf8"));
    const cacheAge = now.getTime() - new Date(cache.updatedAt).getTime();
    const referenceStillClose = Math.abs(Number(cache.referenceTemperatureC) - temperatureC) <= 1
      && Math.abs(Number(cache.referenceHumidityPct) - humidityPct) <= 5;
    if (cacheAge >= 0 && cacheAge <= weatherTwinCacheMs && referenceStillClose && Array.isArray(cache.matches) && cache.matches.length) {
      return cache.matches.slice(0, 6);
    }
  } catch { /* a következő frissítés újraépíti a gyorsítótárat */ }
  return null;
}

async function getWeatherTwins(temperatureC, humidityPct) {
  const cachedMatches = await readWeatherTwinCache(temperatureC, humidityPct);
  if (cachedMatches) return cachedMatches;

  const cityBatches = [];
  for (let index = 0; index < weatherTwinCities.length; index += 60) cityBatches.push(weatherTwinCities.slice(index, index + 60));
  const locations = [];
  for (const cities of cityBatches) {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", cities.map((city) => city[3]).join(","));
    url.searchParams.set("longitude", cities.map((city) => city[4]).join(","));
    url.searchParams.set("current", "temperature_2m,relative_humidity_2m");
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("forecast_days", "1");
    let body;
    let lastStatus = "hálózati hiba";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 2500));
      try {
        const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "pasztra-tech-dashboard/1.0" } });
        lastStatus = `HTTP ${response.status}`;
        if (response.ok) {
          body = await response.json();
          break;
        }
      } catch (error) {
        lastStatus = error instanceof Error ? error.message : lastStatus;
      }
    }
    if (!body) throw new Error(`Open-Meteo városkeresés: ${lastStatus}`);
    locations.push(...(Array.isArray(body) ? body : [body]));
  }

  const matches = locations.map((location, index) => {
    const city = weatherTwinCities[index];
    const currentTemperature = Number(location?.current?.temperature_2m);
    const currentHumidity = Number(location?.current?.relative_humidity_2m);
    if (!city || !Number.isFinite(currentTemperature) || !Number.isFinite(currentHumidity)) return null;
    const temperatureDifference = Math.abs(currentTemperature - temperatureC);
    const humidityDifference = Math.abs(currentHumidity - humidityPct);
    return {
      city: city[0],
      country: city[1],
      locative: city[2],
      temperatureC: Math.round(currentTemperature * 10) / 10,
      humidityPct: Math.round(currentHumidity),
      score: Math.round(Math.hypot(temperatureDifference / 2, humidityDifference / 8) * 100) / 100,
    };
  }).filter(Boolean).sort((a, b) => a.score - b.score).slice(0, 6);
  if (!matches.length) throw new Error("Az Open-Meteo nem adott vissza összehasonlítható városi adatot.");
  await mkdir(historyDir, { recursive: true });
  await writeFile(weatherTwinHistoryFile, `${JSON.stringify({
    updatedAt: now.toISOString(),
    referenceTemperatureC: temperatureC,
    referenceHumidityPct: humidityPct,
    matches,
  }, null, 2)}\n`, "utf8");
  return matches;
}

const energyMixFields = {
  nuclear: ["nuclear"],
  coal: ["fossil_brown_coal_lignite", "fossil_hard_coal", "fossil_coal_derived_gas", "fossil_peat"],
  gas: ["fossil_gas"],
  hydro: ["hydro_run_of_river", "hydro_water_reservoir", "hydro_pumped_storage"],
  solar: ["solar"],
  wind: ["wind_onshore", "wind_offshore"],
  other: ["biomass", "waste", "geothermal", "fossil_oil", "other", "other_renewable"],
};

function roundedEnergyMixValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 10) / 10 : 0;
}

function normalizeEnergyMixPoint(row) {
  const values = row?.values ?? {};
  const populatedGenerationGroups = Object.values(energyMixFields).filter((fields) => (
    fields.some((field) => values[field] !== null && values[field] !== undefined && Number.isFinite(Number(values[field])))
  )).length;
  if (!row?.timestamp || !Number.isFinite(Number(values.load)) || populatedGenerationGroups < 5) return null;
  const point = Object.fromEntries(Object.entries(energyMixFields).map(([key, fields]) => [
    key,
    roundedEnergyMixValue(fields.reduce((sum, field) => sum + Math.max(0, Number(values[field]) || 0), 0)),
  ]));
  const generation = Object.values(point).reduce((sum, value) => sum + value, 0);
  if (generation <= 0) return null;
  return {
    timestamp: row.timestamp,
    ...point,
    imports: roundedEnergyMixValue(Math.max(0, Number(values.cross_border_electricity_trading) || 0)),
    load: roundedEnergyMixValue(values.load),
    renewableSharePct: roundedEnergyMixValue(values.renewable_share_of_generation),
  };
}

function isCompleteEnergyMixPoint(point) {
  const generation = Object.keys(energyMixFields).reduce((sum, key) => sum + Math.max(0, Number(point?.[key]) || 0), 0);
  return Boolean(point?.timestamp)
    && Number.isFinite(new Date(point.timestamp).getTime())
    && Number(point.load) > 0
    && generation > 0;
}

async function readBulgariaMixHistory() {
  try {
    const stored = JSON.parse(await readFile(bulgariaMixHistoryFile, "utf8"));
    return Array.isArray(stored?.points) ? stored.points : [];
  } catch {
    return [];
  }
}

async function getEnergyChartsBulgariaMix() {
  const stored = await readBulgariaMixHistory();
  const start = stored.length
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2, 12)
    : new Date(now.getFullYear() - 1, now.getMonth(), now.getDate() - 7, 12);
  const dateParam = (value) => `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12);
  const url = new URL("https://api.energy-charts.info/v2/public_power");
  url.searchParams.set("country", "bg");
  url.searchParams.set("start", dateParam(start));
  url.searchParams.set("end", dateParam(tomorrow));
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "pasztra-tech-dashboard/1.0" } });
  if (!response.ok) throw new Error(`Energy-Charts: HTTP ${response.status}`);
  const body = await response.json();
  const received = (Array.isArray(body?.data) ? body.data : []).map(normalizeEnergyMixPoint).filter(Boolean);
  const earliest = now.getTime() - 400 * 86_400_000;
  const points = [...new Map([...stored, ...received]
    .filter((point) => new Date(point.timestamp).getTime() >= earliest && isCompleteEnergyMixPoint(point))
    .map((point) => [point.timestamp, point])).values()]
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  if (!points.length) throw new Error("Az Energy-Charts nem adott vissza bolgár termelési adatot.");
  const result = {
    source: "live",
    updatedAt: body.generated_at ?? now.toISOString(),
    availableFrom: points[0].timestamp,
    availableUntil: points.at(-1).timestamp,
    unit: "MW",
    resolutionMinutes: numberValue(body.interval_minutes, 60),
    license: body.license ?? "CC BY 4.0, attribution: energy-charts.info",
    sourceUrl: "https://www.energy-charts.info/charts/power/chart.htm?c=BG&l=en",
    sourceName: "Energy-Charts.info",
    points,
  };
  await mkdir(historyDir, { recursive: true });
  await writeFile(bulgariaMixHistoryFile, `${JSON.stringify(result)}\n`, "utf8");
  console.log(`Bulgária energiamix: ${received.length} friss, ${points.length} tárolt órás minta.`);
  return result;
}

async function readBulgariaMixDocument() {
  try {
    return JSON.parse(await readFile(bulgariaMixHistoryFile, "utf8"));
  } catch {
    return null;
  }
}

async function getEntsoeBulgariaEnergyMix(token) {
  const previous = await readBulgariaMixDocument();
  const isEntsoeHistory = String(previous?.sourceUrl ?? "").includes("entsoe.eu");
  const stored = isEntsoeHistory && Array.isArray(previous?.points) ? previous.points : [];
  const historyFloor = new Date(`${process.env.ENTSOE_HISTORY_START || "2025-01-01"}T00:00:00Z`);
  if (!Number.isFinite(historyFloor.getTime())) historyFloor.setTime(now.getTime() - 365 * 86_400_000);
  const requestedEnd = new Date(now.getTime() + 24 * 60 * 60_000);
  // The current Actual Total Load export accepts at most P1M. Two-week
  // windows are also less likely to hit the provider's five-second backend timeout.
  const chunkSizeMs = 14 * 86_400_000;
  const backfillSizeMs = 168 * 86_400_000;
  const intervals = [];
  let backfillFloorReached = Boolean(previous?.backfillComplete);
  if (!stored.length) {
    const start = new Date(Math.max(historyFloor.getTime(), requestedEnd.getTime() - backfillSizeMs));
    intervals.push([start, requestedEnd]);
    backfillFloorReached = start.getTime() <= historyFloor.getTime();
  } else {
    intervals.push([new Date(now.getTime() - 3 * 86_400_000), requestedEnd]);
    if (!previous?.backfillComplete) {
      const backfillEnd = new Date(stored[0].timestamp);
      const backfillStart = new Date(Math.max(historyFloor.getTime(), backfillEnd.getTime() - backfillSizeMs));
      intervals.push([backfillStart, backfillEnd]);
      backfillFloorReached = backfillStart.getTime() <= historyFloor.getTime();
    }
  }
  for (const failed of Array.isArray(previous?.failedRanges) ? previous.failedRanges : []) {
    const start = new Date(failed.start);
    const end = new Date(failed.end);
    if (Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && start < end) intervals.push([start, end]);
  }
  const ranges = [];
  const rangeIds = new Set();
  for (const [intervalStart, intervalEnd] of intervals) {
    for (let cursor = intervalStart.getTime(); cursor < intervalEnd.getTime(); cursor += chunkSizeMs) {
      const range = [new Date(cursor), new Date(Math.min(cursor + chunkSizeMs, intervalEnd.getTime()))];
      const id = `${range[0].toISOString()}|${range[1].toISOString()}`;
      if (!rangeIds.has(id)) {
        rangeIds.add(id);
        ranges.push(range);
      }
    }
  }
  const received = [];
  const failedRanges = [];
  let nextRange = 0;
  await Promise.all(Array.from({ length: Math.min(3, ranges.length) }, async () => {
    while (nextRange < ranges.length) {
      const [chunkStart, chunkEnd] = ranges[nextRange];
      nextRange += 1;
      try {
        received.push(...await fetchEntsoeBulgariaMix(token, chunkStart, chunkEnd));
      } catch (error) {
        failedRanges.push({ start: chunkStart.toISOString(), end: chunkEnd.toISOString() });
        console.error(`ENTSO-E részidőszak: ${error.message}`);
      }
    }
  }));
  const points = repairNuclearDropouts([...new Map([...stored, ...received]
    .filter((point) => new Date(point.timestamp).getTime() >= historyFloor.getTime() && isCompleteEnergyMixPoint(point))
    .map((point) => [point.timestamp, point])).values()]
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)));
  if (!points.length) throw new Error("Az ENTSO-E nem adott vissza bolgár termelési és terhelési adatot.");
  const result = {
    source: "live",
    updatedAt: now.toISOString(),
    availableFrom: points[0].timestamp,
    availableUntil: points.at(-1).timestamp,
    unit: "MW",
    resolutionMinutes: 60,
    ...entsoeMetadata,
    backfillComplete: backfillFloorReached || Boolean(previous?.backfillComplete),
    failedRanges,
    points,
  };
  await mkdir(historyDir, { recursive: true });
  await writeFile(bulgariaMixHistoryFile, `${JSON.stringify(result)}\n`, "utf8");
  console.log(`Bulgária energiamix (ENTSO-E): ${received.length} friss, ${points.length} tárolt órás minta; visszatöltés ${result.backfillComplete ? "kész" : "folyamatban"}, hibás szelet: ${failedRanges.length}.`);
  return result;
}

async function getBulgariaEnergyMix() {
  const token = process.env.ENTSOE_SECURITY_TOKEN?.trim();
  if (token) {
    try {
      return await getEntsoeBulgariaEnergyMix(token);
    } catch (error) {
      console.error(`ENTSO-E elsődleges adatforrás: ${error.message}; Energy-Charts tartalék következik.`);
    }
  }
  return getEnergyChartsBulgariaMix();
}

async function optionalSource(name, fetcher) {
  try {
    return await fetcher();
  } catch (error) {
    console.error(`${name}: ${error.message}`);
    return null;
  }
}

const [sungrow, govee, forecast, bulgariaMix] = await Promise.all([
  optionalSource("Sungrow", getSungrow),
  optionalSource("Govee", getGovee),
  optionalSource("Előrejelzés", getSolarForecast),
  optionalSource("Bulgária energiamix", getBulgariaEnergyMix),
]);
const weatherTwins = govee?.devices[0]
  ? await optionalSource("Időjárási ikervárosok", () => getWeatherTwins(govee.devices[0].temperatureC, govee.devices[0].humidityPct))
  : null;

if (!sungrow && !govee && !forecast && !bulgariaMix) {
  console.log("Nincsenek beállítva élő adatforrások; a bemutató mód marad aktív.");
  process.exit(0);
}

await mkdir(outputDir, { recursive: true });
const climateCharts = govee ? await updateClimateHistory(govee) : null;
for (const range of ["today", "7d", "30d", "year"]) {
  const dashboard = demoDashboard(range);
  dashboard.source = sungrow && govee ? "live" : "partial";
  dashboard.updatedAt = now.toISOString();
  dashboard.connections = {
    solar: { connected: Boolean(sungrow), ...(sungrow ? { updatedAt: now.toISOString() } : {}) },
    climate: { connected: Boolean(govee), ...(govee ? { updatedAt: govee.devices[0].updatedAt } : {}) },
  };
  if (sungrow) dashboard.solar = { ...sungrow.metrics, chart: sungrow.charts[range], energyChart: sungrow.energyCharts[range] };
  if (govee) dashboard.govee = { ...govee, chart: climateCharts[range], ...(weatherTwins ? { weatherTwins } : {}) };
  else dashboard.govee = { devices: [], chart: [] };
  if (forecast) dashboard.forecast = forecast;
  await writeFile(resolve(outputDir, `dashboard-${range}.json`), `${JSON.stringify(dashboard, null, 2)}\n`, "utf8");
}

if (sungrow) {
  for (const [date, dayData] of sungrow.dayHistory) {
    const dashboard = demoDashboard("today");
    dashboard.source = govee ? "live" : "partial";
    dashboard.updatedAt = now.toISOString();
    dashboard.connections = {
      solar: { connected: true, updatedAt: now.toISOString() },
      climate: { connected: Boolean(govee), ...(govee ? { updatedAt: govee.devices[0].updatedAt } : {}) },
    };
    dashboard.solar = { ...sungrow.metrics, chart: dayData.chart, energyChart: dayData.energyChart };
    if (govee) dashboard.govee = { ...govee, chart: climateCharts.days[date] ?? [], ...(weatherTwins ? { weatherTwins } : {}) };
    else dashboard.govee = { devices: [], chart: [] };
    if (forecast) dashboard.forecast = forecast;
    await writeFile(resolve(outputDir, `dashboard-day-${date}.json`), `${JSON.stringify(dashboard, null, 2)}\n`, "utf8");
  }
}

if (bulgariaMix) {
  const energyMixOutput = {
    ...bulgariaMix,
    household: sungrow ? {
      hourly: sungrow.energyCharts.today,
      daily: householdDailySeries(sungrow.energyCharts["30d"], sungrow.dayHistory),
      monthly: sungrow.energyCharts.year,
    } : undefined,
  };
  await writeFile(resolve(outputDir, "bulgaria-energy-mix.json"), `${JSON.stringify(energyMixOutput)}\n`, "utf8");
}

await writeFile(resolve("public/config.js"), `window.SOLAR_HOME_CONFIG = {\n  mode: "live",\n  endpoint: "./data/dashboard-{range}.json",\n  refreshSeconds: 300\n};\n`, "utf8");
const activeSources = [sungrow && "Sungrow", govee && "Govee", forecast && "Open-Meteo", bulgariaMix && (bulgariaMix.sourceName ?? "energiamix")].filter(Boolean);
console.log(`Élő dashboard-adatok elkészítve (${activeSources.join(" + ")}).`);
