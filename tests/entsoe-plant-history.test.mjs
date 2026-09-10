import assert from "node:assert/strict";
import test from "node:test";
import { mergePlantHistory } from "../scripts/entsoe-plant-history.mjs";

function plant(day) {
  return { id: "kozloduy", name: "Kozloduj", type: "nuclear", latitude: 43.7, longitude: 23.7, days: [day] };
}

test("a két UTC-lekérésbe szakadt bolgár napot teljes nappá fűzi össze", () => {
  const morning = {
    date: "2026-08-18",
    hourlyMw: [...Array(3).fill(1000), ...Array(21).fill(0)],
    hourlyCoverage: [...Array(3).fill(1), ...Array(21).fill(0)],
    observedHours: 3,
  };
  const restOfDay = {
    date: "2026-08-18",
    hourlyMw: [...Array(3).fill(0), ...Array(21).fill(1000)],
    hourlyCoverage: [...Array(3).fill(0), ...Array(21).fill(1)],
    observedHours: 21,
  };
  const [result] = mergePlantHistory([], [[plant(morning)], [plant(restOfDay)]], "2026-01-01");
  assert.equal(result.days[0].observedHours, 24);
  assert.equal(result.days[0].energyMwh, 24000);
  assert.equal(result.days[0].averageMw, 1000);
});

test("a hiányos napot nem adja át a térképnek", () => {
  assert.deepEqual(mergePlantHistory([], [[plant({ date: "2026-08-18", hourlyMw: Array(24).fill(0), hourlyCoverage: Array(24).fill(0), observedHours: 3 })]], "2026-01-01"), []);
});
