import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { entsoeMetadata, fetchEntsoeBulgariaMix, fetchEntsoeBulgariaPlants } from "./entsoe-energy-mix.mjs";
import { DATA_SOURCE_ENDPOINTS } from "./data-sources/endpoints.mjs";
import { mergePlantHistory, reconcileNuclearPlant } from "./entsoe-plant-history.mjs";
import { repairNuclearDropouts } from "./energy-mix-repair.mjs";
import { fetchEnergyNews } from "./energy-news.mjs";
import { addHungarianNewsTranslations } from "./news-translation.mjs";
import { normalizeGoveeTemperature, repairClimateHistory } from "./govee-temperature.mjs";
import { isValidClimateValues } from "../shared/climateValidity.mjs";
import { fetchAirQuality } from "./air-quality.mjs";
import { fetchPersonalSensor } from "./personal-sensor.mjs";
import { mergeDashboard, mergeEnergyMix, retainNews, sourceWarning } from "./retained-data.mjs";
import { TIME_ZONE, dateKey, dateTimeFormatter } from "../shared/timeZone.mjs";
import { SUNGROW_FLOW_SCHEMA, powerKwList, devicePointUnits, extractDeviceSamples, batteryFlowKw, isCurrentSungrowDay, integratePowerDay } from "./sungrow-power.mjs";

// Provider calendar dates and Sungrow's zone-less timestamps belong to Bulgaria,
// including local runs on Windows. Stored ISO timestamps still represent UTC.
process.env.TZ = TIME_ZONE;

const execFileAsync = promisify(execFile);
const outputDir = resolve("public/data");
const historyDir = resolve(".data-history");
const historyFile = resolve(historyDir, "govee-history.json");
const energyHistoryFile = resolve(historyDir, "sungrow-energy-history.json");
const bulgariaMixHistoryFile = resolve(historyDir, "bulgaria-energy-mix.json");
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

function isValidClimateSample(sample) {
  return isValidClimateValues(sample?.temperature, sample?.humidity);
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

  const published = await readPublished("govee-history");
  if (Array.isArray(published)) return published;

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
  const history = repairClimateHistory([...byTimestamp.values()].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)));

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

async function readPublished(name) {
  try { return JSON.parse(await readFile(resolve(outputDir, `${name}.json`), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
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
      units: devicePointUnits(pointData),
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
    return psKey && ids.has("p8018") ? [{ psKey, power: "p8018", units: devicePointUnits(pointData) }] : [];
  });

  return candidates.find((device) => /_7(?:_|$)/.test(device.psKey)) ?? candidates[0] ?? null;
}

function extractBatterySamples(root, batteryDevice) {
  return extractDeviceSamples(root, Object.fromEntries([
    [batteryDevice.charge, "chargeKw"],
    [batteryDevice.discharge, "dischargeKw"],
    [batteryDevice.soc, "soc"],
    [batteryDevice.temperature, "temperatureC"],
    [batteryDevice.voltage, "voltageV"],
  ].filter(([pointId]) => pointId)), parseSungrowTimestamp, batteryDevice.units).map((sample) => ({
    ...sample,
    chargeKw: Number.isFinite(sample.chargeKw) ? Math.abs(sample.chargeKw) : sample.chargeKw,
    dischargeKw: Number.isFinite(sample.dischargeKw) ? Math.abs(sample.dischargeKw) : sample.dischargeKw,
  }));
}

function normalizeBatterySoc(samples, socPoint) {
  return samples.map((sample) => {
    if (!Number.isFinite(sample.soc)) return sample;

    // The battery-level device point (p13141) is returned as a 0-1 ratio by
    // iSolarCloud even though GoSungrow labels its unit as percent.
    const percent = sample.socUnit !== "%" && socPoint === "p13141" && sample.soc >= 0 && sample.soc <= 1
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
    const loadValue = load[index];
    const batterySample = nearestSample(batterySamples, timestamp);
    const gridSample = nearestSample(gridSamples, timestamp);
    const grid = gridSample?.gridKw;
    const measuredBattery = Number.isFinite(batterySample?.chargeKw) && Number.isFinite(batterySample?.dischargeKw)
      ? batterySample.dischargeKw - batterySample.chargeKw
      : undefined;
    // Positive grid means import, positive battery means discharge. With a real
    // grid-meter value the battery flow follows directly from the power balance.
    const battery = batteryFlowKw(point.value, loadValue, grid, measuredBattery);
    return {
      label: point.label,
      timestamp: timestamp.toISOString(),
      ...(Number.isFinite(point.value) ? { pv: point.value } : {}),
      ...(Number.isFinite(loadValue) ? { load: loadValue } : {}),
      ...(Number.isFinite(grid) ? { grid } : {}),
      ...(Number.isFinite(battery) ? { battery } : {}),
      ...(batterySample ? {
        batteryCharge: batterySample.chargeKw,
        batteryDischarge: batterySample.dischargeKw,
        batterySoc: batterySample.soc,
      } : {}),
    };
  }).filter((point) => Date.parse(point.timestamp) <= now.getTime());
  return { flowSchema: SUNGROW_FLOW_SCHEMA, chart: chart.slice(0, energyChart.length), energyChart };
}

function summarizeHouseholdDay(dateKey, dayData) {
  const points = dayData?.energyChart ?? [];
  if (!points.length) return null;
  const totals = integratePowerDay(points);
  const [year, month, day] = dateKey.split("-").map(Number);
  const rounded = Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Math.round(value * 1000) / 1000]));
  return {
    label: `${day}.${month}.`,
    timestamp: new Date(year, month - 1, day, 12).toISOString(),
    ...rounded,
    estimated: true,
    ...(Number.isFinite(totals.gridPurchase) && Number.isFinite(totals.gridFeedIn) ? { grid: Math.round((totals.gridPurchase - totals.gridFeedIn) * 1000) / 1000 } : {}),
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
    // Re-fetch old daily curves: their guessed W/kW scale cannot be safely
    // repaired from the already-normalized cache, nor by clipping large values.
    return isCurrentSungrowDay(value) ? value : null;
  } catch {
    return null;
  }
}

async function writeCachedSungrowDay(key, value) {
  await mkdir(sungrowDayHistoryDir, { recursive: true });
  await writeFile(resolve(sungrowDayHistoryDir, `${key}.json`), `${JSON.stringify(value)}\n`, "utf8");
}

async function getArchivedSungrowDays(psId, currentDayCharts, devices, currentTelemetryComplete) {
  const requested = Array.from({ length: sungrowDayRetention }, (_, offset) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    return { date, key: localDateKey(date) };
  });
  const results = new Map([[localDateKey(now), currentDayCharts]]);
  if (currentTelemetryComplete) await writeCachedSungrowDay(localDateKey(now), currentDayCharts);

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
        const [response, battery, grid] = await Promise.all([
          sungrowJson("AppService.getPowerStationData", [`DateId:${dayIdFor(date)}`, "DateType:1", `PsId:${psId}`]),
          getBatteryTelemetry(devices, date),
          getGridTelemetry(devices, date),
        ]);
        const production = powerKwList(deepFind(response, ["p83033List"]), deepFind(response, ["p83033Unit"]));
        const load = powerKwList(deepFind(response, ["p83106List"]), deepFind(response, ["p83106Unit"]));
        if (!production.length) return null;
        const value = buildDayCharts(date, production, load, battery.samples, grid.samples);
        // A transient failure must not cache an incomplete migration forever.
        if (battery.complete && grid.complete) await writeCachedSungrowDay(key, value);
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
    GOSUNGROW_HOST: process.env.SUNGROW_HOST || DATA_SOURCE_ENDPOINTS.sungrow.defaultHost,
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

async function queryDeviceTelemetry(psKey, points, date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  end.setMilliseconds(-1000);
  return sungrowJson("AppService.getDevicePointMinuteDataList", [
    `PsKey:${psKey}`,
    `StartTimeStamp:${sungrowTimestamp(start)}`,
    `EndTimeStamp:${sungrowTimestamp(new Date(Math.min(end.getTime(), now.getTime())))}`,
    `Points:${points.filter(Boolean).join(",")}`,
  ]);
}

async function getBatteryTelemetry(devices, date = now) {
  const batteryDevice = findBatteryDevice(devices);
  if (!batteryDevice) {
    console.error("Sungrow akkumulátor-adatpontok nem találhatók ennél az erőműnél.");
    return { samples: [], complete: Boolean(devices) };
  }

  const required = [batteryDevice.charge, batteryDevice.discharge, batteryDevice.soc];
  if (localDateKey(date) === localDateKey(now)) console.log(`Sungrow akkumulátor-pontok egysége: töltés ${batteryDevice.units[batteryDevice.charge] ?? "ismeretlen"}, leadás ${batteryDevice.units[batteryDevice.discharge] ?? "ismeretlen"}.`);
  const optional = localDateKey(date) === localDateKey(now)
    ? [batteryDevice.temperature, batteryDevice.voltage].filter(Boolean) : [];
  try {
    const response = await queryDeviceTelemetry(batteryDevice.psKey, [...required, ...optional], date)
      .catch((error) => {
        if (!optional.length) throw error;
        console.error(`Sungrow opcionális akkumulátor-adatok: ${error.message}; csak a szükséges pontok újrapróbálása.`);
        return queryDeviceTelemetry(batteryDevice.psKey, required, date);
      });
    const samples = normalizeBatterySoc(extractBatterySamples(response, batteryDevice), batteryDevice.soc);
    console.log(`Sungrow akkumulátor (${localDateKey(date)}): ${samples.length} minta, ellenőrzött mértékegységgel.`);
    return { samples, complete: samples.some((sample) => Number.isFinite(sample.chargeKw) && Number.isFinite(sample.dischargeKw)) };
  } catch (error) {
    console.error(`Sungrow akkumulátor (${localDateKey(date)}): ${error.message}`);
    return { samples: [], complete: false };
  }
}

async function getGridTelemetry(devices, date = now) {
  const meterDevice = findGridMeterDevice(devices);
  if (!meterDevice) {
    console.error("Sungrow hálózati mérő (p8018) nem található ennél az erőműnél.");
    return { samples: [], complete: Boolean(devices) };
  }

  if (localDateKey(date) === localDateKey(now)) console.log(`Sungrow hálózati pont egysége: ${meterDevice.units[meterDevice.power] ?? "ismeretlen"}.`);

  try {
    const response = await queryDeviceTelemetry(meterDevice.psKey, [meterDevice.power], date);
    const samples = extractDeviceSamples(response, { [meterDevice.power]: "gridKw" }, parseSungrowTimestamp, meterDevice.units);
    console.log(`Sungrow hálózat (${localDateKey(date)}): ${samples.length} minta, ellenőrzött mértékegységgel.`);
    return { samples, complete: samples.length > 0 };
  } catch (error) {
    console.error(`Sungrow hálózat (${localDateKey(date)}): ${error.message}`);
    return { samples: [], complete: false };
  }
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
    if (Number.isFinite(values.gridPurchase) && Number.isFinite(values.gridFeedIn)) {
      values.grid = values.gridPurchase - values.gridFeedIn;
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
    getBatteryTelemetry(devices),
    getGridTelemetry(devices),
    getEnergyHistory(psId),
  ]);
  const year = await sungrowJson("AppService.getPowerStationData", [`DateId:${yearId}`, "DateType:3", `PsId:${psId}`]).catch((error) => {
    console.error(`Sungrow éves összesítés nem érhető el: ${error.message}`);
    return null;
  });

  const production = powerKwList(deepFind(day, ["p83033List"]), deepFind(day, ["p83033Unit"]));
  const load = powerKwList(deepFind(day, ["p83106List"]), deepFind(day, ["p83106Unit"]));
  const dailyEnergy = numberList(deepFind(month, ["p83022List"]));
  const monthlyEnergy = year ? numberList(deepFind(year, ["p83022List"])) : [];
  const currentPowerKw = currentValue(production);
  const houseLoadKw = currentValue(load);
  const latestBatteryValue = (key) => [...battery.samples].reverse().find((sample) => Number.isFinite(sample[key]))?.[key];
  const latestGridPowerKw = [...grid.samples].reverse().find((sample) => Number.isFinite(sample.gridKw))?.gridKw;
  const todayKwh = numberValue(deepFind(day, ["dayPowerQuantityTotal", "p83022"]), dailyEnergy.at(-1) ?? 0);
  const monthKwh = dailyEnergy.reduce((sum, value) => sum + value, 0);
  const usedDirectly = Math.min(Math.max(houseLoadKw, 0), Math.max(currentPowerKw, 0));
  const selfConsumptionPct = currentPowerKw > 0 ? Math.round((usedDirectly / currentPowerKw) * 100) : 0;
  const co2Factor = numberValue(process.env.CO2_KG_PER_KWH, 0.233);

  const today = buildDayCharts(now, production, load, battery.samples, grid.samples);
  const todayChart = today.chart;
  const todayEnergy = today.energyChart;
  const telemetryComplete = battery.complete && grid.complete;
  const dayHistory = await getArchivedSungrowDays(psId, today, devices, telemetryComplete);
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
      status: telemetryComplete ? "online" : "warning",
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
  const url = new URL(DATA_SOURCE_ENDPOINTS.openMeteo.forecastApi);
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("hourly", "global_tilted_irradiance,cloud_cover,precipitation_probability");
  url.searchParams.set("tilt", String(tiltDeg));
  url.searchParams.set("azimuth", String(azimuthDeg));
  url.searchParams.set("timezone", TIME_ZONE);
  // Unix timestamps preserve both instances of the repeated autumn hour.
  url.searchParams.set("timeformat", "unixtime");
  url.searchParams.set("forecast_days", "4");

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Open-Meteo: HTTP ${response.status}`);
  const body = await response.json();
  const times = body.hourly?.time ?? [];
  const irradiance = body.hourly?.global_tilted_irradiance ?? [];
  const cloudCover = body.hourly?.cloud_cover ?? [];
  const precipitation = body.hourly?.precipitation_probability ?? [];
  const groups = new Map();

  const forecastClock = dateTimeFormatter({ hour: "2-digit", minute: "2-digit" });
  times.forEach((unixTime, index) => {
    const timestamp = new Date(unixTime * 1000);
    const date = dateKey(timestamp);
    const gti = Math.max(0, numberValue(irradiance[index]));
    const point = {
      label: forecastClock.format(timestamp),
      timestamp: timestamp.toISOString(),
      expectedPowerKw: Math.min(systemKwp, systemKwp * (gti / 1000) * performanceRatio),
      irradianceWm2: gti,
      cloudCoverPct: numberValue(cloudCover[index]),
      precipitationProbabilityPct: typeof precipitation[index] === "number" && Number.isFinite(precipitation[index]) && precipitation[index] >= 0 && precipitation[index] <= 100 ? precipitation[index] : null,
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
  const devicesResponse = await fetch(DATA_SOURCE_ENDPOINTS.govee.devicesApi, { headers });
  if (!devicesResponse.ok) throw new Error(`Govee eszközlista: HTTP ${devicesResponse.status}`);
  const devicesBody = await devicesResponse.json();
  const devices = devicesBody.data ?? devicesBody.payload ?? [];
  const device = devices.find((item) => process.env.GOVEE_DEVICE_ID && item.device === process.env.GOVEE_DEVICE_ID)
    ?? devices.find((item) => process.env.GOVEE_DEVICE_SKU && item.sku === process.env.GOVEE_DEVICE_SKU)
    ?? devices.find((item) => item.capabilities?.some((capability) => capability.instance === "sensorTemperature"));
  if (!device) throw new Error("Nem található hőmérsékletet mérő Govee eszköz.");

  const stateResponse = await fetch(DATA_SOURCE_ENDPOINTS.govee.stateApi, {
    method: "POST",
    headers,
    body: JSON.stringify({ requestId: randomUUID(), payload: { sku: device.sku, device: device.device } }),
  });
  if (!stateResponse.ok) throw new Error(`Govee állapot: HTTP ${stateResponse.status}`);
  const stateBody = await stateResponse.json();
  const capabilities = stateBody.payload?.capabilities ?? [];
  const state = (instance) => capabilities.find((item) => item.instance === instance)?.state?.value;
  const temperatureCapability = device.capabilities?.find((item) => item.instance === "sensorTemperature");
  const declaredUnit = temperatureCapability?.parameters?.unit ?? "";
  const temperatureC = normalizeGoveeTemperature(numberValue(state("sensorTemperature"), Number.NaN), declaredUnit);
  const humidityPct = numberValue(state("sensorHumidity"));
  const battery = capabilities.find((item) => /battery/i.test(item.instance ?? ""));

  if (!isValidClimateSample({ temperature: temperatureC, humidity: humidityPct })) {
    throw new Error("Hiányzó vagy érvénytelen klímamérés; a hibás minta kihagyva.");
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
  const stored = await readBulgariaMixDocument();
  return Array.isArray(stored?.points) ? stored.points : [];
}

async function getEnergyChartsBulgariaMix() {
  const stored = await readBulgariaMixHistory();
  const start = stored.length
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2, 12)
    : new Date(now.getFullYear() - 1, now.getMonth(), now.getDate() - 7, 12);
  const dateParam = (value) => `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12);
  const url = new URL(DATA_SOURCE_ENDPOINTS.energyCharts.api);
  url.searchParams.set("country", "bg");
  url.searchParams.set("start", dateParam(start));
  url.searchParams.set("end", dateParam(tomorrow));
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "pasztra-tech-dashboard/1.0" } });
  if (!response.ok) throw new Error(`Energy-Charts: HTTP ${response.status}`);
  const body = await response.json();
  const received = (Array.isArray(body?.data) ? body.data : []).map(normalizeEnergyMixPoint).filter(Boolean);
  if (!received.length) throw new Error("Az Energy-Charts nem küldött friss adatot; a korábbi pillanatkép marad.");
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
    sourceUrl: DATA_SOURCE_ENDPOINTS.energyCharts.website,
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
    return readPublished("bulgaria-energy-mix");
  }
}

async function updateEntsoePlantHistory(token, previous, historyFloor) {
  const plantHistoryVersion = 6;
  const stored = previous?.plantHistoryVersion === plantHistoryVersion && Array.isArray(previous?.plants) ? previous.plants : [];
  const lastAttempt = new Date(previous?.plantsUpdatedAt ?? 0).getTime();
  if (previous?.plantHistoryVersion === plantHistoryVersion && Number.isFinite(lastAttempt) && now.getTime() - lastAttempt >= 0 && now.getTime() - lastAttempt < 5 * 3_600_000) {
    return {
      plants: stored,
      plantHistoryVersion,
      plantsUpdatedAt: previous.plantsUpdatedAt,
      plantDataFrom: previous.plantDataFrom,
      plantDataUntil: previous.plantDataUntil,
      unmappedPlantResources: previous.unmappedPlantResources ?? [],
    };
  }

  const latestDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6));
  const requestedDays = [];
  if (!stored.length) {
    for (let offset = 60; offset >= 0; offset -= 1) requestedDays.push(new Date(latestDay.getTime() - offset * 86_400_000));
  } else {
    for (let offset = 2; offset >= 0; offset -= 1) requestedDays.push(new Date(latestDay.getTime() - offset * 86_400_000));
    const earliest = stored.flatMap((plant) => plant.days ?? []).map((day) => day.date).sort()[0];
    const backfillEnd = earliest ? new Date(`${earliest}T00:00:00Z`) : latestDay;
    for (let offset = 14; offset >= 1; offset -= 1) {
      const day = new Date(backfillEnd.getTime() - offset * 86_400_000);
      if (day >= historyFloor) requestedDays.push(day);
    }
  }

  const uniqueDays = [...new Map(requestedDays
    .filter((day) => day >= historyFloor && day <= latestDay)
    .map((day) => [day.toISOString().slice(0, 10), day])).values()];
  const batches = [];
  const unmapped = new Map();
  const sofiaHour = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", hour: "2-digit", hourCycle: "h23" });
  const sofiaMidnight = (day) => {
    const utcMidnight = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    const offsetHours = Number(sofiaHour.format(utcMidnight));
    return new Date(utcMidnight.getTime() - offsetHours * 3_600_000);
  };
  for (const day of uniqueDays) {
    const nextLocalDay = new Date(day.getTime() + 86_400_000);
    try {
      const document = await fetchEntsoeBulgariaPlants(token, sofiaMidnight(day), sofiaMidnight(nextLocalDay));
      batches.push(document.plants);
      for (const resource of document.unmapped) unmapped.set(`${resource.psrType}|${resource.resourceName}|${resource.resourceId}`, resource);
    } catch (error) {
      console.error(`ENTSO-E erőművi nap (${day.toISOString().slice(0, 10)}): ${error.message}`);
    }
  }

  const floorKey = historyFloor.toISOString().slice(0, 10);
  const plants = mergePlantHistory(stored, batches, floorKey);
  const dates = plants.flatMap((plant) => plant.days.map((day) => day.date)).sort();
  console.log(`Bulgária erőművi térkép: ${plants.length} azonosított erőmű, ${dates.length ? `${dates[0]}–${dates.at(-1)}` : "nincs elérhető nap"}.`);
  return {
    plants,
    plantHistoryVersion,
    plantsUpdatedAt: now.toISOString(),
    plantDataFrom: dates[0],
    plantDataUntil: dates.at(-1),
    unmappedPlantResources: [...unmapped.values()],
  };
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
  const plantHistory = await updateEntsoePlantHistory(token, previous, historyFloor);
  const plants = reconcileNuclearPlant(plantHistory.plants, points);
  const result = {
    source: "live",
    updatedAt: received.length ? now.toISOString() : previous?.updatedAt ?? points.at(-1).timestamp,
    stale: !received.length,
    availableFrom: points[0].timestamp,
    availableUntil: points.at(-1).timestamp,
    unit: "MW",
    resolutionMinutes: 60,
    ...entsoeMetadata,
    backfillComplete: backfillFloorReached || Boolean(previous?.backfillComplete),
    failedRanges,
    ...plantHistory,
    plants,
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

const previousNews = await readPublished("energy-news");
const previousMix = await readPublished("bulgaria-energy-mix");
const [sungrow, govee, forecast, bulgariaMix, energyNews, airQuality, personalSensor] = await Promise.all([
  optionalSource("Sungrow", getSungrow),
  optionalSource("Govee", getGovee),
  optionalSource("Előrejelzés", getSolarForecast),
  optionalSource("Bulgária energiamix", getBulgariaEnergyMix),
  optionalSource("Bolgár energiahírek", async () => addHungarianNewsTranslations(await fetchEnergyNews(now), { previousItems: previousNews?.items, requestedUrl: "" })),
  optionalSource("Szálló por", () => fetchAirQuality(now)),
  optionalSource("Saját szenzor", () => fetchPersonalSensor(now)),
]);
await mkdir(outputDir, { recursive: true });
const climateCharts = govee ? await updateClimateHistory(govee) : null;
const warnings = [
  ...(sungrow?.metrics.status === "warning" ? [{
    source: "Sungrow",
    message: "A hálózat vagy az akkumulátor részletes adatai nem érkeztek meg; a hiányzó értékeket nem becsüljük meg.",
  }] : []),
  ...(!bulgariaMix || bulgariaMix.stale ? [sourceWarning("Bulgária", previousMix?.updatedAt)] : []),
  ...(!energyNews ? [sourceWarning("Hírek", previousNews?.updatedAt)] : []),
  ...(!airQuality ? [sourceWarning("Szálló por", (await readPublished("air-quality"))?.updatedAt)] : []),
];
for (const range of ["today", "7d", "30d", "year"]) {
  const dashboard = mergeDashboard({
    previous: await readPublished(`dashboard-${range}`), now, warnings, forecast,
    solar: sungrow && { ...sungrow.metrics, chart: sungrow.charts[range], energyChart: sungrow.energyCharts[range] },
    govee: govee && { ...govee, chart: climateCharts[range] },
  });
  await writeFile(resolve(outputDir, `dashboard-${range}.json`), `${JSON.stringify(dashboard, null, 2)}\n`, "utf8");
}

if (sungrow) {
  for (const [date, dayData] of sungrow.dayHistory) {
    const dashboard = mergeDashboard({
      previous: await readPublished(`dashboard-day-${date}`), now, warnings, forecast,
      solar: { ...sungrow.metrics, chart: dayData.chart, energyChart: dayData.energyChart },
      govee: govee && { ...govee, chart: climateCharts.days[date] ?? [] },
    });
    await writeFile(resolve(outputDir, `dashboard-day-${date}.json`), `${JSON.stringify(dashboard, null, 2)}\n`, "utf8");
  }
}

const energyMixOutput = mergeEnergyMix(previousMix, bulgariaMix, sungrow ? {
  hourly: sungrow.energyCharts.today,
  daily: householdDailySeries(sungrow.energyCharts["30d"], sungrow.dayHistory),
  monthly: sungrow.energyCharts.year,
} : undefined);
if (energyMixOutput) {
  await writeFile(resolve(outputDir, "bulgaria-energy-mix.json"), `${JSON.stringify(energyMixOutput)}\n`, "utf8");
}

const newsOutput = energyNews ?? retainNews(previousNews, now);
if (newsOutput) {
  await writeFile(resolve(outputDir, "energy-news.json"), `${JSON.stringify(newsOutput, null, 2)}\n`, "utf8");
}

await writeFile(resolve("public/config.js"), `window.SOLAR_HOME_CONFIG = {\n  mode: "live",\n  endpoint: "./data/dashboard-{range}.json",\n  refreshSeconds: 300\n};\n`, "utf8");
const activeSources = [sungrow && "Sungrow", govee && "Govee", forecast && "Open-Meteo", bulgariaMix && (bulgariaMix.sourceName ?? "energiamix"), energyNews && "bolgár sajtó", airQuality?.stations.length && "Sensor.Community", personalSensor?.points.length && "Saját szenzor"].filter(Boolean);
console.log(`Élő dashboard-adatok elkészítve (${activeSources.join(" + ")}).`);
