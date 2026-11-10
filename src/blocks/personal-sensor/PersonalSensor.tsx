import { Fragment, useCallback, useEffect, useMemo, useState, type PointerEvent } from "react";
import { BackToTop } from "../../components/BackToTop";
import { DATA_FILES } from "../../config/dataFiles";
import { dataFileUrl, fetchFreshJson } from "../../dashboardApi";
import { dateInputValue, isCurrentPeriod, periodLabel } from "../../dateUtils";
import { formatNumber } from "../../formatUtils";
import { observationSegments } from "../../observationQuality";
import { dateParts, dateTimeFormatter, dayTicks } from "../../timeZone";
import type { PeriodKey } from "../../types";
import { usePeriodSelection } from "../../usePeriodSelection";
import { localWeatherOutlook, recentSensorTrend, sensorChartData } from "./sensorData";
import { lastDailyParticulate, PARTICULATE_LIMITS, PARTICULATE_SOURCES, pm10DailyLimit, pm10LimitForDay, WHO_PM25_DAILY_GUIDELINE } from "./particulateReference";
import type { PersonalSensorData, SensorMetric } from "./types";
import "./personalSensor.css";

const METRICS: Array<{ key: SensorMetric; label: string; unit: string; color: string; decimals: number }> = [
  { key: "pm25", label: "PM2,5", unit: "µg/m³", color: "var(--personal-pm25)", decimals: 1 },
  { key: "pm10", label: "PM10", unit: "µg/m³", color: "var(--personal-pm10)", decimals: 1 },
  { key: "temperature", label: "Hőmérséklet", unit: "°C", color: "var(--personal-pm25)", decimals: 1 },
  { key: "humidity", label: "Páratartalom", unit: "%", color: "var(--personal-humidity)", decimals: 1 },
  { key: "pressure", label: "Légnyomás", unit: "hPa", color: "var(--personal-pressure)", decimals: 1 },
];
const EXPLANATIONS: Record<SensorMetric, string> = {
  pm25: "A legfeljebb 2,5 mikrométeres lebegő részecskék tömege egy köbméter levegőben. A szenzor tájékoztató mérést ad, nem hatósági minősítést.",
  pm10: "A legfeljebb 10 mikrométeres lebegő részecskék tömege egy köbméter levegőben. Ebbe a PM2,5 részecskék is beletartoznak, ezért a két értéket nem kell összeadni.",
  temperature: "A BME280 szenzor közelében mért levegő hőmérséklete. Az elhelyezés és a napsütés is befolyásolhatja az értéket.",
  humidity: "A levegő relatív páratartalma: azt mutatja, mennyire van közel a levegő a telítettséghez. A hőmérséklet változásával is módosulhat.",
  pressure: "A szenzor helyén mért légnyomás hektopascalban. Ez nem a tengerszintre átszámított időjárási érték.",
};
const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: "day", label: "Nap" }, { key: "week", label: "Hét" }, { key: "month", label: "Hónap" },
  { key: "year", label: "Év" }, { key: "custom", label: "Egyéb" },
];
const measuredTime = dateTimeFormatter({ month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const shortDate = dateTimeFormatter({ month: "short", day: "numeric" });
const fullDate = dateTimeFormatter({ year: "numeric", month: "short", day: "numeric" });
const safeTime = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? measuredTime.format(new Date(value)) : "—";

type Props = { endpoint: string; loading: boolean; refreshLabel: string; onRefresh: () => void };

export function PersonalSensor({ endpoint, loading, refreshLabel, onRefresh }: Props) {
  const selection = usePeriodSelection();
  const { period, anchor, customStart, customEnd } = selection;
  const [data, setData] = useState<PersonalSensorData | null>(null);
  const [selected, setSelected] = useState<SensorMetric>("pm25");
  const [openInfo, setOpenInfo] = useState<SensorMetric | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [clock, setClock] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const url = import.meta.env.DEV
        ? new URL(`${import.meta.env.BASE_URL}data/${DATA_FILES.personalSensor}`, window.location.href)
        : dataFileUrl(endpoint || "./data/dashboard-{range}.json", DATA_FILES.personalSensor);
      const next = await fetchFreshJson<PersonalSensorData>(url);
      if (typeof next.sensorId !== "string" || !Array.isArray(next.points)) throw new Error("Érvénytelen szenzoradat.");
      setData(next);
      setMessage("");
    } catch { setMessage("A saját szenzor adatai most nem érhetők el; az utolsó ismert értékek maradnak láthatók."); }
  }, [endpoint]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { setClock(Date.now()); void load(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const refresh = async () => {
    if (!import.meta.env.DEV) { onRefresh(); return; }
    setBusy(true);
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}__personal-sensor/refresh`, { method: "POST" });
      if (!response.ok) throw new Error("A helyi lekérdezés nem sikerült.");
      await load();
      setClock(Date.now());
    } catch { setMessage("A szenzor most nem frissíthető; az utolsó ismert értékek maradnak láthatók."); }
    finally { setBusy(false); }
  };

  const chart = useMemo(() => sensorChartData(data?.points ?? [], period, anchor, customStart, customEnd, clock), [data, period, anchor, customStart, customEnd, clock]);
  const dailyParticulate = useMemo(() => ({
    pm25: lastDailyParticulate(data?.points ?? [], "pm25", chart.start, chart.end, clock, data?.bucketMinutes ?? 10),
    pm10: lastDailyParticulate(data?.points ?? [], "pm10", chart.start, chart.end, clock, data?.bucketMinutes ?? 10),
  }), [data, chart.start, chart.end, clock]);
  const trends = useMemo(() => Object.fromEntries(METRICS.map((metric) => [metric.key,
    recentSensorTrend(data?.points ?? [], metric.key, data?.latest?.[metric.key], clock),
  ])) as Record<SensorMetric, ReturnType<typeof recentSensorTrend>>, [data, clock]);
  const weatherOutlook = useMemo(() => localWeatherOutlook(data?.points ?? [], data?.latest ?? {}, clock), [data, clock]);
  const visible = selected === "pm25" || selected === "pm10" ? METRICS.slice(0, 2) : METRICS.filter((metric) => metric.key === selected);
  const amounts = chart.data.flatMap((point) => visible.map((metric) => point[metric.key])).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const width = 1000, height = 285, left = 64, right = 24, top = 24, bottom = 224;
  const span = Math.max(1, chart.end - chart.start);
  const x = (timestamp: string) => left + (Date.parse(timestamp) - chart.start) / span * (width - left - right);
  const low = amounts.length ? Math.min(...amounts) : 0, high = amounts.length ? Math.max(...amounts) : 1;
  const margin = Math.max((high - low) * .12, selected === "pressure" ? .5 : 1);
  const minimum = selected === "pm25" || selected === "pm10" ? 0 : low - margin;
  const maximum = Math.max(minimum + 1, high + margin);
  const y = (value: number) => bottom - (value - minimum) / (maximum - minimum) * (bottom - top);
  const active = hovered === null ? undefined : chart.data[hovered];
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!chart.data.length) return;
    const box = event.currentTarget.getBoundingClientRect();
    const cursor = (event.clientX - box.left) / box.width * width;
    const index = chart.data.reduce((best, point, index) => Math.abs(x(point.timestamp) - cursor) < Math.abs(x(chart.data[best].timestamp) - cursor) ? index : best, 0);
    setHovered(Math.abs(x(chart.data[index].timestamp) - cursor) < 18 ? index : null);
  };
  const ticks = period === "day" ? dayTicks(anchor).map((tick) => ({ ratio: tick.ratio, label: tick.label }))
    : Array.from({ length: 5 }, (_, index) => ({ ratio: index / 4, label: shortDate.format(new Date(chart.start + span * index / 4 - (index === 4 ? 1 : 0))) }));
  const lastUpdate = data?.updatedAt && Number.isFinite(Date.parse(data.updatedAt)) ? Date.parse(data.updatedAt) : NaN;
  const fresh = Number.isFinite(lastUpdate) && clock - lastUpdate <= 30 * 60_000 && clock >= lastUpdate;
  const isParticulate = selected === "pm25" || selected === "pm10";
  const dailyLimit = dailyParticulate.pm10.dayStart === null ? pm10DailyLimit(dateParts(chart.start).year) : pm10LimitForDay(dailyParticulate.pm10.dayStart);
  const particulateRows = [
    { label: "PM2,5", result: dailyParticulate.pm25, referenceLabel: "WHO-ajánlás · 24 óra", reference: WHO_PM25_DAILY_GUIDELINE, note: "Nem jogszabályi határérték." },
    { label: "PM10", result: dailyParticulate.pm10, referenceLabel: "EU-határérték · 24 óra", reference: dailyLimit.pm10Daily, note: "A határérték évente korlátozott számú napon léphető túl." },
  ];

  return <article className="personal-sensor card" id="sajat-szenzor">
    <div className="section-header">
      <div className="section-header__lead"><div className="section-kicker"><p className="eyebrow">Saját szenzor</p><BackToTop /></div><h2>Környezeti mérések</h2><p className="personal-sensor__status"><span className={fresh ? "is-fresh" : ""} />{data ? fresh ? "Friss mérés" : "Korábbi mérés" : "Adatkapcsolat ellenőrzése"} · {data?.sensorName ?? "SDS011 + BME280"}</p></div>
      <div className="period-control-stack section-header__tools">
        <div className="period-tabs" role="tablist" aria-label="A szenzor időszaka">{PERIODS.map((item) => <button key={item.key} role="tab" aria-selected={period === item.key} className={period === item.key ? "active" : ""} onClick={() => { selection.selectPeriod(item.key); setHovered(null); }}>{item.label}</button>)}</div>
        <div className="period-stepper"><button onClick={() => selection.step(-1)} aria-label="Előző időszak">←</button><strong>{periodLabel(period, anchor, customStart, customEnd)}</strong><button onClick={() => selection.step(1)} disabled={period !== "custom" && isCurrentPeriod(period, anchor)} aria-label="Következő időszak">→</button></div>
        {period === "custom" && <div className="custom-range period-control-stack__custom"><label><span>Kezdőnap</span><input type="date" value={customStart} max={customEnd} onChange={(event) => selection.setCustomRange(event.target.value, customEnd)} /></label><span aria-hidden="true">→</span><label><span>Zárónap</span><input type="date" value={customEnd} min={customStart} max={dateInputValue(new Date())} onChange={(event) => selection.setCustomRange(customStart, event.target.value)} /></label></div>}
      </div>
    </div>
    <div className="personal-sensor__intro"><button className="refresh-button" disabled={busy || loading} onClick={() => void refresh()}><span aria-hidden="true">↻ </span>{busy ? "Frissítés…" : import.meta.env.DEV ? "Frissítés" : refreshLabel}</button></div>
    {(message || data?.error) && <p className="personal-sensor__message" role="status">{message || "A forrás nem válaszolt teljesen; a korábban rögzített mérések láthatók."}</p>}
    <div className="personal-sensor__weather"><strong>Várható időjárás · helyi tendencia</strong><p>{weatherOutlook}</p></div>
    <div className="personal-sensor__metrics" aria-label="Mért értékek">
      {METRICS.map((metric) => {
        const latest = data?.latest?.[metric.key];
        const timestamp = latest && Number.isFinite(Date.parse(latest.timestamp)) ? Date.parse(latest.timestamp) : NaN;
        const valid = latest && Number.isFinite(latest.value) && Number.isFinite(timestamp) && timestamp <= clock;
        const old = valid && clock - timestamp > 30 * 60_000;
        const isSelected = selected === metric.key || ((selected === "pm25" || selected === "pm10") && (metric.key === "pm25" || metric.key === "pm10"));
        const trend = trends[metric.key];
        const rounded = trend ? Number(trend.delta.toFixed(1)) : 0;
        const trendUnit = metric.key === "humidity" ? "százalékpont" : metric.unit;
        const trendText = !trend ? "— Nincs elég friss adat · kb. 1 óra"
          : rounded === 0 ? "→ Közel változatlan · kb. 1 óra"
            : `${rounded > 0 ? "↑ +" : "↓ −"}${formatNumber(Math.abs(rounded), 1)} ${trendUnit} · kb. 1 óra`;
        const trendLabel = !trend ? "Nincs elegendő friss mérés az egyórás változáshoz."
          : rounded === 0 ? "Az utóbbi körülbelül egy órában közel változatlan."
            : `${rounded > 0 ? "Emelkedett" : "Csökkent"} ${formatNumber(Math.abs(rounded), 1)} ${trendUnit} értékkel körülbelül egy óra alatt.`;
        const infoId = `sensor-info-${metric.key}`;
        return <div key={metric.key} className={`personal-sensor__metric${isSelected ? " is-selected" : ""}${openInfo === metric.key ? " is-info-open" : ""}`} onKeyDown={(event) => { if (event.key === "Escape") setOpenInfo(null); }}>
          <button type="button" className="personal-sensor__metric-select" aria-pressed={isSelected} onClick={() => { setSelected(metric.key); setHovered(null); setOpenInfo(null); }}>
            <span><i style={{ backgroundColor: metric.color }} />{metric.label}</span>
            <strong>{valid ? formatNumber(latest.value, metric.decimals) : "—"}<small>{metric.unit}</small></strong>
            <small>{valid ? `${old ? "Korábbi · " : "Mérés · "}${measuredTime.format(new Date(timestamp))}` : "Nincs mérés"}</small>
            <small className={`personal-sensor__trend${trend ? "" : " is-unavailable"}`} aria-label={trendLabel} title={trend ? `Összehasonlított mérések: ${safeTime(trend.from)} – ${safeTime(trend.to)} (bolgár idő).` : undefined}>{trendText}</small>
          </button>
          <button type="button" className="personal-sensor__metric-info" aria-label={`${metric.label} magyarázata`} aria-expanded={openInfo === metric.key} aria-controls={openInfo === metric.key ? infoId : undefined} onClick={() => setOpenInfo(openInfo === metric.key ? null : metric.key)}>i</button>
          {openInfo === metric.key && <div className="personal-sensor__info-panel" id={infoId} role="note"><strong>{metric.label}</strong><p>{EXPLANATIONS[metric.key]}</p><p>Az egyórás nyíl két tényleges mérés különbségét jelzi.</p></div>}
        </div>;
      })}
    </div>
    <div className="personal-sensor__chart-head"><div><h3>{visible.length === 2 ? "Szálló por" : visible[0].label} alakulása</h3><span>{chart.resolution === "sample" ? "10 perces idősávok utolsó mérése" : chart.resolution === "hour" ? "Óránkénti átlag" : "Napi átlag"}</span></div><div className="personal-sensor__legend">{visible.map((metric) => <span key={metric.key}><i style={{ backgroundColor: metric.color }} />{metric.label}</span>)}</div></div>
    {!amounts.length ? <div className="personal-sensor__empty">Erre az időszakra nincs mért adat.</div> : <div className="personal-sensor__chart" onPointerMove={pointerMove} onPointerDown={pointerMove} onPointerLeave={() => setHovered(null)}>
      <div className="personal-sensor__readout">{active ? <><strong>{chart.resolution === "day" ? "Nap" : "Idősáv kezdete"}: {safeTime(active.timestamp)}</strong>{visible.map((metric) => <span key={metric.key}>{metric.label}: {typeof active[metric.key] === "number" ? `${formatNumber(active[metric.key]!, 1)} ${metric.unit}` : "nincs mérés"}</span>)}</> : <span>Mutass vagy érints az ábrára a részletekért.</span>}</div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${visible.map((metric) => metric.label).join(" és ")} időbeli alakulása; az adathiányok üresek`}>
        {[0, .5, 1].map((ratio) => { const value = minimum + (maximum - minimum) * ratio; return <g key={ratio}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className="personal-sensor__grid" /><text x={left - 12} y={y(value) + 4} textAnchor="end" className="personal-sensor__axis">{formatNumber(value, 1)}</text></g>; })}
        {visible.map((metric) => observationSegments(chart.data, (point) => point[metric.key], chart.gapMs).map((segment, index) => <g key={`${metric.key}-${index}`}><polyline points={segment.map(({ point, value }) => `${x(point.timestamp)},${y(value)}`).join(" ")} fill="none" stroke={metric.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />{segment.length === 1 && <circle cx={x(segment[0].point.timestamp)} cy={y(segment[0].value)} r="4" fill={metric.color} />}</g>))}
        {active && <line x1={x(active.timestamp)} x2={x(active.timestamp)} y1={top} y2={bottom} className="personal-sensor__cursor" />}
        {ticks.map((tick, index) => <text key={index} x={left + tick.ratio * (width - left - right)} y={height - 21} textAnchor={index === 0 ? "start" : index === ticks.length - 1 ? "end" : "middle"} className="personal-sensor__axis">{tick.label}</text>)}
        <text x={left} y={height - 3} className="personal-sensor__axis">{visible[0].unit} · bolgár idő</text>
      </svg>
    </div>}
    {isParticulate && <section className="personal-sensor__reference" aria-label="Szálló por napi átlagai és viszonyítási értékei">
      <div className="personal-sensor__reference-summary">
        {particulateRows.map((row) => <Fragment key={row.label}>
          <div className="personal-sensor__reference-reading">
            <span>{row.label} · becsült napi átlag</span>
            {row.result.average === null ? <strong>Nem számítható</strong> : <strong>{formatNumber(row.result.average, 1)} <small>µg/m³</small></strong>}
            <small>{row.result.dayStart === null ? "Az időszakban még nincs lezárt nap." : `${fullDate.format(new Date(row.result.dayStart))} · ${formatNumber(row.result.coverage * 100, 0)}% adatlefedettség`}</small>
          </div>
          <div className="personal-sensor__reference-limit">
            <span>{row.label} · {row.referenceLabel}</span>
            <strong>{formatNumber(row.reference, 0)} <small>µg/m³</small></strong>
            <small>{row.result.average === null ? "Az összevetéshez legalább 75% lefedettség kell." : `A becsült napi átlag ${row.result.average > row.reference ? "felette van" : row.result.average === row.reference ? "eléri" : "alatta van"}.`} {row.note}</small>
          </div>
        </Fragment>)}
      </div>
      <details className="personal-sensor__reference-details">
        <summary>Határértékek és értelmezés</summary>
        <div className="personal-sensor__reference-content">
          <h4>Mit mutatnak a fenti értékek?</h4>
          <p>A bal oldalon a kiválasztott időszak utolsó lezárt bolgár naptári napjának becsült átlaga látható. A jobb oldalon a PM2,5-höz a WHO napi ajánlása, a PM10-hez az EU napi határértéke szerepel. A pillanatnyi mérés, a napi átlag és az éves átlag nem ugyanaz.</p>
          <p>Az átlag a rendelkezésre álló 10 perces mérésekből készül. Csak akkor jelenítjük meg, ha az adott napon az idősávok legalább 75%-ában van mérés. Ez az oldal saját, tájékoztató szabálya, nem helyettesíti a hatósági adatminőségi követelményeket; a folyamatban lévő nap még nem kap napi átlagot.</p>

          <h4>Uniós határértékek</h4>
          <p>A táblázat napi és naptári éves átlagokra vonatkozik, nem egy-egy pillanatnyi értékre. Minden szám µg/m³-ben értendő.</p>
          <table className="personal-sensor__limits">
            <caption>Az uniós határértékek összehasonlítása</caption>
            <thead><tr><th scope="col">Szennyező és időtáv</th><th scope="col">2029 végéig</th><th scope="col">2030-tól</th></tr></thead>
            <tbody>
              <tr><th scope="row">PM2,5 · napi átlag</th><td>Nincs uniós napi határérték</td><td><strong>{PARTICULATE_LIMITS.from2030.pm25Daily}</strong><small>Legfeljebb {PARTICULATE_LIMITS.from2030.pm10Days} nap/év lehet felette.</small></td></tr>
              <tr><th scope="row">PM2,5 · éves átlag</th><td><strong>{PARTICULATE_LIMITS.current.pm25Annual}</strong></td><td><strong>{PARTICULATE_LIMITS.from2030.pm25Annual}</strong></td></tr>
              <tr><th scope="row">PM10 · napi átlag</th><td><strong>{PARTICULATE_LIMITS.current.pm10Daily}</strong><small>Legfeljebb {PARTICULATE_LIMITS.current.pm10Days} nap/év lehet felette.</small></td><td><strong>{PARTICULATE_LIMITS.from2030.pm10Daily}</strong><small>Legfeljebb {PARTICULATE_LIMITS.from2030.pm10Days} nap/év lehet felette.</small></td></tr>
              <tr><th scope="row">PM10 · éves átlag</th><td><strong>{PARTICULATE_LIMITS.current.pm10Annual}</strong></td><td><strong>{PARTICULATE_LIMITS.from2030.pm10Annual}</strong></td></tr>
            </tbody>
          </table>
          <p>A bolgár hatóság a PM2,5-re külön {PARTICULATE_LIMITS.bulgarianIndicativePm25Annual} µg/m³-es indikatív éves értéket is feltüntet. Ez tájékoztató érték, nem azonos a {PARTICULATE_LIMITS.current.pm25Annual} µg/m³-es uniós éves határértékkel.</p>
          <p>A napi határérték feletti napok száma egész évre vonatkozik: egyetlen magas napi átlag önmagában nem jelenti az éves megengedett napok számának túllépését.</p>

          <h4>WHO-ajánlás a PM2,5-re</h4>
          <p>A WHO 24 órás ajánlása {WHO_PM25_DAILY_GUIDELINE} µg/m³. Ez egészségügyi irányérték, nem jogszabályi határérték. Az ajánlás az év napi átlagainak 99. percentilisét használja: ez nagyjából évi 3–4 ennél magasabb napnak felel meg. Egyetlen nap átlaga nem az éves percentilis.</p>
          <p>A saját szenzor tájékoztató mérése nem hatósági értékelés vagy riasztás. Egy érték alatt sem feltétlenül kockázatmentes a levegő.</p>
          <p>Forrás: <a href={PARTICULATE_SOURCES.bulgaria} target="_blank" rel="noreferrer">bolgár légminőségi rendelet</a> · <a href={PARTICULATE_SOURCES.eu} target="_blank" rel="noreferrer">EU 2024/2881 irányelv</a> · <a href={PARTICULATE_SOURCES.who} target="_blank" rel="noreferrer">WHO-ajánlás</a>.</p>
        </div>
      </details>
    </section>}
    <p className="personal-sensor__footnote">Forrás: <a href={data?.sourceUrl ?? "https://sensor.community/"} target="_blank" rel="noreferrer">Madavi{data?.sensorId ? ` · ${data.sensorId}` : ""}</a>. A Sensor.Community érzékelő saját mérései; a légnyomás nem tengerszintre átszámított. {chart.resolution !== "sample" && "Az átlagok a rendelkezésre álló mintákból készülnek. "}Az adathiányokat nem kötjük össze. {data?.points.length ? `Az első tárolt idősáv: ${safeTime(data.points[0].timestamp)}. ` : ""}Lekérdezés: {safeTime(data?.checkedAt)} · bolgár idő.</p>
  </article>;
}
