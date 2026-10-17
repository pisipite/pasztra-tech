import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { translatePublishedArticle } from "../scripts/translate-news.mjs";

const news = {
  source: "live", updatedAt: "2026-10-15T10:00:00Z", sources: [{ id: "source", status: "online" }],
  items: [
    { id: "1", url: "https://example.com/one", title: "Първа новина", summary: "Първо описание", publishedAt: "2026-10-15T09:00:00Z" },
    { id: "2", url: "https://example.com/two", title: "Втора новина", summary: "Второ описание", publishedAt: "2026-10-15T08:00:00Z" },
  ],
};
const now = new Date("2026-10-16T09:00:00Z");
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "pasztra-translation-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "energy-news.json");
  await writeFile(file, JSON.stringify(news));
  await writeFile(join(root, "dashboard-today.json"), "unchanged measurements");
  return { root, file };
}

test("one translation makes only one Gemini call, changes only the selected article", async (t) => {
  const { root, file } = await fixture(t);
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push(String(url));
    assert.match(options.body, /Първа новина/);
    assert.doesNotMatch(options.body, /Втора новина/);
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(["Első hír", "Első leírás"]) }] } }] });
  };
  const result = await translatePublishedArticle({ file, now, requestedUrl: news.items[0].url, apiKey: "fixture", endpoint: "https://example.com/translate", fetcher });
  assert.deepEqual(calls, ["https://example.com/translate"]);
  assert.equal(result.items[0].titleHu, "Első hír");
  assert.deepEqual(result.items[1], news.items[1]);
  assert.deepEqual(result.sources, news.sources);
  assert.equal(result.updatedAt, news.updatedAt);
  assert.equal(result.translation.updatedAt, now.toISOString());
  assert.equal(await readFile(join(root, "dashboard-today.json"), "utf8"), "unchanged measurements");
  assert.deepEqual(JSON.parse(await readFile(file)), result);
});

test("a translated article needs no API call or additional collection", async (t) => {
  const { file } = await fixture(t);
  const data = structuredClone(news);
  Object.assign(data.items[0], { titleHu: "Első hír", summaryHu: "Leírás" });
  await writeFile(file, JSON.stringify(data));
  const result = await translatePublishedArticle({ file, now, requestedUrl: news.items[0].url, apiKey: "fixture", fetcher: () => { throw new Error("No call allowed"); } });
  assert.equal(result.translation.status, "translated");
  assert.deepEqual(result.items, data.items);
});

test("Gemini failure publishes a timestamped error without losing original text", async (t) => {
  const { file } = await fixture(t);
  const result = await translatePublishedArticle({ file, now, requestedUrl: news.items[0].url, apiKey: "fixture", fetcher: async () => Response.json({ error: { message: "Unavailable" } }, { status: 503 }) });
  assert.equal(result.translation.status, "error");
  assert.equal(result.translation.updatedAt, now.toISOString());
  assert.equal(result.updatedAt, news.updatedAt);
  assert.deepEqual(result.items, news.items);
});

test("missing key and missing article give an attributable result for the UI", async (t) => {
  const { file } = await fixture(t);
  const missingKey = await translatePublishedArticle({ file, now, requestedUrl: news.items[0].url, apiKey: "" });
  assert.equal(missingKey.translation.status, "not-configured");
  assert.equal(missingKey.translation.requestedUrl, news.items[0].url);
  const absent = await translatePublishedArticle({ file, now, requestedUrl: "https://example.com/gone", apiKey: "fixture" });
  assert.equal(absent.translation.status, "error");
  assert.deepEqual(absent.items, news.items);
});
