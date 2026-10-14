import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("a menü és a tényleges blokkok ugyanabban a sorrendben vannak", async () => {
  const navigation = await readFile(new URL("../src/config/pageBlocks.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
  const blocks = [
    ["energia", "EnergyAnalytics"],
    ["elojelzes", "SolarForecast"],
    ["klima", "DashboardCards"],
    ["fogyasztasi-proba", "ConsumptionPlanner"],
    ["napallas", "SunHorizon"],
    ["szallo-por", "AirQuality"],
    ["hirek", "EnergyNews"],
    ["energiamix", "BulgariaEnergyMix"],
  ];
  for (let index = 1; index < blocks.length; index += 1) {
    const [previousId, previousComponent] = blocks[index - 1];
    const [currentId, currentComponent] = blocks[index];
    assert.ok(navigation.indexOf(`id: "${previousId}"`) < navigation.indexOf(`id: "${currentId}"`));
    assert.ok(page.indexOf(`<${previousComponent}`, page.indexOf("<main")) < page.indexOf(`<${currentComponent}`, page.indexOf("<main")));
  }
});
