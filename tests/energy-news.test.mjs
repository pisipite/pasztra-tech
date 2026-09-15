import assert from "node:assert/strict";
import test from "node:test";
import { parseNewsFeed } from "../scripts/energy-news.mjs";

const source = { id: "test", name: "Teszt", homeUrl: "https://example.com", url: "https://example.com/feed" };

test("parseNewsFeed extracts and categorizes relevant RSS items", () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item>
      <title><![CDATA[Нови фотоволтаици и батерии в България]]></title>
      <link>https://example.com/solar</link>
      <pubDate>Tue, 15 Sep 2026 12:00:00 +0300</pubDate>
      <description><![CDATA[Проектът добавя слънчева енергия към мрежата.]]></description>
    </item>
    <item>
      <title>Спортна новина</title>
      <link>https://example.com/sport</link>
      <pubDate>Tue, 15 Sep 2026 13:00:00 +0300</pubDate>
      <description>Няма връзка с енергетиката.</description>
    </item>
  </channel></rss>`;
  const items = parseNewsFeed(xml, source);
  assert.equal(items.length, 1);
  assert.equal(items[0].category, "solar");
  assert.equal(items[0].important, true);
  assert.equal(items[0].sourceName, "Teszt");
  assert.match(items[0].summary, /слънчева енергия/);
});

test("parseNewsFeed accepts Atom links and renewable stories", () => {
  const xml = `<feed><entry>
    <title>Вятърна енергия и ново съхранение</title>
    <link href="https://example.com/wind" />
    <published>2026-09-14T09:00:00+03:00</published>
    <summary>Нова възобновяема мощност.</summary>
  </entry></feed>`;
  const [item] = parseNewsFeed(xml, source);
  assert.equal(item.url, "https://example.com/wind");
  assert.equal(item.category, "renewables");
});
