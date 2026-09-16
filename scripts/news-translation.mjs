import { DATA_SOURCE_ENDPOINTS } from "./data-sources/endpoints.mjs";

const batchSize = 40;
const providerName = "Google Cloud Translation";

function articleKey(item) {
  return item.url.replace(/[?#].*$/, "").toLowerCase();
}

async function previousTranslations(historyUrl, fetcher) {
  if (!historyUrl) return new Map();
  try {
    const response = await fetcher(historyUrl, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return new Map();
    const previous = await response.json();
    return new Map((previous.items ?? [])
      .filter((item) => item.titleHu && item.summaryHu)
      .map((item) => [articleKey(item), { titleHu: item.titleHu, summaryHu: item.summaryHu }]));
  } catch {
    return new Map();
  }
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function authenticatedEndpoint(endpoint, apiKey) {
  const url = new URL(endpoint);
  url.searchParams.set("key", apiKey);
  return url.toString();
}

async function translateTexts(texts, { apiKey, endpoint, fetcher }) {
  const translated = [];
  for (let start = 0; start < texts.length; start += batchSize) {
    const batch = texts.slice(start, start + batchSize);
    const response = await fetcher(authenticatedEndpoint(endpoint, apiKey), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Pasztra-Tech-Napfeny/1.0 (+https://github.com/pisipite/pasztra-tech)",
      },
      body: JSON.stringify({ q: batch, source: "bg", target: "hu", format: "text" }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`${providerName} ${response.status} ${response.statusText}`);
    const payload = await response.json();
    const translations = payload.data?.translations;
    if (!Array.isArray(translations) || translations.length !== batch.length) {
      throw new Error("A Google Cloud Translation hiányos fordítási választ adott.");
    }
    translated.push(...translations.map((translation) => decodeHtmlEntities(translation.translatedText)));
  }
  return translated;
}

export async function addHungarianNewsTranslations(data, options = {}) {
  const apiKey = options.apiKey ?? process.env.GOOGLE_TRANSLATE_API_KEY?.trim();
  if (!apiKey) {
    return { ...data, translation: { provider: providerName, status: "not-configured" } };
  }

  const fetcher = options.fetcher ?? fetch;
  const historyUrl = options.historyUrl ?? process.env.ENERGY_NEWS_HISTORY_URL?.trim();
  const endpoint = options.endpoint
    ?? process.env.GOOGLE_TRANSLATE_API_URL?.trim()
    ?? DATA_SOURCE_ENDPOINTS.googleTranslate.basicApi;
  const cached = await previousTranslations(historyUrl, fetcher);
  const items = data.items.map((item) => ({ ...item, ...cached.get(articleKey(item)) }));
  const pending = items.filter((item) => !item.titleHu || !item.summaryHu);
  if (!pending.length) {
    return { ...data, items, translation: { provider: providerName, status: "translated", translatedCount: items.length } };
  }

  try {
    const texts = pending.flatMap((item) => [item.title, item.summary]);
    const translations = await translateTexts(texts, { apiKey, endpoint, fetcher });
    const byKey = new Map(pending.map((item, index) => [articleKey(item), {
      titleHu: translations[index * 2],
      summaryHu: translations[index * 2 + 1],
    }]));
    const translatedItems = items.map((item) => ({ ...item, ...byKey.get(articleKey(item)) }));
    return { ...data, items: translatedItems, translation: { provider: providerName, status: "translated", translatedCount: translatedItems.length } };
  } catch (error) {
    console.error(`Hírfordítás: ${error.message}`);
    return { ...data, items, translation: { provider: providerName, status: "error", translatedCount: items.length - pending.length } };
  }
}
