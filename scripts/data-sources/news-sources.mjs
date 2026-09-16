// Adding or replacing a press source should normally require only one entry.
// `categoryUrl` is an optional HTML fallback for sources whose RSS feed is too
// short. The parser lives in energy-news.mjs and the public JSON stays stable.
export const NEWS_FEEDS = Object.freeze([
  {
    id: "economic",
    name: "Economic.bg",
    feedUrl: "https://www.economic.bg/rss/all.xml",
    categoryUrl: "https://www.economic.bg/bg/a/category/energetika",
    homeUrl: "https://www.economic.bg/",
    faviconUrl: "https://www.economic.bg/favicon.ico",
  },
  {
    id: "3e-news",
    name: "3eNews",
    feedUrl: "https://www.3e-news.net/rss/all.xml",
    homeUrl: "https://www.3e-news.net/",
    faviconUrl: "https://www.3e-news.net/favicon.ico",
  },
  {
    id: "energynews",
    name: "EnergyNews.bg",
    feedUrl: "https://energynews.bg/feed/",
    homeUrl: "https://energynews.bg/",
    faviconUrl: "https://energynews.bg/wp-content/uploads/2026/08/cropped-energynews-site-icon-512x512-1-32x32.jpg",
  },
  {
    id: "energymedia",
    name: "EnergyMedia",
    feedUrl: "https://energymedia.info/feed/",
    homeUrl: "https://energymedia.info/",
    faviconUrl: "https://energymedia.info/favicon.ico",
  },
  {
    id: "capital",
    name: "Capital.bg",
    feedUrl: "https://www.capital.bg/rss/",
    homeUrl: "https://www.capital.bg/",
    faviconUrl: "https://www.capital.bg/favicon.ico",
  },
  {
    id: "dnevnik",
    name: "Dnevnik.bg",
    feedUrl: "https://www.dnevnik.bg/rss/",
    homeUrl: "https://www.dnevnik.bg/",
    faviconUrl: "https://www.dnevnik.bg/favicon.ico",
  },
  {
    id: "mediapool",
    name: "Mediapool.bg",
    feedUrl: "https://www.mediapool.bg/rss",
    homeUrl: "https://www.mediapool.bg/",
    faviconUrl: "https://www.mediapool.bg/favicon.ico",
  },
]);

export const ERM_ZAPAD_SOURCE = Object.freeze({
  id: "erm-zapad",
  name: "ERM Zapad",
  homeUrl: "https://ermzapad.bg/bg/za-klienta/prekusvania/",
  queryUrl: "https://info.ermzapad.bg/webint/vok/avplan.php",
  faviconUrl: "https://ermzapad.bg/favicon.ico",
});
