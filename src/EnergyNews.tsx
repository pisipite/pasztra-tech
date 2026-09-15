import { useMemo, useState } from "react";
import { BackToTop } from "./components/BackToTop";
import { formatTime } from "./formatUtils";
import type { EnergyNewsCategory, EnergyNewsData, EnergyNewsItem } from "./types";

type NewsView = "all" | "important";
type CategoryFilter = "all" | EnergyNewsCategory;

const categories: { key: CategoryFilter; label: string }[] = [
  { key: "all", label: "Mind" },
  { key: "solar", label: "Napelem" },
  { key: "energy", label: "Energetika" },
  { key: "renewables", label: "Megújulók" },
];

const categoryLabels: Record<EnergyNewsCategory, string> = {
  solar: "Napelem",
  energy: "Energetika",
  renewables: "Megújulók",
};

function newsDate(value: string) {
  return new Intl.DateTimeFormat("hu-HU", { year: "numeric", month: "long", day: "numeric" }).format(new Date(value));
}

function NewsCard({ item, lead }: { item: EnergyNewsItem; lead: boolean }) {
  return (
    <article className={`energy-news-card category-${item.category}${lead ? " is-lead" : ""}${item.kind === "outage" ? " is-outage" : ""}`}>
      <div className="energy-news-card__meta">
        <time dateTime={item.publishedAt}>{newsDate(item.publishedAt)}</time>
        <span aria-hidden="true">·</span>
        <a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.sourceName}</a>
      </div>
      <div className="energy-news-card__labels">
        <span>{categoryLabels[item.category]}</span>
        {item.important && <i>{item.kind === "outage" ? "Értesítés" : "Neked fontos"}</i>}
      </div>
      <h3><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a></h3>
      <p>{item.summary}</p>
      <a className="energy-news-card__link" href={item.url} target="_blank" rel="noreferrer">Cikk megnyitása <span aria-hidden="true">↗</span></a>
    </article>
  );
}

export function EnergyNews({ data }: { data: EnergyNewsData }) {
  const [view, setView] = useState<NewsView>("all");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [source, setSource] = useState("all");
  const items = useMemo(() => data.items.filter((item) => (
    (view === "all" || item.important)
    && (category === "all" || item.category === category)
    && (source === "all" || item.sourceId === source)
  )), [data.items, view, category, source]);

  return (
    <section className="energy-news card" id="hirek">
      <header className="section-header energy-news__head">
        <div className="section-header__lead">
          <div className="section-kicker"><p className="eyebrow">Bolgár sajtó · energia</p><BackToTop /></div>
          <h2>Hírek</h2>
          <p>Energetika, megújulók és napelemek a bolgár online sajtóból.</p>
        </div>
        <div className="energy-news__status">
          <span><i className={data.source === "live" ? "is-live" : ""} />{data.source === "live" ? "Élő hírfolyam" : "Mintaadat"}</span>
          <small>frissítve {formatTime(data.updatedAt)}</small>
        </div>
      </header>

      <div className="energy-news-controls" aria-label="Hírek szűrése">
        <div className="energy-news-controls__view" role="group" aria-label="Nézet">
          <span>Nézet</span>
          <button type="button" className={view === "all" ? "is-active" : ""} aria-pressed={view === "all"} onClick={() => setView("all")}>Összes</button>
          <button type="button" className={view === "important" ? "is-active" : ""} aria-pressed={view === "important"} onClick={() => setView("important")}>Neked fontos</button>
        </div>
        <div className="energy-news-controls__categories" role="group" aria-label="Kategória">
          {categories.map((item) => <button type="button" key={item.key} className={category === item.key ? "is-active" : ""} aria-pressed={category === item.key} onClick={() => setCategory(item.key)}>{item.label}</button>)}
        </div>
        <label className="energy-news-source">
          <span>Forrás</span>
          <select value={source} onChange={(event) => setSource(event.target.value)}>
            <option value="all">Minden forrás</option>
            {data.sources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
      </div>

      {data.outage?.alert && <a className="energy-news-outage" href={data.outage.sourceUrl} target="_blank" rel="noreferrer"><strong>ERM Zapad értesítés</strong><span>A tervezett áramszünet részletei a szolgáltató oldalán ellenőrizhetők.</span><i aria-hidden="true">→</i></a>}

      {items.length > 0
        ? <div className="energy-news-grid">{items.map((item, index) => <NewsCard item={item} lead={index === 0} key={item.id} />)}</div>
        : <div className="energy-news-empty"><strong>Nincs találat ebben a nézetben.</strong><span>Válassz másik kategóriát vagy forrást.</span></div>}

      <footer className="energy-news__foot">
        <span>A címek és ajánlók eredeti bolgár nyelven jelennek meg.</span>
        <a href={data.outage?.sourceUrl ?? "https://ermzapad.bg/bg/za-klienta/prekusvania/"} target="_blank" rel="noreferrer">ERM Zapad áramszünetek ↗</a>
      </footer>
    </section>
  );
}
