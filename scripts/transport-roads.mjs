import { BORDER_CROSSINGS, MVR_BORDER_INDEX, ROAD_INCIDENT_BOXES, TOMTOM_INCIDENT_URL } from "./transport-sources.mjs";
import { pointInCounties } from "./transport-geo.mjs";

const months = { януари: 1, февруари: 2, март: 3, април: 4, май: 5, юни: 6, юли: 7, август: 8, септември: 9, октомври: 10, ноември: 11, декември: 12 };
const incidentKinds = new Set(["accident", "jam", "laneClosed", "roadClosed", "roadWorks", "flooding", "ice", "fog", "dangerousConditions", "brokenDownVehicle", "rain", "wind"]);

function decodeHtml(value) {
  return value.replace(/<[^>]*>/g, " ")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_match, code) => String.fromCodePoint(code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code)))
    .replace(/&(?:nbsp|ndash|mdash|bdquo|ldquo|rdquo|quot|amp);/gi, (entity) => ({
      "&nbsp;": " ", "&ndash;": "–", "&mdash;": "—", "&bdquo;": "„", "&ldquo;": "“", "&rdquo;": "”", "&quot;": '"', "&amp;": "&",
    })[entity.toLowerCase()] ?? entity)
    .replace(/\s+/g, " ").trim();
}

export function findLatestBorderArticle(html) {
  for (const match of html.matchAll(/<a\s+href="([^"]+)"\s+class="card__title"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const title = decodeHtml(match[2]);
    if (!/(?:Трафикът на българските гранични|Информация от ГДГП за трафика на българските)/i.test(title)) continue;
    const url = new URL(match[1], MVR_BORDER_INDEX);
    if (url.hostname === "www.mvr.bg" || url.hostname === "mvr.bg") return url.href;
  }
  throw new Error("A határrendészet legújabb jelentése nem található.");
}

function reportDate(html) {
  const header = html.match(/<div class="page-content__header">([\s\S]*?)<\/div>/i)?.[1] ?? "";
  const text = decodeHtml(header);
  const match = text.match(/(\d{1,2})\s+([а-я]+)\s+(20\d{2})/i);
  const month = match && months[match[2].toLowerCase()];
  if (!match || !month) throw new Error("A határjelentés dátuma nem olvasható.");
  return `${match[3]}-${String(month).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function countrySections(html) {
  const content = html.match(/<div class="page-content">([\s\S]*?)<\/div>/i)?.[1] ?? "";
  const paragraphs = [...content.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => decodeHtml(match[1])).filter(Boolean);
  const sections = { greece: [], "north-macedonia": [] };
  let active = null;
  for (const paragraph of paragraphs) {
    if (/^Границата\s+с\s/i.test(paragraph)) {
      active = /Гърция/i.test(paragraph) ? "greece" : /Северна Македония/i.test(paragraph) ? "north-macedonia" : null;
    } else if (active) sections[active].push(paragraph);
  }
  return sections;
}

export function normalizeMvrBorders(html, articleUrl, fetchedAt = new Date().toISOString()) {
  const reportedOn = reportDate(html);
  const sections = countrySections(html);
  const borders = BORDER_CROSSINGS.map((crossing) => {
    const paragraphs = sections[crossing.country];
    const named = paragraphs.filter((line) => line.includes(crossing.search));
    const general = paragraphs.find((line) => /всички\s+гранични|всички\s+преходи/i.test(line)) ?? "";
    const relevant = [...named, general].join(" ").toLowerCase();
    const restricted = /огранич|затвор|преустанов|спрян/.test(relevant);
    const busy = /интензив|затруднен|струпван|опашк/.test(relevant);
    const normal = /нормален|нормално/.test(general.toLowerCase());
    const status = restricted ? "restricted" : busy ? "busy" : normal ? "normal" : "unknown";
    const special = named.find((line) => /огранич|затвор|преустанов|спрян|интензив|затруднен|струпван|опашк/i.test(line));
    const description = special ?? (status === "normal" ? "A határrendészet normál forgalmat közöl ezen a határon." : "Az átkelőre nincs külön forgalmi minősítés a jelentésben.");
    return { id: crossing.id, name: crossing.name, country: crossing.country, latitude: crossing.latitude, longitude: crossing.longitude, status, description, reportedOn, sourceUrl: articleUrl };
  });
  const ageDays = (Date.parse(fetchedAt) - Date.parse(`${reportedOn}T00:00:00Z`)) / 86_400_000;
  return {
    borders,
    source: { status: ageDays >= -1 && ageDays < 2 ? "ok" : "stale", name: "Bolgár határrendészet · MVR", updatedAt: fetchedAt, message: `${reportedOn}-i közlés; nem mért várakozási idő.`, url: articleUrl },
  };
}

function incidentPoints(geometry) {
  if (geometry?.type === "Point" && Array.isArray(geometry.coordinates)) return [geometry.coordinates];
  if (geometry?.type === "LineString" && Array.isArray(geometry.coordinates)) return geometry.coordinates;
  return [];
}

export function normalizeTomTomIncidents(payload, counties, fetchedAt = new Date().toISOString()) {
  if (!Array.isArray(payload?.incidents)) throw new Error("Érvénytelen TomTom közúti válasz.");
  return payload.incidents.flatMap((feature) => {
    const properties = feature?.properties;
    const points = incidentPoints(feature?.geometry).filter((pair) => Array.isArray(pair) && Number.isFinite(pair[0]) && Number.isFinite(pair[1]));
    if (!properties?.id || !points.length || !points.some(([lon, lat]) => pointInCounties(lon, lat, counties))) return [];
    const middle = points.find(([lon, lat]) => pointInCounties(lon, lat, counties)) ?? points[Math.floor(points.length / 2)];
    const category = incidentKinds.has(properties.iconCategory) ? properties.iconCategory : "unknown";
    const roadName = Array.isArray(properties.roadNumbers) ? properties.roadNumbers.filter((value) => typeof value === "string").slice(0, 2).join(" / ") : "";
    const fromTo = [properties.from, properties.to].filter((value) => typeof value === "string" && value.trim()).join(" → ");
    const description = Array.isArray(properties.events) ? properties.events.map((event) => event?.description).filter((value) => typeof value === "string" && value.trim()).join(" · ") : "";
    const delaySeconds = Number(properties.delayInSeconds);
    const step = Math.max(1, Math.ceil(points.length / 350));
    const path = feature.geometry.type === "LineString" ? points.filter((_point, index) => index % step === 0 || index === points.length - 1).map(([lon, lat]) => [lat, lon]) : undefined;
    return [{
      id: `tomtom-${properties.id}`, title: [roadName, fromTo].filter(Boolean).join(" · ") || description || "Közúti esemény",
      latitude: middle[1], longitude: middle[0], category, description,
      delayMinutes: Number.isFinite(delaySeconds) && delaySeconds > 0 ? Math.round(delaySeconds / 60) : null,
      updatedAt: typeof properties.lastReportTime === "string" ? properties.lastReportTime : fetchedAt,
      endAt: typeof properties.endTime === "string" ? properties.endTime : undefined,
      planned: properties.timeValidity === "future", path,
    }];
  });
}

export async function fetchMvrBorders(fetcher = fetch, fetchedAt = new Date().toISOString()) {
  const indexResponse = await fetcher(MVR_BORDER_INDEX, { signal: AbortSignal.timeout(15_000) });
  if (!indexResponse.ok) throw new Error(`MVR index HTTP ${indexResponse.status}`);
  const articleUrl = findLatestBorderArticle(await indexResponse.text());
  const articleResponse = await fetcher(articleUrl, { signal: AbortSignal.timeout(15_000) });
  if (!articleResponse.ok) throw new Error(`MVR cikk HTTP ${articleResponse.status}`);
  return normalizeMvrBorders(await articleResponse.text(), articleUrl, fetchedAt);
}

export async function fetchTomTomIncidents(key, counties, fetcher = fetch, fetchedAt = new Date().toISOString()) {
  if (!key) throw new Error("Nincs TOMTOM_API_KEY beállítva.");
  const responses = await Promise.all(ROAD_INCIDENT_BOXES.map(async (box) => {
    const url = new URL(TOMTOM_INCIDENT_URL);
    url.searchParams.set("apiVersion", "2");
    url.searchParams.set("bbox", box.join(","));
    url.searchParams.set("timeValidity", "present,future");
    const response = await fetcher(url, { headers: { "TomTom-Api-Key": key, Attributes: "incidents(type,geometry(type,coordinates),properties(*))", "Accept-Language": "hu-HU", Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`TomTom HTTP ${response.status}`);
    return normalizeTomTomIncidents(await response.json(), counties, fetchedAt);
  }));
  return [...new Map(responses.flat().map((event) => [event.id, event])).values()];
}
