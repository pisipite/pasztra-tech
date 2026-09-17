import assert from "node:assert/strict";
import test from "node:test";
import { addHungarianNewsTranslations } from "../scripts/news-translation.mjs";

const data = {
  source: "live",
  updatedAt: "2026-09-16T12:00:00.000Z",
  sources: [],
  items: [{
    id: "story-1",
    sourceId: "source",
    sourceName: "Forrás",
    sourceUrl: "https://example.com/",
    url: "https://example.com/story?ref=rss",
    publishedAt: "2026-09-16T11:00:00.000Z",
    title: "Енергийна новина",
    summary: "Нова електроенергийна мрежа.",
    category: "energy",
    important: false,
    kind: "news",
    language: "bg",
  }],
};

test("API-kulcs nélkül megtartja az eredeti bolgár hírt", async () => {
  const result = await addHungarianNewsTranslations(data, { apiKey: "" });
  assert.equal(result.translation.status, "not-configured");
  assert.equal(result.items[0].titleHu, undefined);
});

test("a korábbi publikus fordítást API-hívás nélkül újrahasználja", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return new Response(JSON.stringify({ items: [{ ...data.items[0], titleHu: "Energetikai hír", summaryHu: "Új villamosenergia-hálózat." }] }), { status: 200 });
  };
  const result = await addHungarianNewsTranslations(data, { apiKey: "secret", historyUrl: "https://example.com/history.json", fetcher });
  assert.equal(calls, 1);
  assert.equal(result.translation.status, "translated");
  assert.equal(result.items[0].titleHu, "Energetikai hír");
});

test("az új címeket és ajánlókat egy strukturált Gemini-kérésben fordítja le", async () => {
  const fetcher = async (_url, options) => {
    assert.equal(options.headers["x-goog-api-key"], "secret");
    const request = JSON.parse(options.body);
    assert.match(request.contents[0].parts[0].text, /Енергийна новина/);
    assert.equal(request.generationConfig.responseMimeType, "application/json");
    assert.deepEqual(request.generationConfig.responseSchema, { type: "array", items: { type: "string" } });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(["Energetikai hír", "Új villamosenergia-hálózat."]) }] } }] }), { status: 200 });
  };
  const result = await addHungarianNewsTranslations(data, { apiKey: "secret", historyUrl: "", endpoint: "https://example.com/translate", fetcher });
  assert.equal(result.items[0].titleHu, "Energetikai hír");
  assert.equal(result.items[0].summaryHu, "Új villamosenergia-hálózat.");
  assert.equal(result.translation.provider, "Google Gemini");
});
