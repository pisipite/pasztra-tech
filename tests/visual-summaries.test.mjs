import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function importSource(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}
const { remainingForecast } = await importSource("../src/blocks/forecast/forecastSummary.ts");
const point = (hour, power) => ({ timestamp: `2026-10-24T${String(hour).padStart(2, "0")}:00:00Z`, expectedPowerKw: power });

test("remaining production excludes elapsed hours and clips the current hour", () => {
  const values = [point(10, 3), point(11, 2), point(12, 1)];
  const summary = remainingForecast(values, Date.parse("2026-10-24T11:30:00Z"), .25);
  assert.equal(summary.hours, 1.5);
  assert.equal(summary.energyKwh, 2);
  assert.equal(summary.surplusKwh, 1.625);
  assert.equal(summary.best.from, Date.parse("2026-10-24T11:30:00Z"));
});

test("forecast with no remaining valid interval is unknown, not measured zero", () => {
  const summary = remainingForecast([point(10, 3), { timestamp: "bad", expectedPowerKw: 10 }], Date.parse("2026-10-24T12:00:00Z"), .25);
  assert.equal(summary.hours, 0);
  assert.equal(summary.best, undefined);
});
