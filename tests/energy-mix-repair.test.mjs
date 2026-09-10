import assert from "node:assert/strict";
import test from "node:test";
import { repairNuclearDropouts } from "../scripts/energy-mix-repair.mjs";

test("a két valós nukleáris minta közötti egyórás nullát kijavítja", () => {
  const points = [
    { timestamp: "2026-09-03T12:00:00.000Z", nuclear: 1800, coal: 1000, gas: 100, hydro: 100, solar: 2000, wind: 100, other: 20, imports: 0, load: 4000, renewableSharePct: 44 },
    { timestamp: "2026-09-03T13:00:00.000Z", nuclear: 0, coal: 1000, gas: 100, hydro: 100, solar: 1800, wind: 100, other: 20, imports: 880, load: 4000, renewableSharePct: 64.2 },
    { timestamp: "2026-09-03T14:00:00.000Z", nuclear: 1820, coal: 1000, gas: 100, hydro: 100, solar: 1500, wind: 100, other: 20, imports: 0, load: 4000, renewableSharePct: 38 },
  ];
  const repaired = repairNuclearDropouts(points);
  assert.equal(repaired[1].nuclear, 1810);
  assert.equal(repaired[1].imports, 0);
  assert.ok(repaired[1].renewableSharePct < points[1].renewableSharePct);
});

test("a valódi hosszabb nullás időszakot nem módosítja", () => {
  const points = [
    { timestamp: "2026-09-03T12:00:00.000Z", nuclear: 1800 },
    { timestamp: "2026-09-03T13:00:00.000Z", nuclear: 0 },
    { timestamp: "2026-09-03T14:00:00.000Z", nuclear: 0 },
    { timestamp: "2026-09-03T15:00:00.000Z", nuclear: 1800 },
  ];
  const repaired = repairNuclearDropouts(points);
  assert.equal(repaired[1].nuclear, 0);
  assert.equal(repaired[2].nuclear, 0);
});
