import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/blocks/planner/appliancePresets.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
const { APPLIANCE_PRESETS, findAppliancePreset, restoreApplianceSelection } = await import(moduleUrl);

test("appliance presets use the requested energy and duration", () => {
  assert.deepEqual(APPLIANCE_PRESETS.map(({ label, energyKwh, durationMinutes }) => [label, energyKwh, durationMinutes]), [
    ["Mosógép", 0.5, 120],
    ["Rezsó", 1.5, 30],
    ["Bojler", 2, 180],
  ]);
  assert.equal(findAppliancePreset("washer").energyKwh, 0.5);
  assert.equal(findAppliancePreset("hotplate").durationMinutes, 30);
  assert.equal(findAppliancePreset("unknown"), undefined);
});

test("restored selection stays custom if stored values no longer match the preset", () => {
  assert.equal(restoreApplianceSelection("boiler", { energyKwh: 2, durationMinutes: 180 }), "boiler");
  assert.equal(restoreApplianceSelection("boiler", { energyKwh: 2, durationMinutes: 120 }), "custom");
  assert.equal(restoreApplianceSelection("washer", { energyKwh: 1, durationMinutes: 120 }), "custom");
  assert.equal(restoreApplianceSelection(undefined, { energyKwh: 0.5, durationMinutes: 120 }), "custom");
  assert.equal(restoreApplianceSelection("custom", { energyKwh: 2, durationMinutes: 180 }), "custom");
});
