import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGoveeTemperature, repairClimateHistory } from "../scripts/govee-temperature.mjs";

test("a 60 °F alatti Govee-érték is Celsiusra alakul", () => {
  assert.equal(normalizeGoveeTemperature(58.1), 14.5);
  assert.equal(normalizeGoveeTemperature(57.38), 14.1);
  assert.equal(normalizeGoveeTemperature(23.4, "Celsius"), 23.4);
});

test("a korábban Fahrenheitként eltárolt hideg mintákat javítja", () => {
  const history = [
    { timestamp: "2026-09-13T21:40:00Z", temperature: 15.7, humidity: 51.8 },
    { timestamp: "2026-09-13T23:40:00Z", temperature: 58.1, humidity: 53.2 },
    { timestamp: "2026-09-14T01:40:00Z", temperature: 55.94, humidity: 53.5 },
    { timestamp: "2026-09-14T07:05:00Z", temperature: 54.68, humidity: 55 },
  ];
  const repaired = repairClimateHistory(history);
  assert.deepEqual(repaired.map((sample) => sample.temperature), [15.7, 14.5, 13.3, 12.6]);
  assert.deepEqual(repaired.map((sample) => sample.humidity), history.map((sample) => sample.humidity));
  assert.deepEqual(repairClimateHistory(repaired), repaired);
});

test("egy valódi hőmérséklet-változást nem konvertál Fahrenheitből", () => {
  const history = [{ temperature: 34 }, { temperature: 42 }];
  assert.deepEqual(repairClimateHistory(history), history);
});
