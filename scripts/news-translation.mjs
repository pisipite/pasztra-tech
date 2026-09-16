import { DATA_SOURCE_ENDPOINTS } from "./data-sources/endpoints.mjs";

const batchSize = 40;

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

async function translateTexts(texts, { apiKey, endpoint, fetcher }) {
  const translated = [];
  for (let start = 0; start < texts.length; start += batchSize) {
    const batch = texts.slice(start, start + batchSize);
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: {
        authorization: `DeepL-Auth-Key ${apiKey}`,
        "content-type": "application/json",
        "user-agent": "Pasztra-Tech-Napfeny/1.0 (+https://github.com/pisipite/pasztra-tech)",
      },
      body: JSON.stringify({ text: batch, source_lang: "BG", target_lang: "HU" }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`DeepL ${response.status} ${response.statusText}`);
    const payload = await response.json();
    if (!Array.isArray(payload.translations) || payload.translations.length !== batch.length) {
      throw new Error("A DeepL hiányos fordítási választ adott.");
    }
    translated.push(...payload.translations.map((translation) => translation.text));
  }
  return translated;
}

export async function addHungarianNewsTranslations(data, options = {}) {
  const apiKey = options.apiKey ?? process.env.DEEPL_API_KEY?.trim();
  if (!apiKey) {
    return { ...data, translation: { provider: "DeepL", status: "not-configured" } };
  }

  const fetcher = options.fetcher ?? fetch;
  const historyUrl = options.historyUrl ?? process.env.ENERGY_NEWS_HISTORY_URL?.trim();
  const endpoint = options.endpoint
    ?? process.env.DEEPL_API_URL?.trim()
    ?? (apiKey.endsWith(":fx") ? DATA_SOURCE_ENDPOINTS.deepl.freeApi : DATA_SOURCE_ENDPOINTS.deepl.proApi);
  const cached = await previousTranslations(historyUrl, fetcher);
  const items = data.items.map((item) => ({ ...item, ...cached.get(articleKey(item)) }));
  const pending = items.filter((item) => !item.titleHu || !item.summaryHu);
  if (!pending.length) {
    return { ...data, items, translation: { provider: "DeepL", status: "translated", translatedCount: items.length } };
  }

  try {
    const texts = pending.flatMap((item) => [item.title, item.summary]);
    const translations = await translateTexts(texts, { apiKey, endpoint, fetcher });
    const byKey = new Map(pending.map((item, index) => [articleKey(item), {
      titleHu: translations[index * 2],
      summaryHu: translations[index * 2 + 1],
    }]));
    const translatedItems = items.map((item) => ({ ...item, ...byKey.get(articleKey(item)) }));
    return { ...data, items: translatedItems, translation: { provider: "DeepL", status: "translated", translatedCount: translatedItems.length } };
  } catch (error) {
    console.error(`Hírfordítás: ${error.message}`);
    return { ...data, items, translation: { provider: "DeepL", status: "error", translatedCount: items.length - pending.length } };
  }
}
