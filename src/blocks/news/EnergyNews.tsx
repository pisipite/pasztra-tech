import { useMemo, useState } from "react";
import { BackToTop } from "../../components/BackToTop";
import { formatTime } from "../../formatUtils";
import type { EnergyNewsData, EnergyNewsItem, EnergyNewsSource } from "../../types";
import {
  INITIAL_NEWS_LIMIT,
  NEWS_CATEGORIES,
  NEWS_CATEGORY_LABELS,
  NEWS_LOAD_STEP,
  NEWS_VIEWS,
  type CategoryFilter,
  type NewsView,
} from "./newsConfig";
import "./news.css";

function newsDate(value: string) {
  return new Intl.DateTimeFormat("hu-HU", { year: "numeric", month: "long", day: "numeric" }).format(new Date(value));
}

function FilterButton({ id, label, description, active, onClick }: { id: string; label: string; description: string; active: boolean; onClick: () => void }) {
  const tooltipId = `${id}-description`;
  return <button type="button" className={active ? "is-active" : ""} aria-pressed={active} aria-describedby={tooltipId} onClick={onClick}><span>{label}</span><span className="energy-news-filter-help" role="tooltip" id={tooltipId}>{description}</span></button>;
}

function NewsCard({ item, source, lead }: { item: EnergyNewsItem; source?: EnergyNewsSource; lead: boolean }) {
  return (
    <article className={`energy-news-card category-${item.category}${lead ? " is-lead" : ""}${item.kind === "outage" ? " is-outage" : ""}`}>
      <div className="energy-news-card__meta">
        <time dateTime={item.publishedAt}>{newsDate(item.publishedAt)}</time>
        <span aria-hidden="true">·</span>
        <a className="energy-news-card__source" href={item.sourceUrl} target="_blank" rel="noreferrer">
          {source?.faviconUrl && <img src={source.faviconUrl} alt="" width="16" height="16" loading="lazy" onError={(event) => { event.currentTarget.hidden = true; }} />}
          <span>{item.sourceName}</span>
        </a>
      </div>
      <div className="energy-news-card__labels">
        <span>{NEWS_CATEGORY_LABELS[item.category]}</span>
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
  const [sourceId, setSourceId] = useState("all");
  const [visibleCount, setVisibleCount] = useState(INITIAL_NEWS_LIMIT);
  const sourceById = useMemo(() => new Map(data.sources.map((source) => [source.id, source])), [data.sources]);
  const effectiveSourceId = sourceId === "all" || sourceById.has(sourceId) ? sourceId : "all";
  const items = useMemo(() => data.items.filter((item) => (
    (view === "all" || item.important)
    && (category === "all" || item.category === category)
    && (effectiveSourceId === "all" || item.sourceId === effectiveSourceId)
  )), [data.items, view, category, effectiveSourceId]);
  const selectedSource = effectiveSourceId === "all" ? undefined : sourceById.get(effectiveSourceId);
  const onlineSourceCount = data.sources.filter((source) => source.status === "online").length;
  const sourceHealthy = selectedSource ? selectedSource.status === "online" : onlineSourceCount === data.sources.length;
  const visibleItems = items.slice(0, visibleCount);
  const remainingCount = Math.max(0, items.length - visibleItems.length);

  function selectView(nextView: NewsView) {
    setView(nextView);
    setVisibleCount(INITIAL_NEWS_LIMIT);
  }

  function selectCategory(nextCategory: CategoryFilter) {
    setCategory(nextCategory);
    setVisibleCount(INITIAL_NEWS_LIMIT);
  }

  function selectSource(nextSourceId: string) {
    setSourceId(nextSourceId);
    setVisibleCount(INITIAL_NEWS_LIMIT);
  }

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
          {NEWS_VIEWS.map((item) => <FilterButton id={`news-view-${item.key}`} key={item.key} label={item.label} description={item.description} active={view === item.key} onClick={() => selectView(item.key)} />)}
        </div>
        <div className="energy-news-controls__categories" role="group" aria-label="Kategória">
          {NEWS_CATEGORIES.map((item) => <FilterButton id={`news-category-${item.key}`} key={item.key} label={item.label} description={item.description} active={category === item.key} onClick={() => selectCategory(item.key)} />)}
        </div>
        <label className="energy-news-source">
          <span>Forrás</span>
          <select value={effectiveSourceId} onChange={(event) => selectSource(event.target.value)}>
            <option value="all">{onlineSourceCount === data.sources.length ? "●" : "◐"} Minden forrás</option>
            {data.sources.map((item) => <option key={item.id} value={item.id}>{item.status === "online" ? "●" : "○"} {item.name}</option>)}
          </select>
          <small className={sourceHealthy ? "is-online" : "is-offline"}><i />{selectedSource ? (sourceHealthy ? "kapcsolat rendben" : "nem elérhető") : `${onlineSourceCount}/${data.sources.length} forrás elérhető`}</small>
        </label>
      </div>

      {data.outage?.alert && <a className="energy-news-outage" href={data.outage.sourceUrl} target="_blank" rel="noreferrer"><strong>ERM Zapad értesítés</strong><span>A tervezett áramszünet részletei a szolgáltató oldalán ellenőrizhetők.</span><i aria-hidden="true">→</i></a>}

      {items.length > 0
        ? <><div className="energy-news-grid">{visibleItems.map((item, index) => <NewsCard item={item} source={sourceById.get(item.sourceId)} lead={index === 0} key={item.id} />)}</div>{remainingCount > 0 && <button type="button" className="energy-news-load-more" onClick={() => setVisibleCount((current) => current + NEWS_LOAD_STEP)}>Továbbiak betöltése <span>+{Math.min(NEWS_LOAD_STEP, remainingCount)}</span></button>}</>
        : <div className="energy-news-empty"><strong>Nincs találat ebben a nézetben.</strong><span>Válassz másik kategóriát vagy forrást.</span></div>}

      <footer className="energy-news__foot">
        <span>A címek és ajánlók eredeti bolgár nyelven jelennek meg.</span>
        <a href={data.outage?.sourceUrl ?? "https://ermzapad.bg/bg/za-klienta/prekusvania/"} target="_blank" rel="noreferrer">ERM Zapad áramszünetek ↗</a>
      </footer>
    </section>
  );
}
