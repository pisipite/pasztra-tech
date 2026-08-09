import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const outputDir = resolve("public/data");
const now = new Date();
const pad = (value) => String(value).padStart(2, "0");
const dayId = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
const monthId = dayId.slice(0, 6);

function demoDashboard(range) {
  const chart = range === "today"
    ? [0, 0.2, 1.1, 2.6, 4.1, 5.2, 5.8, 5.5, 4.7, 3.3, 1.8, 0.5, 0].map((value, index) => ({ label: String(index + 6), value }))
    : range === "7d"
      ? [24.1, 28.7, 19.4, 31.2, 30.4, 26.8, 29.6].map((value, index) => ({ label: String(index + 1), value }))
      : [26.2, 22.4, 30.8, 27.1, 18.9, 29.7, 31.4, 25.8].map((value, index) => ({ label: String(index * 4 + 1), value }));
  return {
    source: "demo",
    updatedAt: now.toISOString(),
    solar: {
      status: "online",
      currentPowerKw: 4.82,
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
    return numberValue(value.value ?? value.value_float ?? value.value_int ?? value.stringValue, fallback);
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

async function getSungrow() {
  if (!process.env.SUNGROW_USER || !process.env.SUNGROW_PASSWORD) return null;
  const psId = await resolveSungrowPsId();
  const [day, month, overview] = await Promise.all([
    sungrowJson("AppService.getPowerStationData", [`DateId:${dayId}`, "DateType:1", `PsId:${psId}`]),
    sungrowJson("AppService.getPowerStationData", [`DateId:${monthId}`, "DateType:2", `PsId:${psId}`]),
    sungrowJson("WebAppService.showPSView", [`PsId:${psId}`]),
  ]);

  const production = numberList(deepFind(day, ["p83033List"]));
  const load = numberList(deepFind(day, ["p83106List"]));
  const dailyEnergy = numberList(deepFind(month, ["p83022List"]));
  const currentPowerKw = currentValue(production);
  const houseLoadKw = currentValue(load);
  const todayKwh = numberValue(deepFind(day, ["dayPowerQuantityTotal", "p83022"]), dailyEnergy.at(-1) ?? 0);
  const monthKwh = dailyEnergy.reduce((sum, value) => sum + value, 0);
  const usedDirectly = Math.min(Math.max(houseLoadKw, 0), Math.max(currentPowerKw, 0));
  const selfConsumptionPct = currentPowerKw > 0 ? Math.round((usedDirectly / currentPowerKw) * 100) : 0;
  const co2Factor = numberValue(process.env.CO2_KG_PER_KWH, 0.233);

  const todayChart = production.map((value, index) => ({
    label: pad(Math.floor((index / Math.max(production.length - 1, 1)) * 24)),
    value,
  }));
  const monthChart = dailyEnergy.map((value, index) => ({ label: String(index + 1), value }));

  return {
    metrics: {
      status: "online",
      currentPowerKw,
      todayKwh,
      monthKwh,
      lifetimeMwh: unitToMwh(deepFind(overview, ["totalAllPower"])),
      selfConsumptionPct,
      co2SavedKg: todayKwh * co2Factor,
      houseLoadKw,
      gridPowerKw: houseLoadKw - currentPowerKw,
    },
    charts: {
      today: todayChart.length ? todayChart : [{ label: pad(now.getHours()), value: currentPowerKw }],
      "7d": monthChart.slice(-7),
      "30d": monthChart.slice(-30),
    },
  };
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

const results = await Promise.allSettled([getSungrow(), getGovee()]);
const sungrow = results[0].status === "fulfilled" ? results[0].value : null;
const govee = results[1].status === "fulfilled" ? results[1].value : null;
if (results[0].status === "rejected") console.error(`Sungrow: ${results[0].reason.message}`);
if (results[1].status === "rejected") console.error(`Govee: ${results[1].reason.message}`);

if (!sungrow && !govee) {
  console.log("Nincsenek beállítva élő adatforrások; a bemutató mód marad aktív.");
  process.exit(0);
}

await mkdir(outputDir, { recursive: true });
for (const range of ["today", "7d", "30d"]) {
  const dashboard = demoDashboard(range);
  dashboard.source = sungrow && govee ? "live" : "partial";
  dashboard.updatedAt = now.toISOString();
  if (sungrow) dashboard.solar = { ...sungrow.metrics, chart: sungrow.charts[range] };
  if (govee) dashboard.govee = govee;
  await writeFile(resolve(outputDir, `dashboard-${range}.json`), `${JSON.stringify(dashboard, null, 2)}\n`, "utf8");
}

await writeFile(resolve("public/config.js"), `window.SOLAR_HOME_CONFIG = {\n  mode: "live",\n  endpoint: "./data/dashboard-{range}.json",\n  refreshSeconds: 900\n};\n`, "utf8");
console.log(`Élő dashboard-adatok elkészítve (${sungrow ? "Sungrow" : ""}${sungrow && govee ? " + " : ""}${govee ? "Govee" : ""}).`);
