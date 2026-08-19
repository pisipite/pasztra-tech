import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const outputDir = resolve("public/data");
const historyDir = resolve(".data-history");
const historyFile = resolve(historyDir, "govee-history.json");
const sungrowDayHistoryDir = resolve(historyDir, "sungrow-days");
const now = new Date();
const pad = (value) => String(value).padStart(2, "0");
const dayId = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
const monthId = dayId.slice(0, 6);
const yearId = dayId.slice(0, 4);
const climateRetentionMs = 370 * 86_400_000;
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

function averageClimate(samples, keyType) {
  const groups = new Map();
  for (const sample of samples) {
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
      .filter((item) => Number.isFinite(item?.temperature) && Number.isFinite(item?.humidity) && new Date(item?.timestamp).getTime() >= earliest)
      .map((item) => [item.timestamp, item]),
  );
  byTimestamp.set(sample.timestamp, sample);
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
  const timestamp = parseSungrowTimestamp(ownValue(row, "timeStamp"));
  if (timestamp) return period === "month" ? localMonthKey(timestamp) : localDateKey(timestamp);
  const dateId = textValue(ownValue(row, "dateId")).replace(/\D/g, "");
  if (period === "month" && dateId.length >= 6) return `${dateId.slice(0, 4)}-${dateId.slice(4, 6)}`;
  if (period === "day" && dateId.length >= 8) return `${dateId.slice(0, 4)}-${dateId.slice(4, 6)}-${dateId.slice(6, 8)}`;
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

async function getEnergyHistory(psId) {
  const [monthResult, yearResult] = await Promise.allSettled([
    sungrowJson("AppService.getHouseholdStoragePsReport", [`DateId:${monthId}`, "DateType:2", `PsId:${psId}`]),
    sungrowJson("AppService.getHouseholdStoragePsReport", [`DateId:${yearId}`, "DateType:3", `PsId:${psId}`]),
  ]);
  if (monthResult.status === "rejected") console.error(`Sungrow napi hálózati energia: ${monthResult.reason.message}`);
  if (yearResult.status === "rejected") console.error(`Sungrow havi hálózati energia: ${yearResult.reason.message}`);
  const daily = monthResult.status === "fulfilled"
    ? energyMapFromReport(monthResult.value, "monthDataDayList", "day", {
      pv: "p83077",
      gridPurchase: "p83102",
      gridFeedIn: "p83072",
      batteryCharge: "p83088",
      batteryDischarge: "p83089",
      load: "p83118",
    })
    : new Map();
  const monthly = yearResult.status === "fulfilled"
    ? energyMapFromReport(yearResult.value, "yearDataMonthList", "month", {
      pv: "p83078",
      gridPurchase: "p83103",
      gridFeedIn: "p83073",
      batteryCharge: "p83088",
      batteryDischarge: "p83091",
      load: "p83118",
    })
    : new Map();
  console.log(`Sungrow hálózati energia: ${daily.size} nap, ${monthly.size} hónap.`);
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
  const yearEnergy = Array.from({ length: Math.max(yearChart.length, now.getMonth() + 1) }, (_, index) => {
    const point = yearChart[index];
    const timestamp = new Date(now.getFullYear(), index, 1, 12);
    return { label: point?.label ?? ["Jan", "Feb", "Már", "Ápr", "Máj", "Jún", "Júl", "Aug", "Szept", "Okt", "Nov", "Dec"][index], timestamp: timestamp.toISOString(), ...(point ? { pv: point.value } : {}), ...monthlyEnergyReport.get(localMonthKey(timestamp)) };
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

async function optionalSource(name, fetcher) {
  try {
    return await fetcher();
  } catch (error) {
    console.error(`${name}: ${error.message}`);
    return null;
  }
}

const [sungrow, govee, forecast] = await Promise.all([
  optionalSource("Sungrow", getSungrow),
  optionalSource("Govee", getGovee),
  optionalSource("Előrejelzés", getSolarForecast),
]);

if (!sungrow && !govee && !forecast) {
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
  if (govee) dashboard.govee = { ...govee, chart: climateCharts[range] };
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
    if (govee) dashboard.govee = { ...govee, chart: climateCharts.days[date] ?? [] };
    if (forecast) dashboard.forecast = forecast;
    await writeFile(resolve(outputDir, `dashboard-day-${date}.json`), `${JSON.stringify(dashboard, null, 2)}\n`, "utf8");
  }
}

await writeFile(resolve("public/config.js"), `window.SOLAR_HOME_CONFIG = {\n  mode: "live",\n  endpoint: "./data/dashboard-{range}.json",\n  refreshSeconds: 300\n};\n`, "utf8");
const activeSources = [sungrow && "Sungrow", govee && "Govee", forecast && "Open-Meteo"].filter(Boolean);
console.log(`Élő dashboard-adatok elkészítve (${activeSources.join(" + ")}).`);
