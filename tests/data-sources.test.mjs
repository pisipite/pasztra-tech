import test from "node:test";
import assert from "node:assert/strict";
import { DATA_SOURCE_ENDPOINTS } from "../scripts/data-sources/endpoints.mjs";
import { ERM_ZAPAD_SOURCE, NEWS_FEEDS } from "../scripts/data-sources/news-sources.mjs";

test("az adatforrás-regiszter érvényes HTTPS végpontokat tartalmaz", () => {
  const urls = [
    DATA_SOURCE_ENDPOINTS.entsoe.api,
    DATA_SOURCE_ENDPOINTS.energyCharts.api,
    DATA_SOURCE_ENDPOINTS.openMeteo.forecastApi,
    DATA_SOURCE_ENDPOINTS.govee.devicesApi,
    DATA_SOURCE_ENDPOINTS.govee.stateApi,
    DATA_SOURCE_ENDPOINTS.sungrow.defaultHost,
  ];
  assert.ok(urls.every((url) => new URL(url).protocol === "https:"));
});

test("a hírforrások egy helyről cserélhetők és egyedi azonosítót használnak", () => {
  assert.equal(new Set(NEWS_FEEDS.map((source) => source.id)).size, NEWS_FEEDS.length);
  for (const source of NEWS_FEEDS) {
    assert.equal(new URL(source.feedUrl).protocol, "https:");
    assert.equal(new URL(source.homeUrl).protocol, "https:");
    assert.equal(new URL(source.faviconUrl).protocol, "https:");
  }
  assert.equal(new URL(ERM_ZAPAD_SOURCE.queryUrl).protocol, "https:");
});
