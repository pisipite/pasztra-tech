import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { addCalendarDays, addCalendarMonths, calendarDate, dateKey, dateParts, dateTimeFormatter, dayFraction, dayTicks, endOfDay, parseLocalDateTime, startOfDay } from "../shared/timeZone.mjs";
import { parseEconomicCategory } from "../scripts/energy-news.mjs";

// Exercise the real frontend selectors/aggregators without a browser or build.
const moduleUrls = { "./timeZone": new URL("../shared/timeZone.mjs", import.meta.url).href };
async function importSource(name) {
  const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), "utf8");
  let { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  for (const [specifier, url] of Object.entries(moduleUrls)) outputText = outputText.replaceAll(`"${specifier}"`, JSON.stringify(url));
  const url = `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
  moduleUrls[`./${name}`] = url;
  return import(url);
}
const dates = await importSource("dateUtils");
const climate = await importSource("climateData");
const formats = await importSource("formatUtils");
const demo = await importSource("demoData");

test("all display and calendar helpers stay in Sofia regardless of the visitor/runner zone", () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ["UTC", "Europe/Budapest", "America/Los_Angeles", "Asia/Tokyo"]) {
      process.env.TZ = zone;
      const instant = new Date("2026-08-31T21:30:00Z");
      assert.equal(dateKey(instant), "2026-09-01");
      assert.equal(dates.dateInputValue(instant), "2026-09-01");
      assert.equal(formats.formatTime(instant.toISOString()), "00:30");
      assert.equal(formats.formatTime("2026-01-01T22:30:00Z"), "00:30");
      assert.match(dates.periodLabel("day", instant, "", ""), /szeptember 1/);
      assert.equal(dates.dateFromInput("2026-09-01").toISOString(), "2026-08-31T21:00:00.000Z");
      assert.equal(dates.dateFromInput("2026-01-01").toISOString(), "2025-12-31T22:00:00.000Z");
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("day/week/month/year/custom filters include the Bulgarian midnight, not UTC midnight", () => {
  const anchor = new Date("2026-09-01T12:00:00Z");
  for (const period of ["day", "month", "custom"]) {
    assert.equal(dates.timestampInPeriod("2026-08-31T21:00:00Z", period, anchor, "2026-09-01", "2026-09-01"), true);
    assert.equal(dates.timestampInPeriod("2026-08-31T20:59:59Z", period, anchor, "2026-09-01", "2026-09-01"), false);
  }
  assert.equal(dates.timestampInPeriod("2025-12-31T22:00:00Z", "year", anchor, "", ""), true);
  assert.equal(dates.timestampInPeriod("2025-12-31T21:59:59Z", "year", anchor, "", ""), false);
  assert.equal(dates.startOfWeek(anchor).toISOString(), "2026-08-30T21:00:00.000Z");
  assert.equal(dates.endOfWeek(anchor).toISOString(), "2026-09-06T20:59:59.999Z");
  assert.equal(dates.timestampInPeriod("2026-08-30T21:00:00Z", "week", anchor, "", ""), true);
  assert.equal(dates.isCurrentPeriod("month", anchor, new Date("2026-08-31T21:30:00Z")), true);
  assert.equal(dates.timestampInPeriod("invalid", "day", anchor, "", ""), false);
});

test("DST day boundaries, navigation and axis ticks handle 23-hour and 25-hour days", () => {
  for (const [date, hours] of [["2026-03-29", 23], ["2026-10-25", 25]]) {
    const start = dates.dateFromInput(date);
    const next = addCalendarDays(start, 1);
    assert.equal((next - start) / 3_600_000, hours);
    assert.equal(endOfDay(start).getTime() + 1, next.getTime());
    assert.equal(dates.dateFromInput(date, true).getTime() + 1, next.getTime());
    assert.equal(dateKey(addCalendarDays(next, -1)), date);
    const ticks = dayTicks(start);
    assert.equal(ticks[0].ratio, 0);
    assert.equal(ticks.at(-1).ratio, 1);
    const noon = parseLocalDateTime(`${date}T12:00:00`);
    assert.equal(ticks[4].ratio, dayFraction(noon));
  }
  assert.equal(dateTimeFormatter({ hour: "2-digit", minute: "2-digit" }).format(new Date("2026-03-29T01:00:00Z")), "04:00");
  const first = new Date("2026-10-25T00:30:00Z");
  const repeated = new Date("2026-10-25T01:30:00Z");
  assert.equal(dateParts(first).hour, 3);
  assert.equal(dateParts(repeated).hour, 3);
  assert.ok(dayFraction(repeated) > dayFraction(first));
});

test("calendar arithmetic clamps month ends and preserves Bulgarian wall time", () => {
  assert.equal(dateKey(addCalendarMonths(calendarDate(2026, 1, 31, 12), 1)), "2026-02-28");
  assert.equal(dateKey(addCalendarMonths(calendarDate(2024, 2, 29, 12), 12)), "2025-02-28");
  const next = addCalendarDays(calendarDate(2026, 3, 28, 12), 1);
  assert.equal(dateParts(next).hour, 12);
  assert.equal(next.toISOString(), "2026-03-29T09:00:00.000Z");
  assert.equal(parseLocalDateTime("2026-03-29 03:30").toISOString(), "2026-03-29T01:30:00.000Z");
  assert.equal(parseLocalDateTime("2026-10-25 03:30").toISOString(), "2026-10-25T00:30:00.000Z");
  assert.equal(parseLocalDateTime("2026-10-25T03:30:00+02:00").toISOString(), "2026-10-25T01:30:00.000Z");
  assert.equal(parseLocalDateTime("2026-10-25T12:30:00.123").getUTCMilliseconds(), 123);
});

test("climate daily and monthly buckets keep evening UTC samples in the next Bulgarian day", () => {
  const history = [
    { timestamp: "2026-08-31T20:55:00Z", temperature: 20, humidity: 40, label: "old" },
    { timestamp: "2026-08-31T21:05:00Z", temperature: 24, humidity: 60, label: "old" },
    { timestamp: "2026-09-01T01:00:00Z", temperature: 26, humidity: 70, label: "old" },
  ];
  const anchor = calendarDate(2026, 9, 1);
  const daily = climate.climatePointsForPeriod(history, "month", anchor, "", "");
  assert.equal(daily.length, 1);
  assert.equal(daily[0].temperature, 25);
  assert.equal(dateKey(daily[0].timestamp), "2026-09-01");
  const monthly = climate.climatePointsForPeriod(history, "year", anchor, "", "");
  assert.deepEqual(monthly.map((point) => point.temperature), [20, 25]);
});

test("zone-less Bulgarian news uses the correct winter offset as well as the summer one", () => {
  const source = { id: "economic", name: "Economic", homeUrl: "https://www.economic.bg/" };
  for (const [date, expected] of [["2026-01-15 12:30", "2026-01-15T10:30:00.000Z"], ["2026-08-15 12:30", "2026-08-15T09:30:00.000Z"]]) {
    const html = `<article><a class="article__title-href" href="/solar">Соларна енергия</a><time datetime="${date}"></time></article>`;
    assert.equal(parseEconomicCategory(html, source)[0].publishedAt, expected);
  }
});

test("demo forecast labels and timestamps describe the same Bulgarian day and hour", () => {
  const data = demo.makeDemoData("today");
  for (const day of data.forecast.days) {
    const start = startOfDay(parseLocalDateTime(day.date));
    assert.equal(day.points.length, (addCalendarDays(start, 1) - start) / 3_600_000);
    for (const point of day.points) {
      assert.equal(dateKey(point.timestamp), day.date);
      assert.equal(formats.formatTime(point.timestamp), point.label);
    }
  }
});

test("frontend date display cannot silently fall back to the browser time zone", async () => {
  async function check(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const url = new URL(item.name + (item.isDirectory() ? "/" : ""), directory);
      if (item.isDirectory()) await check(url);
      else if (/\.tsx?$/.test(item.name)) {
        const source = await readFile(url, "utf8");
        assert.doesNotMatch(source, /new Intl\.DateTimeFormat|\.toLocale(?:Date|Time)String|\.(?:get|set)(?:Hours|Minutes|FullYear|Month|Date|Day)\(/, url.pathname);
      }
    }
  }
  await check(new URL("../src/", import.meta.url));
});
