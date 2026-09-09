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
    const point = exact.get(sample.timestamp) ?? Object.fromEntries(mixKeys.map((key) => [key, 0]));
    const group = psrGroups[sample.psrType];
    point[group] += sample.value;
    if (renewablePsrTypes.has(sample.psrType)) point.renewable = (point.renewable ?? 0) + sample.value;
    exact.set(sample.timestamp, point);
  }

  const hourly = new Map();
  for (const [timestamp, point] of exact) {
    const key = hourlyKey(timestamp);
    const group = hourly.get(key) ?? { count: 0, renewable: 0, ...Object.fromEntries(mixKeys.map((field) => [field, 0])) };
    for (const field of mixKeys) group[field] += point[field];
    group.renewable += point.renewable ?? 0;
    group.count += 1;
    hourly.set(key, group);
  }
  return new Map([...hourly].map(([timestamp, group]) => [timestamp, {
    ...Object.fromEntries(mixKeys.map((field) => [field, group[field] / group.count])),
    renewable: group.renewable / group.count,
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

export const entsoeMetadata = {
  license: "ENTSO-E Transparency Platform Terms of Use",
  sourceUrl: "https://transparency.entsoe.eu/",
  sourceName: "ENTSO-E Transparency Platform",
};
