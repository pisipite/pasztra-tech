import { ERM_ZAPAD_SOURCE, NEWS_FEEDS } from "./data-sources/news-sources.mjs";

const solarPattern = /фотоволта|солар|слънчев(?:а|и|ата|ите)?\s+(?:енерг|панел|централ)|photovolta|solar/i;
const renewablePattern = /възобнов|\bВЕИ\b|зелена\s+енерг|вятър|ветро|водноелектр|хидроенерг|батери|съхранение\s+на\s+енерг|renewable/i;
const energyPattern = /енерги|електроенерг|електропренос|електроразпредел|\bЕСО\b|\bКЕВР\b|атомн|ядрен|\bАЕЦ\b|\bТЕЦ\b|въглищ|ток(?:а|ът)?\b|electricity|power grid/i;
const bulgariaPattern = /българ|\bЕСО\b|\bКЕВР\b|козлодуй|марица|софия|пловдив|варна|бургас|стара\s+загора|румъния[^.]{0,80}българ/i;

function decodeXml(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanText(value = "") {
  return decodeXml(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstTag(block, names) {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
    if (match) return cleanText(match[1]);
  }
  return "";
}

function itemLink(block, baseUrl) {
  const atomLink = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i)?.[1];
  const value = decodeXml(atomLink || firstTag(block, ["link", "guid"]));
  if (!value) return "";
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return "";
  }
}

function trimSummary(value, maxLength = 260) {
  const text = cleanText(value);
  if (text.length <= maxLength) return text;
  const clipped = text.slice(0, maxLength + 1);
  const boundary = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf(" "));
  return `${clipped.slice(0, boundary > maxLength * .62 ? boundary : maxLength).trim()}…`;
}

function categoryFor(text) {
  if (solarPattern.test(text)) return "solar";
  if (renewablePattern.test(text)) return "renewables";
  return "energy";
}

function importanceFor(text, category) {
  let score = category === "solar" ? 4 : category === "renewables" ? 1 : 0;
  if (/електроразпредел|мреж|прекъсван|авари|цена|тариф|битов|домакин|батери|съхранение/i.test(text)) score += 2;
  if (bulgariaPattern.test(text)) score += 2;
  return score;
}

function stableId(sourceId, link, title) {
  const input = `${sourceId}|${link}|${title}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${sourceId}-${(hash >>> 0).toString(36)}`;
}

export function parseNewsFeed(xml, source) {
  const blocks = [...xml.matchAll(/<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi)].map((match) => match[1]);
  return blocks.flatMap((block) => {
    const title = firstTag(block, ["title"]);
    const link = itemLink(block, source.homeUrl);
    const rawSummary = firstTag(block, ["content:encoded", "description", "summary", "content"]);
    const summary = trimSummary(rawSummary);
    const text = `${title} ${summary}`;
    const publishedRaw = firstTag(block, ["pubDate", "published", "updated", "dc:date"]);
    const publishedAt = new Date(publishedRaw);
    if (!title || !link || !Number.isFinite(publishedAt.getTime()) || !energyPattern.test(text)) return [];
    const category = categoryFor(text);
    const importance = importanceFor(text, category);
    return [{
      id: stableId(source.id, link, title),
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.homeUrl,
      url: link,
      publishedAt: publishedAt.toISOString(),
      title,
      summary: summary || title,
      category,
      important: importance >= 4,
      importance,
      kind: "news",
      language: "bg",
    }];
  });
}

export function parseEconomicCategory(html, source) {
  const blocks = [...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)].map((match) => match[1]);
  return blocks.flatMap((block) => {
    const titleLink = block.match(/<a\b([^>]*class=["'][^"']*article__title-href[^"']*["'][^>]*)>([\s\S]*?)<\/a>/i);
    const href = titleLink?.[1].match(/href=["']([^"']+)["']/i)?.[1];
    const title = cleanText(titleLink?.[2] ?? titleLink?.[1].match(/title=["']([^"']+)["']/i)?.[1] ?? "");
    const date = block.match(/<time\b[^>]*datetime=["']([^"']+)["']/i)?.[1];
    const summary = trimSummary(block.match(/<p\b[^>]*class=["'][^"']*article__short-text[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "");
    if (!title || !href || !date) return [];
    const publishedAt = new Date(`${date.trim().replace(" ", "T")}:00+03:00`);
    if (!Number.isFinite(publishedAt.getTime())) return [];
    const url = new URL(decodeXml(href), source.homeUrl).href;
    const text = `${title} ${summary}`;
    if (!energyPattern.test(text)) return [];
    const category = categoryFor(text);
    const importance = importanceFor(text, category);
    return [{
      id: stableId(source.id, url, title),
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.homeUrl,
      url,
      publishedAt: publishedAt.toISOString(),
      title,
      summary: summary || title,
      category,
      important: importance >= 4,
      importance,
      kind: "news",
      language: "bg",
    }];
  });
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "user-agent": "Pasztra-Tech-Napfeny/1.0 (+https://github.com/pisipite/pasztra-tech)", ...options.headers },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

async function fetchFeed(source) {
  const xml = await fetchText(source.feedUrl, { headers: { accept: "application/rss+xml, application/xml, text/xml" } });
  const rssItems = parseNewsFeed(xml, source);
  if (!source.categoryUrl) return rssItems;
  try {
    const html = await fetchText(source.categoryUrl, { headers: { accept: "text/html" } });
    return [...rssItems, ...parseEconomicCategory(html, source)];
  } catch {
    return rssItems;
  }
}

function outageQuery() {
  const pod = process.env.ERM_ZAPAD_POD?.trim();
  const itn = process.env.ERM_ZAPAD_ITN?.trim();
  if (pod) return { action: "viewpod_plan", pod };
  if (itn) return { action: "viewitn_plan", itn };
  return null;
}

async function fetchErmZapad(now) {
  const query = outageQuery();
  if (!query) return { items: [], configured: false, checkedAt: now.toISOString(), sourceUrl: ERM_ZAPAD_SOURCE.homeUrl };
  const html = await fetchText(ERM_ZAPAD_SOURCE.queryUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(query),
  });
  const text = cleanText(html).replace(/\b\d{12,16}\b/g, "••••");
  const noOutage = /няма\s+планирани\s+прекъсвания/i.test(text);
  const hasOutage = !noOutage && /планирани\s+прекъсвания|прекъсване/i.test(text);
  return {
    configured: true,
    checkedAt: now.toISOString(),
    sourceUrl: ERM_ZAPAD_SOURCE.homeUrl,
    items: hasOutage ? [{
      id: `erm-zapad-${now.toISOString().slice(0, 10)}`,
      sourceId: ERM_ZAPAD_SOURCE.id,
      sourceName: ERM_ZAPAD_SOURCE.name,
      sourceUrl: ERM_ZAPAD_SOURCE.homeUrl,
      url: ERM_ZAPAD_SOURCE.homeUrl,
      publishedAt: now.toISOString(),
      title: "Tervezett áramszünet érintheti az otthont",
      summary: trimSummary(text, 300),
      category: "energy",
      important: true,
      importance: 10,
      kind: "outage",
      language: "bg",
    }] : [],
  };
}

export async function fetchEnergyNews(now = new Date()) {
  const settled = await Promise.allSettled([...NEWS_FEEDS.map(fetchFeed), fetchErmZapad(now)]);
  const feedResults = settled.slice(0, NEWS_FEEDS.length);
  const outageResult = settled.at(-1);
  const news = feedResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const outage = outageResult?.status === "fulfilled"
    ? outageResult.value
    : { items: [], configured: Boolean(outageQuery()), checkedAt: now.toISOString(), sourceUrl: ERM_ZAPAD_SOURCE.homeUrl };
  const seen = new Set();
  const items = [...outage.items, ...news]
    .sort((a, b) => b.importance - a.importance || Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .filter((item) => {
      const key = item.url.replace(/[?#].*$/, "").toLowerCase() || item.title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 30)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const successfulFeeds = NEWS_FEEDS.filter((_source, index) => feedResults[index]?.status === "fulfilled");
  if (!successfulFeeds.length && !outage.items.length) throw new Error("Egyik híradatforrás sem volt elérhető.");
  return {
    source: "live",
    updatedAt: now.toISOString(),
    items,
    sources: [
      ...NEWS_FEEDS.map(({ id, name, homeUrl, faviconUrl }, index) => ({
        id,
        name,
        url: homeUrl,
        faviconUrl,
        status: feedResults[index]?.status === "fulfilled" ? "online" : "offline",
        checkedAt: now.toISOString(),
        itemCount: items.filter((item) => item.sourceId === id).length,
      })),
      {
        id: ERM_ZAPAD_SOURCE.id,
        name: ERM_ZAPAD_SOURCE.name,
        url: ERM_ZAPAD_SOURCE.homeUrl,
        faviconUrl: ERM_ZAPAD_SOURCE.faviconUrl,
        status: outageResult?.status !== "fulfilled" ? "offline" : outage.configured ? "online" : "setup-required",
        checkedAt: outage.checkedAt,
        itemCount: outage.items.length,
      },
    ],
    outage: {
      configured: outage.configured,
      checkedAt: outage.checkedAt,
      alert: outage.items.length > 0,
      sourceUrl: outage.sourceUrl,
    },
  };
}

export const energyNewsSources = [...NEWS_FEEDS, ERM_ZAPAD_SOURCE];
