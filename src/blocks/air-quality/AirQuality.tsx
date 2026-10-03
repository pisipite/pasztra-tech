import { useEffect, useMemo, useState } from "react";
import { BackToTop } from "../../components/BackToTop";
import { DATA_FILES } from "../../config/dataFiles";
import { dataFileUrl } from "../../dashboardApi";
import { dateInputValue, isCurrentPeriod, periodLabel } from "../../dateUtils";
import { usePeriodSelection } from "../../usePeriodSelection";
import type { PeriodKey } from "../../types";
import { concentrationColor, projectPoint, summarizeStations, TOWNS } from "./airQualityData";
import type { AirQualityData, Pollutant } from "./types";
import "./airQuality.css";

const periods: { key: PeriodKey; label: string }[] = [
  { key: "day", label: "Nap" }, { key: "week", label: "Hét" }, { key: "month", label: "Hónap" },
  { key: "year", label: "Év" }, { key: "custom", label: "Egyéb" },
];
const number = new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 1 });
const time = new Intl.DateTimeFormat("hu-HU", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const valueLabel = (value: number | null) => value === null ? "Nincs adat" : `${number.format(value)} µg/m³`;
const dateLabel = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? time.format(new Date(value)) : "–";

function mapPath(points: number[][]) {
  return points.map(([lat, lon], index) => { const p = projectPoint(lat, lon); return `${index ? "L" : "M"}${p.x},${p.y}`; }).join(" ");
}

export function AirQuality({ endpoint, enabled, refreshSeconds }: { endpoint: string; enabled: boolean; refreshSeconds: number }) {
  const selection = usePeriodSelection();
  const { period, anchor, customStart, customEnd } = selection;
  const [pollutant, setPollutant] = useState<Pollutant>("pm25");
  const [data, setData] = useState<AirQualityData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState(() => Date.now());
  const [selectedTown, setSelectedTown] = useState<string>("dupnica");

  useEffect(() => {
    if (!enabled || !endpoint) return;
    const controller = new AbortController();
    let busy = false;
    const load = async () => {
      if (busy) return;
      busy = true;
      setClock(Date.now());
      try {
        const url = dataFileUrl(endpoint, DATA_FILES.airQuality);
        const response = await fetch(url, { cache: "no-cache", signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const next = await response.json() as AirQualityData;
        if (next.source !== "measured" || !Array.isArray(next.stations)
          || next.stations.some((station) => !Array.isArray(station.points))) throw new Error("Érvénytelen mérési adat.");
        if (!controller.signal.aborted) { setData(next); setError(""); }
      } catch {
        if (!controller.signal.aborted) setError("A mérések most nem tölthetők be. Ha van korábbi adat, az marad látható.");
      } finally {
        busy = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), Math.max(60, refreshSeconds || 300) * 1000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [endpoint, enabled, refreshSeconds]);

  const invalidRange = period === "custom" && (!customStart || !customEnd || customStart > customEnd);
  const stations = useMemo(() => summarizeStations(enabled && !invalidRange ? data?.stations ?? [] : [], pollutant, period, anchor, customStart, customEnd),
    [data, enabled, invalidRange, pollutant, period, anchor, customStart, customEnd]);
  const towns = TOWNS.map((town) => {
    const nearby = stations.filter((station) => station.townId === town.id && station.value !== null);
    return { ...town, stations: nearby, value: nearby.length ? nearby.reduce((sum, station) => sum + station.value!, 0) / nearby.length : null };
  });
  const selected = towns.find((town) => town.id === selectedTown) ?? towns[0];
  const selectedStations = stations.filter((station) => station.townId === selected.id);
  const measured = stations.filter((station) => station.value !== null);
  const first = measured.map((station) => station.first!).sort()[0];
  const last = measured.map((station) => station.last!).sort().at(-1);
  const allFirst = data?.stations.flatMap((station) => station.points.length ? [station.points[0].timestamp] : []).sort()[0];
  const lastAge = data?.updatedAt ? clock - Date.parse(data.updatedAt) : Infinity;
  const stale = data && (data.status !== "ok" || lastAge > 60 * 60_000);
  const pollutantLabel = pollutant === "pm25" ? "PM2,5" : "PM10";
  const mapLabel = `${pollutantLabel} időszakátlag a Rila környékén: ${periodLabel(period, anchor, customStart, customEnd)}`;

  return (
    <article className="air-quality card" id="szallo-por">
      <div className="section-header">
        <div className="section-header__lead">
          <div className="section-kicker"><p className="eyebrow">Szálló por · Rila és környéke</p><BackToTop /></div>
          <h2>A környék levegője</h2>
          <p>Közösségi pormérők · a kijelölt időszak átlaga</p>
        </div>
        <div className="period-control-stack section-header__tools">
          <div className="period-tabs" role="tablist" aria-label="Szálló por időszaka">
            {periods.map((item) => <button key={item.key} role="tab" aria-selected={period === item.key} className={period === item.key ? "active" : ""} onClick={() => selection.selectPeriod(item.key)}>{item.label}</button>)}
          </div>
          <div className="period-stepper">
            <button onClick={() => selection.step(-1)} aria-label="Előző szállópor-időszak">←</button>
            <strong>{periodLabel(period, anchor, customStart, customEnd)}</strong>
            <button onClick={() => selection.step(1)} disabled={period !== "custom" && isCurrentPeriod(period, anchor)} aria-label="Következő szállópor-időszak">→</button>
          </div>
          {period === "custom" && <div className="custom-range period-control-stack__custom">
            <label><span>Kezdőnap</span><input type="date" value={customStart} max={customEnd} onChange={(event) => selection.setCustomRange(event.target.value, customEnd)} /></label>
            <span aria-hidden="true">→</span>
            <label><span>Zárónap</span><input type="date" value={customEnd} min={customStart} max={dateInputValue(new Date())} onChange={(event) => selection.setCustomRange(customStart, event.target.value)} /></label>
          </div>}
        </div>
      </div>

      <div className="air-quality__toolbar">
        <div className="air-quality__pollutants" aria-label="Részecskeméret">
          <button type="button" aria-pressed={pollutant === "pm25"} onClick={() => setPollutant("pm25")}>PM2,5 <small>finom por</small></button>
          <button type="button" aria-pressed={pollutant === "pm10"} onClick={() => setPollutant("pm10")}>PM10 <small>szálló por</small></button>
        </div>
        <span className="air-quality__updated">Utolsó mérés: {enabled ? dateLabel(data?.updatedAt) : "–"}</span>
      </div>
      <div className="air-quality__status" role="status" aria-live="polite">
        {!enabled ? "A pormérések az élő adatkapcsolat bekapcsolása után érhetők el." : loading ? "Pormérések betöltése…" : error || (stale ? "A mérőhálózatból most nincs friss adat; a mentett mérések láthatók." : "")}
        {invalidRange ? " Adj meg érvényes kezdő- és zárónapot." : !loading && enabled && !measured.length ? " A kijelölt időszakban nincs elérhető mérés." : ""}
      </div>

      <div className="air-quality__layout">
        <div className="air-quality__map-scroll" tabIndex={0} role="region" aria-label="Sematikus szállópor-térkép; keskeny képernyőn vízszintesen görgethető">
          <div className="air-quality__map">
            <svg viewBox="0 0 1000 660" role="img" aria-label={mapLabel}>
              <title>{mapLabel}</title>
              <desc>A színes pontok a mérők megközelítő helyei. A településgombok a környező mérők átlagát mutatják; részletes adatok a térkép mellett.</desc>
              <defs><pattern id="air-map-grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0H0V50" fill="none" stroke="#d2d6c1" strokeWidth=".8" /></pattern></defs>
              <rect width="1000" height="660" fill="#e8e9d8" />
              <rect width="1000" height="660" fill="url(#air-map-grid)" />
              <path d={mapPath([[42.24,23.25],[42.285,23.35],[42.29,23.49],[42.25,23.62],[42.27,23.71],[42.16,23.76],[42.06,23.66],[41.96,23.56],[41.96,23.42],[42.04,23.34],[42.11,23.29],[42.16,23.22]]) + " Z"} className="air-quality__mountain" />
              <path d={mapPath([[42.20,23.28],[42.245,23.39],[42.24,23.50],[42.18,23.64],[42.09,23.64],[42.035,23.54],[42.025,23.44],[42.10,23.35],[42.20,23.28]])} className="air-quality__contour" />
              <path d={mapPath([[42.17,23.33],[42.215,23.43],[42.19,23.55],[42.12,23.58],[42.07,23.50],[42.11,23.40]])} className="air-quality__contour" />
              <path d={mapPath([[42.40,23.13],[42.266,23.117],[42.22,23.06],[42.153,23.001],[42.06,23.04],[42.011,23.098],[41.90,23.12]])} className="air-quality__road" />
              <path d={mapPath([[42.266,23.117],[42.289,23.263],[42.34,23.38],[42.337,23.553],[42.31,23.765]])} className="air-quality__road" />
              <path d={mapPath([[42.337,23.553],[42.266,23.607]])} className="air-quality__road" />
              <path d={mapPath([[42.153,23.001],[42.134,23.133],[42.129,23.25],[42.134,23.34]])} className="air-quality__river" />
              <text x="568" y="369" textAnchor="middle" className="air-quality__rila">RILA</text>
              <text x="568" y="393" textAnchor="middle" className="air-quality__region-label">HEGYSÉG</text>
              <g className="air-quality__landmark"><circle cx={projectPoint(42.129,23.25).x} cy={projectPoint(42.129,23.25).y} r="4" /><text x={projectPoint(42.129,23.25).x} y={projectPoint(42.129,23.25).y + 22} textAnchor="middle">Pasztra</text></g>
              <g className="air-quality__landmark"><path d={`M${projectPoint(42.179,23.585).x},${projectPoint(42.179,23.585).y - 6}l-5,10h10Z`} /><text x={projectPoint(42.179,23.585).x + 11} y={projectPoint(42.179,23.585).y + 28}>Muszala · 2925 m</text></g>
              <text x="36" y="40" className="air-quality__compass">↑ É</text>
              <text x="36" y="634" className="air-quality__map-caption">Sematikus térkép · pontok: közösségi mérők</text>
              {stations.map((station) => { const p = projectPoint(station.latitude, station.longitude); return <circle key={station.id} cx={p.x} cy={p.y} r="6" fill={concentrationColor(station.value, pollutant)} stroke="#173f35" strokeWidth="1.5"><title>Mérő #{station.id}: {valueLabel(station.value)}</title></circle>; })}
            </svg>
            {towns.map((town) => { const p = projectPoint(town.latitude, town.longitude); return (
              <button key={town.id} className={`air-quality__town air-quality__town--${town.id}${selected.id === town.id ? " is-selected" : ""}`} style={{ left: `${p.x / 10}%`, top: `${p.y / 6.6}%`, borderColor: concentrationColor(town.value, pollutant) }} type="button" aria-pressed={selected.id === town.id} aria-label={`${town.name} környéke: ${valueLabel(town.value)}; részletes mérések`} onClick={() => setSelectedTown(town.id)}>
                <strong>{town.name}</strong><span>{valueLabel(town.value)}</span>
              </button>
            ); })}
          </div>
        </div>
        <aside className="air-quality__detail" aria-label="Kiválasztott település pormérései">
          <p className="eyebrow">{pollutantLabel} · időszakátlag</p>
          <h3>{selected.name}<small>környéke</small></h3>
          <strong className="air-quality__value">{selected.value === null ? "–" : number.format(selected.value)}<small>µg/m³</small></strong>
          {selected.value === null ? <p>Nincs mérési adat a kijelölt időszakra. A hiányzó érték nem jelent tiszta levegőt.</p> : <p>{selected.stations.length} mérőállomás átlaga. Az állomások azonos súllyal szerepelnek.</p>}
          <div className="air-quality__stations">
            {selectedStations.map((station) => <div key={station.id}>
              <a href={`https://maps.sensor.community/#16/${station.latitude}/${station.longitude}`} target="_blank" rel="noreferrer">Mérő #{station.id}</a>
              <strong>{valueLabel(station.value)}</strong>
              <small>{station.count ? `${number.format(station.count)} minta · ${dateLabel(station.first)} – ${dateLabel(station.last)}` : "Ebben az időszakban nincs minta."}</small>
            </div>)}
          </div>
        </aside>
      </div>

      <div className="air-quality__legend"><span>Színskála · µg/m³</span>{(pollutant === "pm25" ? ["0–10", "10–20", "20–35", "35–50", "50+"] : ["0–20", "20–40", "40–60", "60–100", "100+"]).map((label, index) => <span key={label}><i style={{ background: ["#458785", "#b3a447", "#dd9237", "#bf633f", "#8f425c"][index] }} />{label}</span>)}<span><i style={{ background: "#89918b" }} />Nincs adat</span></div>
      <p className="air-quality__coverage">{measured.length ? `${measured.length} mérő · felhasznált minták: ${dateLabel(first)} – ${dateLabel(last)}.` : "Nincs átlagolható mérés."} {enabled && allFirst ? `Mentett előzmények kezdete: ${dateLabel(allFirst)}.` : ""} Az átlag csak a rendelkezésre álló, körülbelül 20 percenkénti mintákra vonatkozik; a lefedettség hiányos lehet.</p>
      <details className="air-quality__table-details"><summary>Az összes település értékei</summary><div className="air-quality__table-scroll"><table><thead><tr><th>Település környéke</th><th>{pollutantLabel} átlag</th><th>Adatot adó mérők</th></tr></thead><tbody>{towns.map((town) => <tr key={town.id}><th scope="row"><button onClick={() => setSelectedTown(town.id)}>{town.name}</button></th><td>{valueLabel(town.value)}</td><td>{town.stations.length}</td></tr>)}</tbody></table></div></details>
      <p className="air-quality__source">Forrás: <a href="https://sensor.community/" target="_blank" rel="noreferrer">Sensor.Community</a> / <a href="https://airbg.info/en/" target="_blank" rel="noreferrer">AirBG</a> nyilvános közösségi mérések és <a href="https://archive.sensor.community/" target="_blank" rel="noreferrer">mérési archívum</a> · <a href="https://opendatacommons.org/licenses/dbcl/1-0/" target="_blank" rel="noreferrer">DbCL v1.0</a>. A településértékek a hozzájuk legközelebbi környékbeli szenzorokból származnak. A hegyvidék egészére nem adnak mérést. A színskála koncentrációt jelöl, nem egészségügyi minősítést.</p>
    </article>
  );
}
