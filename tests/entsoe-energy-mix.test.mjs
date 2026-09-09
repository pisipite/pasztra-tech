import assert from "node:assert/strict";
import test from "node:test";
import { parseEntsoeGeneration, parseEntsoeLoad } from "../scripts/entsoe-energy-mix.mjs";

const period = (values) => `<Period>
  <timeInterval><start>2026-09-09T10:00Z</start><end>2026-09-09T11:00Z</end></timeInterval>
  <resolution>PT15M</resolution>
  ${values.map((value, index) => `<Point><position>${index + 1}</position><quantity>${value}</quantity></Point>`).join("")}
</Period>`;

test("ENTSO-E termelési XML-ből órás átlagot és megújuló arányt készít", () => {
  const xml = `<GL_MarketDocument xmlns="urn:iec62325.351:tc57wg16:451-6:generationloaddocument:3:0">
    <TimeSeries><inBiddingZone_Domain.mRID>10YCA-BULGARIA-R</inBiddingZone_Domain.mRID><MktPSRType><psrType>B14</psrType></MktPSRType>${period([1000, 1100, 1200, 1300])}</TimeSeries>
    <TimeSeries><inBiddingZone_Domain.mRID>10YCA-BULGARIA-R</inBiddingZone_Domain.mRID><MktPSRType><psrType>B16</psrType></MktPSRType>${period([0, 20, 40, 60])}</TimeSeries>
    <TimeSeries><outBiddingZone_Domain.mRID>10YCA-BULGARIA-R</outBiddingZone_Domain.mRID><MktPSRType><psrType>B10</psrType></MktPSRType>${period([500, 500, 500, 500])}</TimeSeries>
  </GL_MarketDocument>`;
  const point = parseEntsoeGeneration(xml).get("2026-09-09T10:00:00.000Z");
  assert.equal(point.nuclear, 1150);
  assert.equal(point.solar, 30);
  assert.equal(point.hydro, 0);
  assert.equal(point.renewable, 30);
});

test("ENTSO-E terhelési XML-ből órás átlagot készít", () => {
  const xml = `<GL_MarketDocument><TimeSeries>${period([3000, 3200, 3400, 3600])}</TimeSeries></GL_MarketDocument>`;
  assert.equal(parseEntsoeLoad(xml).get("2026-09-09T10:00:00.000Z"), 3300);
});

test("ENTSO-E visszautasításának szövegét hibaként adja tovább", () => {
  const xml = `<Acknowledgement_MarketDocument><Reason><code>999</code><text>No matching data found</text></Reason></Acknowledgement_MarketDocument>`;
  assert.throws(() => parseEntsoeLoad(xml), /No matching data found/);
});

