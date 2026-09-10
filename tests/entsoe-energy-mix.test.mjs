import assert from "node:assert/strict";
import test from "node:test";
import { parseEntsoeGeneration, parseEntsoeGenerationUnits, parseEntsoeLoad } from "../scripts/entsoe-energy-mix.mjs";

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

test("ENTSO-E erőművi XML-ből térképes napi összesítést készít", () => {
  const xml = `<GL_MarketDocument><TimeSeries>
    <MktPSRType><psrType>B14</psrType><PowerSystemResources><mRID>unit-5</mRID><name>Kozloduy NPP Unit 5</name></PowerSystemResources></MktPSRType>
    ${period([1000, 1100, 1200, 1300])}
  </TimeSeries></GL_MarketDocument>`;
  const [plant] = parseEntsoeGenerationUnits(xml);
  assert.equal(plant.id, "kozloduy");
  assert.equal(plant.days[0].energyMwh, 1150);
  assert.equal(plant.days[0].averageMw, 1150);
  assert.equal(plant.days[0].peakMw, 1300);
  assert.equal(plant.days[0].hourlyMw[13], 1150);
});

test("az EIC-kóddal közölt bolgár nukleáris egységet Kozlodujhoz rendeli", () => {
  const xml = `<GL_MarketDocument><TimeSeries>
    <MktPSRType><psrType>B14</psrType><PowerSystemResources><mRID>48W-UNIT-CODE</mRID></PowerSystemResources></MktPSRType>
    ${period([900, 900, 900, 900])}
  </TimeSeries></GL_MarketDocument>`;
  assert.equal(parseEntsoeGenerationUnits(xml)[0].id, "kozloduy");
});

test("az ENTSO-E bolgár erőműkódjait a megfelelő telephelyekhez rendeli", () => {
  const resources = [
    ["B02", "TPP_MI2_G1", "maritsa-east-2"],
    ["B02", "TPP_MI3_G2", "maritsa-east-3"],
    ["B02", "TPP_GALABOVO_G1", "aes-galabovo"],
    ["B02", "TPP_MARITSA_3_G1", "maritsa-3"],
    ["B05", "TPP_RUSE_G4", "ruse-east"],
  ];
  for (const [psrType, name, expected] of resources) {
    const xml = `<GL_MarketDocument><TimeSeries><MktPSRType><psrType>${psrType}</psrType><PowerSystemResources><name>${name}</name></PowerSystemResources></MktPSRType>${period([100, 100, 100, 100])}</TimeSeries></GL_MarketDocument>`;
    assert.equal(parseEntsoeGenerationUnits(xml)[0].id, expected);
  }
});

test("az egyórás hiányt interpolálja, a valódi nulla értéket megtartja", () => {
  const xml = `<GL_MarketDocument>
    <TimeSeries><inBiddingZone_Domain.mRID>10YCA-BULGARIA-R</inBiddingZone_Domain.mRID><MktPSRType><psrType>B14</psrType></MktPSRType><Period>
      <timeInterval><start>2026-09-09T10:00Z</start><end>2026-09-09T13:00Z</end></timeInterval><resolution>PT60M</resolution>
      <Point><position>1</position><quantity>1000</quantity></Point><Point><position>3</position><quantity>1200</quantity></Point>
    </Period></TimeSeries>
    <TimeSeries><inBiddingZone_Domain.mRID>10YCA-BULGARIA-R</inBiddingZone_Domain.mRID><MktPSRType><psrType>B16</psrType></MktPSRType><Period>
      <timeInterval><start>2026-09-09T10:00Z</start><end>2026-09-09T13:00Z</end></timeInterval><resolution>PT60M</resolution>
      <Point><position>1</position><quantity>10</quantity></Point><Point><position>2</position><quantity>0</quantity></Point><Point><position>3</position><quantity>20</quantity></Point>
    </Period></TimeSeries>
  </GL_MarketDocument>`;
  const parsed = parseEntsoeGeneration(xml);
  assert.equal(parsed.get("2026-09-09T11:00:00.000Z").nuclear, 1100);
  assert.equal(parsed.get("2026-09-09T11:00:00.000Z").solar, 0);
});

test("ENTSO-E visszautasításának szövegét hibaként adja tovább", () => {
  const xml = `<Acknowledgement_MarketDocument><Reason><code>999</code><text>No matching data found</text></Reason></Acknowledgement_MarketDocument>`;
  assert.throws(() => parseEntsoeLoad(xml), /No matching data found/);
});
