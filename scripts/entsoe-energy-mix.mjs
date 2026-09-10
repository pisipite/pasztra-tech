const ENTSOE_ENDPOINT = "https://web-api.tp.entsoe.eu/api";
const BULGARIA_BIDDING_ZONE = "10YCA-BULGARIA-R";

const psrGroups = {
  B01: "other", // biomass
  B02: "coal",
  B03: "coal",
  B04: "gas",
  B05: "coal",
  B06: "other",
  B07: "other",
  B08: "coal",
  B09: "other",
  B10: "hydro",
  B11: "hydro",
  B12: "hydro",
  B13: "other",
  B14: "nuclear",
  B15: "other",
  B16: "solar",
  B17: "other",
  B18: "wind",
  B19: "wind",
  B20: "other",
  B25: "other",
};

const renewablePsrTypes = new Set(["B01", "B09", "B10", "B11", "B12", "B13", "B15", "B16", "B18", "B19"]);
const mixKeys = ["nuclear", "coal", "gas", "hydro", "solar", "wind", "other"];

const bulgariaPlantCatalog = [
  { id: "kozloduy", name: "Kozloduj Atomerőmű", type: "nuclear", latitude: 43.746, longitude: 23.77, capacityMw: 2080, matches: [/kozlod/i, /npp\s*[56]\b/i] },
  { id: "maritsa-east-2", name: "Marica Iztok 2", type: "coal", latitude: 42.255, longitude: 26.132, capacityMw: 1620, matches: [/mar(?:i|it)sa.*(?:east|iztok).*2/i, /tpp\s*2\b/i] },
  { id: "aes-galabovo", name: "AES Galabovo", type: "coal", latitude: 42.162, longitude: 25.886, capacityMw: 670, matches: [/aes.*galabovo/i, /mar(?:i|it)sa.*(?:east|iztok).*1/i] },
  { id: "maritsa-east-3", name: "Marica Iztok 3", type: "coal", latitude: 42.147, longitude: 26.016, capacityMw: 908, matches: [/contourglobal/i, /mar(?:i|it)sa.*(?:east|iztok).*3/i] },
  { id: "chaira", name: "Chaira Szivattyús Erőmű", type: "hydro", latitude: 42.006, longitude: 23.805, capacityMw: 864, matches: [/chaira/i] },
  { id: "belmeken", name: "Belmeken Vízerőmű", type: "hydro", latitude: 42.165, longitude: 23.805, capacityMw: 375, matches: [/belmeken/i] },
  { id: "sestrimo", name: "Sestrimo Vízerőmű", type: "hydro", latitude: 42.117, longitude: 23.85, capacityMw: 240, matches: [/sestrimo/i] },
  { id: "kardzhali", name: "Kardzsali Vízerőmű", type: "hydro", latitude: 41.638, longitude: 25.365, capacityMw: 108, matches: [/kardzhali/i, /kardjali/i] },
  { id: "studen-kladenets", name: "Studen Kladenets Vízerőmű", type: "hydro", latitude: 41.62, longitude: 25.61, capacityMw: 60, matches: [/studen.*kladen/i] },
  { id: "bobov-dol", name: "Bobov Dol Hőerőmű", type: "coal", latitude: 42.307, longitude: 23.025, capacityMw: 630, matches: [/bobov.*dol/i] },
  { id: "varna", name: "Várnai Hőerőmű", type: "gas", latitude: 43.198, longitude: 27.695, capacityMw: 1260, matches: [/varna/i] },
];

function plantForResource(name) {
  return bulgariaPlantCatalog.find((plant) => plant.matches.some((expression) => expression.test(name)));
}

function sofiaDateParts(timestamp) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Sofia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { date: `${value.year}-${value.month}-${value.day}`, hour: Number(value.hour) };
}

function xmlBlocks(xml, localName) {
  const escaped = localName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(`<(?:(?:[\\w-]+):)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:(?:[\\w-]+):)?${escaped}\\s*>`, "gi");
  return [...xml.matchAll(expression)].map((match) => match[1]);
}

function xmlText(xml, localName) {
  return xmlBlocks(xml, localName)[0]?.trim() ?? "";
}

function durationMinutes(value) {
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/i);
  if (!match) return 60;
  return Math.max(1, Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0));
}

function hourlyKey(timestamp) {
  const date = new Date(timestamp);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

function seriesValues(xml) {
  const values = [];
  for (const period of xmlBlocks(xml, "Period")) {
    const start = new Date(xmlText(xmlText(period, "timeInterval"), "start"));
    const stepMinutes = durationMinutes(xmlText(period, "resolution"));
    if (!Number.isFinite(start.getTime())) continue;
    for (const point of xmlBlocks(period, "Point")) {
      const position = Number(xmlText(point, "position"));
      const quantity = Number(xmlText(point, "quantity"));
      if (!Number.isInteger(position) || position < 1 || !Number.isFinite(quantity)) continue;
      values.push({
        timestamp: new Date(start.getTime() + (position - 1) * stepMinutes * 60_000).toISOString(),
        value: Math.max(0, quantity),
        resolutionMinutes: stepMinutes,
      });
    }
  }
  return values;
}

function acknowledgementError(xml) {
  if (!/<(?:[\w-]+:)?Acknowledgement_MarketDocument\b/i.test(xml)) return "";
  const reason = xmlText(xml, "text") || xmlText(xml, "code") || "ismeretlen API-hiba";
  return reason.replace(/\s+/g, " ").trim();
}

function averageHourly(samples) {
  const hours = new Map();
  for (const sample of samples) {
    const key = hourlyKey(sample.timestamp);
    const group = hours.get(key) ?? { sum: 0, count: 0 };
    group.sum += sample.value;
    group.count += 1;
    hours.set(key, group);
  }
  return new Map([...hours].map(([timestamp, group]) => [timestamp, group.sum / group.count]));
}

export function parseEntsoeGeneration(xml) {
  const error = acknowledgementError(xml);
  if (error) throw new Error(`ENTSO-E: ${error}`);

  // A pumped-storage series may describe consumption through an out-domain.
  // It must not be added to generation, otherwise hydro is double counted.
  const byPsr = new Map();
  for (const timeSeries of xmlBlocks(xml, "TimeSeries")) {
    const psrType = xmlText(timeSeries, "psrType");
    if (!psrGroups[psrType]) continue;
    const hasInDomain = Boolean(xmlText(timeSeries, "inBiddingZone_Domain.mRID"));
    const hasOutDomain = Boolean(xmlText(timeSeries, "outBiddingZone_Domain.mRID"));
    if (hasOutDomain && !hasInDomain) continue;
    for (const sample of seriesValues(timeSeries)) byPsr.set(`${psrType}|${sample.timestamp}`, { ...sample, psrType });
  }

  const exact = new Map();
  for (const sample of byPsr.values()) {
    const point = exact.get(sample.timestamp) ?? {};
    const group = psrGroups[sample.psrType];
    point[group] = (point[group] ?? 0) + sample.value;
    if (renewablePsrTypes.has(sample.psrType)) point.renewable = (point.renewable ?? 0) + sample.value;
    exact.set(sample.timestamp, point);
  }

  const hourly = new Map();
  for (const [timestamp, point] of exact) {
    const key = hourlyKey(timestamp);
    const group = hourly.get(key) ?? {
      sums: Object.fromEntries([...mixKeys, "renewable"].map((field) => [field, 0])),
      counts: Object.fromEntries([...mixKeys, "renewable"].map((field) => [field, 0])),
    };
    for (const field of [...mixKeys, "renewable"]) {
      if (!Number.isFinite(point[field])) continue;
      group.sums[field] += point[field];
      group.counts[field] += 1;
    }
    hourly.set(key, group);
  }

  const rows = [...hourly].sort(([a], [b]) => a.localeCompare(b)).map(([timestamp, group]) => ({
    timestamp,
    ...Object.fromEntries([...mixKeys, "renewable"].map((field) => [field, group.counts[field] ? group.sums[field] / group.counts[field] : null])),
  }));
  for (const field of [...mixKeys, "renewable"]) {
    for (let index = 1; index < rows.length - 1; index += 1) {
      if (rows[index][field] !== null) continue;
      const previous = rows[index - 1];
      const next = rows[index + 1];
      const previousTime = new Date(previous.timestamp).getTime();
      const currentTime = new Date(rows[index].timestamp).getTime();
      const nextTime = new Date(next.timestamp).getTime();
      if (currentTime - previousTime !== 3_600_000 || nextTime - currentTime !== 3_600_000) continue;
      if (!Number.isFinite(previous[field]) || !Number.isFinite(next[field])) continue;
      rows[index][field] = (previous[field] + next[field]) / 2;
    }
  }
  return new Map(rows.map(({ timestamp, ...values }) => [timestamp, {
    ...Object.fromEntries(mixKeys.map((field) => [field, values[field] ?? 0])),
    renewable: values.renewable ?? 0,
  }]));
}

export function parseEntsoeLoad(xml) {
  const error = acknowledgementError(xml);
  if (error) throw new Error(`ENTSO-E: ${error}`);
  const samples = new Map();
  for (const timeSeries of xmlBlocks(xml, "TimeSeries")) {
    for (const sample of seriesValues(timeSeries)) samples.set(sample.timestamp, sample);
  }
  return averageHourly(samples.values());
}

export function parseEntsoeGenerationUnits(xml) {
  const error = acknowledgementError(xml);
  if (error) throw new Error(`ENTSO-E: ${error}`);

  const plantSamples = new Map();
  for (const timeSeries of xmlBlocks(xml, "TimeSeries")) {
    const psrType = xmlText(timeSeries, "psrType");
    const type = psrGroups[psrType];
    if (!type) continue;
    const resource = xmlBlocks(timeSeries, "PowerSystemResources")[0] ?? "";
    const resourceName = xmlText(timeSeries, "registeredResource.name") || xmlText(resource, "name") || xmlText(timeSeries, "name");
    const resourceId = xmlText(timeSeries, "registeredResource.mRID") || xmlText(resource, "mRID");
    const plant = plantForResource(`${resourceName} ${resourceId}`);
    if (!plant) continue;
    const samples = plantSamples.get(plant.id) ?? { plant, values: new Map() };
    for (const sample of seriesValues(timeSeries)) {
      const current = samples.values.get(sample.timestamp) ?? { powerMw: 0, resolutionMinutes: sample.resolutionMinutes };
      current.powerMw += sample.value;
      current.resolutionMinutes = Math.max(current.resolutionMinutes, sample.resolutionMinutes);
      samples.values.set(sample.timestamp, current);
    }
    plantSamples.set(plant.id, samples);
  }

  return [...plantSamples.values()].map(({ plant, values }) => {
    const days = new Map();
    for (const [timestamp, sample] of values) {
      const { date, hour } = sofiaDateParts(timestamp);
      const day = days.get(date) ?? { date, energyMwh: 0, observedHours: 0, peakMw: 0, hourlyEnergy: Array(24).fill(0), hourlyCoverage: Array(24).fill(0) };
      const hours = sample.resolutionMinutes / 60;
      day.energyMwh += sample.powerMw * hours;
      day.observedHours += hours;
      day.peakMw = Math.max(day.peakMw, sample.powerMw);
      day.hourlyEnergy[hour] += sample.powerMw * hours;
      day.hourlyCoverage[hour] += hours;
      days.set(date, day);
    }
    return {
      id: plant.id,
      name: plant.name,
      type: plant.type,
      latitude: plant.latitude,
      longitude: plant.longitude,
      capacityMw: plant.capacityMw,
      days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).map((day) => ({
        date: day.date,
        energyMwh: Math.round(day.energyMwh * 10) / 10,
        averageMw: Math.round(day.energyMwh / Math.max(day.observedHours, 1) * 10) / 10,
        peakMw: Math.round(day.peakMw * 10) / 10,
        hourlyMw: day.hourlyEnergy.map((energy, hour) => day.hourlyCoverage[hour] ? Math.round(energy / day.hourlyCoverage[hour] * 10) / 10 : 0),
      })),
    };
  }).filter((plant) => plant.days.length);
}

function entsoeDate(value) {
  return value.toISOString().slice(0, 16).replace(/[-T:]/g, "");
}

async function requestEntsoe(token, params) {
  const url = new URL(ENTSOE_ENDPOINT);
  url.searchParams.set("securityToken", token);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, {
      headers: { Accept: "application/xml, text/xml", "User-Agent": "pasztra-tech-dashboard/1.0" },
    });
    const body = await response.text();
    const apiError = acknowledgementError(body);
    if (response.ok && !apiError) return body;
    const isTransient = response.status >= 500 || /unexpected error|timeout|temporar|I\/O error/i.test(apiError);
    if (isTransient && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1500));
      continue;
    }
    const range = `${params.periodStart ?? "?"}–${params.periodEnd ?? "?"}`;
    throw new Error(`ENTSO-E ${params.documentType ?? "?"} (${range}): HTTP ${response.status}${apiError ? ` · ${apiError}` : ""}`);
  }
  throw new Error("ENTSO-E: az újrapróbálások elfogytak.");
}

export async function fetchEntsoeBulgariaMix(token, start, end) {
  const common = {
    processType: "A16",
    periodStart: entsoeDate(start),
    periodEnd: entsoeDate(end),
  };
  const [generationXml, loadXml] = await Promise.all([
    requestEntsoe(token, { ...common, documentType: "A75", in_Domain: BULGARIA_BIDDING_ZONE }),
    requestEntsoe(token, { ...common, documentType: "A65", outBiddingZone_Domain: BULGARIA_BIDDING_ZONE }),
  ]);
  const generation = parseEntsoeGeneration(generationXml);
  const load = parseEntsoeLoad(loadXml);
  const points = [];
  for (const [timestamp, values] of generation) {
    const demand = load.get(timestamp);
    const produced = mixKeys.reduce((sum, key) => sum + values[key], 0);
    if (!(produced > 0) || !(demand > 0)) continue;
    points.push({
      timestamp,
      ...Object.fromEntries(mixKeys.map((key) => [key, Math.round(values[key] * 10) / 10])),
      imports: Math.round(Math.max(0, demand - produced) * 10) / 10,
      load: Math.round(demand * 10) / 10,
      renewableSharePct: Math.round(values.renewable / produced * 1000) / 10,
    });
  }
  return points.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

export async function fetchEntsoeBulgariaPlants(token, start, end) {
  const xml = await requestEntsoe(token, {
    documentType: "A73",
    processType: "A16",
    in_Domain: BULGARIA_BIDDING_ZONE,
    periodStart: entsoeDate(start),
    periodEnd: entsoeDate(end),
  });
  return parseEntsoeGenerationUnits(xml);
}

export const entsoeMetadata = {
  license: "ENTSO-E Transparency Platform Terms of Use",
  sourceUrl: "https://transparency.entsoe.eu/",
  sourceName: "ENTSO-E Transparency Platform",
};
