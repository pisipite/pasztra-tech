import assert from "node:assert/strict";
import test from "node:test";
import { mergeDashboard, mergeEnergyMix, retainNews } from "../scripts/retained-data.mjs";

const measuredAt = "2026-10-16T08:00:00.000Z";
const now = new Date("2026-10-16T09:00:00.000Z");
const previous = {
  source: "live", updatedAt: measuredAt,
  connections: { solar: { connected: true, updatedAt: measuredAt }, climate: { connected: true, updatedAt: measuredAt } },
  solar: { status: "online", todayKwh: 102.2, chart: [{ label: "10", value: 2 }], energyChart: [{ timestamp: measuredAt, pv: 2 }] },
  govee: { devices: [{ id: "real", temperatureC: 21, humidityPct: 51, updatedAt: measuredAt }], chart: [{ timestamp: measuredAt, temperature: 21, humidity: 51 }] },
  forecast: { updatedAt: measuredAt, days: [] },
};

test("failed sources retain real readings and original timestamps, not zero or demo values", () => {
  const result = mergeDashboard({ previous, now });
  assert.equal(result.updatedAt, measuredAt);
  assert.equal(result.refreshedAt, now.toISOString());
  assert.equal(result.solar.todayKwh, 102.2);
  assert.equal(result.solar.status, "warning");
  assert.deepEqual(result.govee, previous.govee);
  assert.deepEqual(result.forecast, previous.forecast);
  assert.deepEqual(result.connections.climate, { connected: false, stale: true, updatedAt: measuredAt });
  assert.deepEqual(result.warnings.map((item) => item.source), ["Sungrow", "Govee", "Előrejelzés"]);
  assert.ok(result.warnings.every((item) => item.updatedAt === measuredAt));
  assert.equal(previous.solar.status, "online");
});

test("a successful source replaces only its own block and clears its warning", () => {
  const govee = { devices: [{ temperatureC: 22, updatedAt: now.toISOString() }], chart: [] };
  const result = mergeDashboard({ previous, govee, now });
  assert.deepEqual(result.govee, govee);
  assert.equal(result.connections.climate.connected, true);
  assert.equal(result.connections.solar.updatedAt, measuredAt);
  assert.equal(result.solar.todayKwh, 102.2);
  assert.deepEqual(result.warnings.map((item) => item.source), ["Sungrow", "Előrejelzés"]);
});

test("repeated failures do not move the measurement timestamp forward", () => {
  const failed = mergeDashboard({ previous, now });
  const again = mergeDashboard({ previous: failed, now: new Date(now.getTime() + 60_000) });
  assert.equal(again.connections.climate.updatedAt, measuredAt);
  assert.equal(again.updatedAt, measuredAt);
  assert.notEqual(again.refreshedAt, failed.refreshedAt);
});

test("first-run failures never publish a generated example curve", () => {
  for (const old of [undefined, { ...previous, source: "demo" }]) {
    const result = mergeDashboard({ previous: old, now });
    assert.equal(result.source, "partial");
    assert.equal(result.solar.status, "offline");
    assert.deepEqual(result.solar.chart, []);
    assert.deepEqual(result.solar.energyChart, []);
    assert.deepEqual(result.govee, { devices: [], chart: [] });
    assert.equal(result.connections.solar.stale, false);
    assert.ok(result.warnings.every((item) => item.updatedAt === undefined));
  }
});

test("successful collection clears retained-source flags", () => {
  const result = mergeDashboard({ previous, solar: previous.solar, govee: previous.govee, forecast: previous.forecast, now });
  assert.equal(result.source, "live");
  assert.deepEqual(result.warnings, []);
  assert.equal(result.connections.solar.connected, true);
  assert.equal(result.connections.solar.stale, undefined);
});

test("real current counters survive a failure even without a historical curve", () => {
  const old = { ...previous, solar: { ...previous.solar, chart: [], energyChart: [] } };
  const result = mergeDashboard({ previous: old, now });
  assert.equal(result.solar.todayKwh, 102.2);
  assert.equal(result.connections.solar.stale, true);
});

test("country and house data fail independently without deleting one another", () => {
  const mix = { source: "live", updatedAt: measuredAt, points: [{ nuclear: 1900 }], household: { daily: [{ load: 102.2 }] } };
  const updated = mergeEnergyMix(mix, { source: "live", updatedAt: now.toISOString(), points: [{ nuclear: 1920 }] });
  assert.deepEqual(updated.household, mix.household);
  assert.equal(updated.stale, false);
  const retained = mergeEnergyMix(mix, null, { daily: [{ load: 103 }] });
  assert.equal(retained.updatedAt, measuredAt);
  assert.deepEqual(retained.points, mix.points);
  assert.equal(retained.stale, true);
  assert.equal(retained.household.daily[0].load, 103);
  assert.equal(mergeEnergyMix(null, null), null);
});

test("failed news collection preserves articles and translations but marks sources offline", () => {
  const news = { source: "live", updatedAt: measuredAt, items: [{ titleHu: "Magyar cím" }], sources: [{ status: "online" }, { status: "setup-required" }] };
  const result = retainNews(news, now);
  assert.equal(result.updatedAt, measuredAt);
  assert.deepEqual(result.items, news.items);
  assert.deepEqual(result.sources.map((item) => item.status), ["offline", "setup-required"]);
  assert.equal(result.sources[0].checkedAt, now.toISOString());
  assert.equal(news.sources[0].status, "online");
});
