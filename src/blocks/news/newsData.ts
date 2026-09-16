import type { EnergyNewsData, EnergyNewsItem } from "../../types";

export function makeDemoEnergyNews(): EnergyNewsData {
  const now = new Date();
  const checkedAt = now.toISOString();
  const sources = [
    { id: "economic", name: "Economic.bg", url: "https://www.economic.bg/", faviconUrl: "https://www.economic.bg/favicon.ico", status: "online" as const, checkedAt, itemCount: 1 },
    { id: "3e-news", name: "3eNews", url: "https://www.3e-news.net/", faviconUrl: "https://www.3e-news.net/favicon.ico", status: "online" as const, checkedAt, itemCount: 1 },
    { id: "energynews", name: "EnergyNews.bg", url: "https://energynews.bg/", faviconUrl: "https://energynews.bg/favicon.ico", status: "offline" as const, checkedAt, itemCount: 0 },
    { id: "energymedia", name: "EnergyMedia", url: "https://energymedia.info/", faviconUrl: "https://energymedia.info/favicon.ico", status: "online" as const, checkedAt, itemCount: 1 },
  ];
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
  const demo: Omit<EnergyNewsItem, "id" | "sourceUrl" | "kind" | "language">[] = [
    {
      sourceId: "economic", sourceName: "Economic.bg", publishedAt: hoursAgo(2),
      title: "Új napelemes kapacitások kapcsolódnak a bolgár hálózathoz",
      summary: "A bemutató nézet helyét az élő oldalon a bolgár forrásból érkező eredeti cím és rövid ajánló veszi át.",
      category: "solar", important: true,
      url: "https://www.economic.bg/",
    },
    {
      sourceId: "3e-news", sourceName: "3eNews", publishedAt: hoursAgo(7),
      title: "A hálózati rugalmasság került az energetikai egyeztetés középpontjába",
      summary: "Az országos energiarendszert és a háztartási termelést érintő hírek külön kiemelést kaphatnak.",
      category: "energy", important: false,
      url: "https://www.3e-news.net/",
    },
    {
      sourceId: "energymedia", sourceName: "EnergyMedia", publishedAt: hoursAgo(19),
      title: "Gyorsulhat a megújuló energia tárolásának fejlesztése",
      summary: "A hírdobozok az eredeti cikkhez vezetnek; a kategória és a forrás egyetlen sorból szűrhető.",
      category: "renewables", important: true,
      url: "https://energymedia.info/",
    },
  ];
  return {
    source: "demo",
    updatedAt: now.toISOString(),
    sources,
    items: demo.map((item, index) => ({
      ...item,
      id: `demo-${index}`,
      sourceUrl: sources.find((source) => source.id === item.sourceId)?.url ?? item.url,
      kind: "news",
      language: "bg",
    })),
    outage: { configured: false, checkedAt, alert: false, sourceUrl: "https://ermzapad.bg/bg/za-klienta/prekusvania/" },
  };
}
