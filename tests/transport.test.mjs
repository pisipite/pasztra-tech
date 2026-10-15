import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { appendFlightTrail, isPlausibleFlightRoute, normalizeBdz, normalizeFlightRoute, normalizeOpenSky } from "../scripts/transport-collect.mjs";
import { pointInCounties } from "../scripts/transport-geo.mjs";
import { railwaysFromGtfs } from "../scripts/transport-railways.mjs";
import { trainRoutesFromGtfs } from "../scripts/transport-timetable.mjs";
import { findLatestBorderArticle, normalizeMvrBorders, normalizeTomTomIncidents, fetchTomTomIncidents } from "../scripts/transport-roads.mjs";

const counties = { features: [{ geometry: { type: "Polygon", coordinates: [[[22, 41], [24, 41], [24, 43], [22, 43], [22, 41]]] } }] };

test("az OpenSky repülőpozícióit valós időbélyeggel alakítja át", () => {
  const timestamp = 1_790_000_000;
  const row = ["abc123", " TEST123 ", "Bulgaria", timestamp - 15, timestamp - 3, 23.25, 42.13, 4500, false, 120, 85, 0, null, 4600];
  const data = normalizeOpenSky({ time: timestamp, states: [row] });
  assert.equal(data.aircraft.length, 1);
  assert.equal(data.aircraft[0].callsign, "TEST123");
  assert.equal(data.aircraft[0].speedKmh, 432);
  assert.equal(data.aircraft[0].altitudeM, 4600);
  assert.equal(data.aircraft[0].heading, 85);
  assert.equal(data.aircraft[0].seenAt, new Date((timestamp - 15) * 1000).toISOString());
  assert.equal(data.sources.aircraft.status, "ok");
  assert.equal(data.sources.trains.status, "unavailable");
});

test("a földön lévő, helyzet nélküli és régi repülő nem jelenik meg élőként", () => {
  const now = 1_790_000_000;
  const valid = ["valid", "OK", "", now - 10, now - 5, 23.1, 42.1, null, false];
  const ground = ["ground", "", "", now - 10, now - 5, 23.1, 42.1, null, true];
  const missing = ["missing", "", "", now - 10, now - 5, null, 42.1, null, false];
  const old = ["old", "", "", now - 121, now - 5, 23.1, 42.1, null, false];
  const data = normalizeOpenSky({ time: now, states: [valid, ground, missing, old] });
  assert.deepEqual(data.aircraft.map((plane) => plane.id), ["valid"]);
});

test("adat nélküli sikeres válasz nem generál kitalált repülőket", () => {
  assert.deepEqual(normalizeOpenSky({ time: 1_790_000_000, states: null }).aircraft, []);
  assert.throws(() => normalizeOpenSky({ states: [] }), /Érvénytelen/);
});

test("a járat indulási és érkezési helyét csak teljes útvonalból veszi át", () => {
  const airport = (city, longitude) => ({ name: `${city} Airport`, municipality: city, iata_code: city.slice(0, 3), latitude: 42, longitude });
  assert.equal(normalizeFlightRoute({ response: { flightroute: { origin: airport("Sofia", 23), destination: airport("Paris", 2) } } }).destination.city, "Paris");
  assert.equal(normalizeFlightRoute({ response: { flightroute: { origin: airport("Sofia", 23) } } }), null);
});

test("a járatszámhoz rendelt útvonalat elveti, ha a gép máshol vagy ellenkező irányban repül", () => {
  const beauvais = { latitude: 49.4544, longitude: 2.11278 };
  const seville = { latitude: 37.418, longitude: -5.89311 };
  const bulgaria = { latitude: 42.1751, longitude: 22.9467, heading: 333.57 };
  assert.equal(isPlausibleFlightRoute(bulgaria, { origin: beauvais, destination: seville }), false);
  const sofia = { latitude: 42.7, longitude: 23.3 };
  const vienna = { latitude: 48.1, longitude: 16.5 };
  assert.equal(isPlausibleFlightRoute({ latitude: 45.5, longitude: 20, heading: 320 }, { origin: sofia, destination: vienna }), true);
  assert.equal(isPlausibleFlightRoute({ latitude: 45.5, longitude: 20, heading: 140 }, { origin: sofia, destination: vienna }), false);
});

test("a térkép a régi hibás pillanatképet is szűri és a mért irány felé becsül", async () => {
  const source = await readFile(new URL("../src/blocks/transport/transportGeometry.ts", import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const { trustedFlightRoute, estimatedExit } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
  const badRoute = { origin: { latitude: 49.4544, longitude: 2.11278 }, destination: { latitude: 37.418, longitude: -5.89311 } };
  const plane = { latitude: 42.1751, longitude: 22.9467, heading: 333.57, route: badRoute };
  assert.equal(trustedFlightRoute(plane), null);
  const estimated = estimatedExit([plane.latitude, plane.longitude], [badRoute.destination.latitude, badRoute.destination.longitude], plane.heading);
  assert.ok(estimated[0] > plane.latitude && estimated[1] < plane.longitude, "Északnyugat felé folytatja, nem Sevilla felé.");
});

test("a mért repülőnyom csak ugyanazon járat friss pontjait köti össze", () => {
  const first = { callsign: "TEST1", latitude: 42, longitude: 23, seenAt: "2026-10-15T10:00:00Z" };
  const second = { ...first, latitude: 42.1, seenAt: "2026-10-15T10:05:00Z" };
  assert.equal(appendFlightTrail(first, second).length, 2);
  assert.equal(appendFlightTrail(first, { ...second, callsign: "OTHER" }).length, 1);
  assert.equal(appendFlightTrail(first, { ...second, seenAt: "2026-10-15T11:00:00Z" }).length, 1);
});

test("a BDZ-adatból csak a megyén belüli friss vonatok maradnak", () => {
  const entity = (id, longitude, timestamp) => ({ id, vehicle: { vehicle: { id, label: `Train ${id}` }, position: { latitude: 42, longitude }, timestamp } });
  const data = normalizeBdz({ header: { timestamp: 10000 }, entity: [entity("1", 23, 9990), entity("2", 25, 9990), entity("3", 23, 8000)] }, counties, new Date(10000 * 1000).toISOString());
  assert.deepEqual(data.trains.map((train) => train.label), ["Vonat 1"]);
  assert.equal(data.source.status, "ok");
  assert.equal(pointInCounties(25, 42, counties), false);
});

test("a GTFS vasúti alakzatból csak a megyén áthaladó vonalat tartja meg", () => {
  const shapes = "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence,shape_dist_traveled\na,42,22.5,1,\na,42,23,2,\na,42,23.5,3,\nb,44,25,1,\nb,44,26,2,";
  const stops = "stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon\n1,1,Állomás,,42,23\n2,2,Külső,,44,25";
  const result = railwaysFromGtfs(shapes, stops, counties);
  assert.equal(result.lines.length, 1);
  assert.deepEqual(result.stations.map((station) => station.name), ["Állomás"]);
});

test("a BDZ járatazonosítójához a menetrend első és utolsó állomását rendeli", () => {
  const stops = "stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon\nA,,София,,42,23\nB,,Дупница,,42,23\nC,,Благоевград,,42,23";
  const times = "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n5621-BV-20261015,20:00:00,20:00:00,B,2\n5621-BV-20261015,19:00:00,19:00:00,A,1\n5621-BV-20261015,21:00:00,21:00:00,C,3";
  assert.deepEqual(trainRoutesFromGtfs(stops, times)["5621-BV-20261015"], { origin: "София", destination: "Благоевград" });
});

test("a határjelentésből csak a hivatalos cikket választja és nem talál ki várakozási időt", () => {
  const index = '<a href="/other" class="card__title">Más hír</a><a href="/press/aktualno/93598" class="card__title">Трафикът на българските гранични контролно-пропускателни пунктове</a>';
  const url = findLatestBorderArticle(index);
  assert.equal(url, "https://www.mvr.bg/press/aktualno/93598");
  const article = `<div class="page-content__header"><small>15 Октомври 2026</small></div><div class="page-content">
    <p><strong>Границата с&nbsp;Гърция:</strong></p><p>Трафикът е нормален на всички гранични преходи.</p>
    <p><strong>Границата с Република Северна Македония:</strong></p><p>Трафикът е&nbsp;нормален на всички гранични контролно-пропускателни пунктове.</p>
    <p>Трафикът е интензивен на ГКПП "Гюешево".</p></div>`;
  const result = normalizeMvrBorders(article, url, "2026-10-15T14:00:00Z");
  assert.equal(result.borders.length, 5);
  assert.equal(result.borders.find((item) => item.id === "gyueshevo").status, "busy");
  assert.equal(result.borders.find((item) => item.id === "kulata").status, "normal");
  assert.equal(result.borders[0].reportedOn, "2026-10-15");
  assert.equal(result.source.status, "ok");
  assert.ok(!JSON.stringify(result).includes("waitMinutes"));
});

test("a TomTom-incidenseket megyehatárra szűri, útvonallal és késéssel", () => {
  const payload = { incidents: [
    { type: "Feature", geometry: { type: "LineString", coordinates: [[22.9, 42], [23, 42.1]] }, properties: { id: "a", iconCategory: "roadWorks", roadNumbers: ["I-1"], from: "A", to: "B", events: [{ description: "Útépítés" }], delayInSeconds: 420, timeValidity: "present" } },
    { type: "Feature", geometry: { type: "Point", coordinates: [25, 44] }, properties: { id: "b", iconCategory: "jam", events: [] } },
  ] };
  const result = normalizeTomTomIncidents(payload, counties, "2026-10-15T14:00:00Z");
  assert.equal(result.length, 1);
  assert.equal(result[0].category, "roadWorks");
  assert.equal(result[0].delayMinutes, 7);
  assert.deepEqual(result[0].path[0], [42, 22.9]);
  assert.throws(() => normalizeTomTomIncidents({}, counties), /Érvénytelen/);
});

test("a TomTom-kulcs csak kérésfejlécben szerepel, a három lekérési területet egyesíti", async () => {
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url: String(url), options });
    return { ok: true, json: async () => ({ incidents: [] }) };
  };
  assert.deepEqual(await fetchTomTomIncidents("titkos-tesztkulcs", counties, fetcher), []);
  assert.equal(requests.length, 3);
  assert.ok(requests.every(({ url, options }) => !url.includes("titkos-tesztkulcs") && options.headers["TomTom-Api-Key"] === "titkos-tesztkulcs" && options.headers["Accept-Language"] === "hu-HU"));
});
