import { useMemo, useState, type MouseEvent } from "react";
import { dateFromInput, dateInputValue, DAY_MS, isCurrentPeriod, periodLabel, timestampInPeriod } from "./dateUtils";
import { batteryNetValue, gridNetValue } from "./energyData";
import { BackToTop } from "./components/BackToTop";
import type { BulgariaEnergyMixData, BulgariaEnergyMixPoint, EnergyChartPoint, PeriodKey } from "./types";

type MixSeriesKey = "nuclear" | "coal" | "gas" | "hydro" | "solar" | "wind" | "other" | "imports";

type Props = {
  data: BulgariaEnergyMixData;
  householdFallback?: EnergyChartPoint[];
};

const periods: { key: PeriodKey; label: string }[] = [
  { key: "day", label: "Nap" },
  { key: "week", label: "Hét" },
  { key: "month", label: "Hónap" },
  { key: "year", label: "Év" },
  { key: "custom", label: "Egyéb" },
];

const series: { key: MixSeriesKey; label: string; color: string; renewable?: boolean }[] = [
  { key: "nuclear", label: "Nukleáris", color: "#d16b35" },
  { key: "coal", label: "Szén", color: "#6d654f" },
  { key: "gas", label: "Földgáz", color: "#cf5743" },
  { key: "hydro", label: "Vízenergia", color: "#2d7893", renewable: true },
  { key: "solar", label: "Napenergia", color: "#e9aa20", renewable: true },
  { key: "wind", label: "Szélenergia", color: "#118a87", renewable: true },
  { key: "other", label: "Egyéb", color: "#8b9851" },
  { key: "imports", label: "Import", color: "#8b6d93" },
];

const mixKeys = series.map((item) => item.key);
const generationKeys = series.filter((item) => item.key !== "imports").map((item) => item.key);
const compactNumber = new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 1 });
const hourFormatter = new Intl.DateTimeFormat("hu-HU", { hour: "2-digit", minute: "2-digit" });
const dayFormatter = new Intl.DateTimeFormat("hu-HU", { month: "short", day: "numeric" });
const weekdayFormatter = new Intl.DateTimeFormat("hu-HU", { weekday: "short", day: "numeric" });
const monthFormatter = new Intl.DateTimeFormat("hu-HU", { month: "short" });
const fullTimeFormatter = new Intl.DateTimeFormat("hu-HU", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });

function averageMixPoints(points: BulgariaEnergyMixPoint[], bucket: "day" | "month") {
  const groups = new Map<string, { timestamp: string; count: number; values: Record<string, number> }>();
  for (const point of points) {
    const key = bucket === "month" ? point.timestamp.slice(0, 7) : point.timestamp.slice(0, 10);
    const group = groups.get(key) ?? { timestamp: point.timestamp, count: 0, values: {} };
    for (const field of [...mixKeys, "load", "renewableSharePct"] as const) group.values[field] = (group.values[field] ?? 0) + point[field];
    group.count += 1;
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    timestamp: group.timestamp,
    ...Object.fromEntries(Object.entries(group.values).map(([key, value]) => [key, value / group.count])),
  })) as BulgariaEnergyMixPoint[];
}

function isCompleteMixPoint(point: BulgariaEnergyMixPoint) {
  return point.load > 0 && generationKeys.filter((key) => point[key] > 0).length >= 5;
}

function selectedMixPoints(data: BulgariaEnergyMixData, period: PeriodKey, anchor: Date, customStart: string, customEnd: string) {
  const filtered = data.points.filter((point) => isCompleteMixPoint(point) && timestampInPeriod(point.timestamp, period, anchor, customStart, customEnd));
  if (period === "day") return filtered;
  if (period === "year") return averageMixPoints(filtered, "month");
  if (period === "custom" && customStart && customEnd) {
    const days = Math.max(1, Math.round((dateFromInput(customEnd).getTime() - dateFromInput(customStart).getTime()) / DAY_MS) + 1);
    if (days <= 2) return filtered;
    if (days > 90) return averageMixPoints(filtered, "month");
  }
  return averageMixPoints(filtered, "day");
}

function rawMixPoints(data: BulgariaEnergyMixData, period: PeriodKey, anchor: Date, customStart: string, customEnd: string) {
  return data.points.filter((point) => isCompleteMixPoint(point) && timestampInPeriod(point.timestamp, period, anchor, customStart, customEnd));
}

function householdPoints(data: BulgariaEnergyMixData, period: PeriodKey, anchor: Date, customStart: string, customEnd: string, fallback: EnergyChartPoint[] = []) {
  const sources = period === "day"
    ? [data.household?.hourly ?? [], data.household?.daily ?? []]
    : period === "year"
      ? [data.household?.monthly ?? []]
      : period === "custom" && customStart && customEnd && (dateFromInput(customEnd).getTime() - dateFromInput(customStart).getTime()) / DAY_MS > 90
        ? [data.household?.monthly ?? []]
        : [data.household?.daily ?? []];
  for (const source of sources) {
    const filtered = source.filter((point) => timestampInPeriod(point.timestamp, period, anchor, customStart, customEnd));
    if (filtered.length) return { points: filtered, powerValues: source === data.household?.hourly };
  }
  const fallbackPoints = fallback.filter((point) => timestampInPeriod(point.timestamp, period, anchor, customStart, customEnd));
  if (fallbackPoints.length) {
    const powerValues = fallbackPoints.some((point) => Number.isFinite(point.grid) && !Number.isFinite(point.gridPurchase));
    return { points: fallbackPoints, powerValues };
  }
  return { points: [] as EnergyChartPoint[], powerValues: false };
}

function householdSummary(points: EnergyChartPoint[], powerValues: boolean) {
  const fallbackStep = powerValues && points.length > 1
    ? Math.min(.5, Math.max(1 / 60, (new Date(points[1].timestamp!).getTime() - new Date(points[0].timestamp!).getTime()) / 3_600_000))
    : 1;
  let load = 0;
  let grid = 0;
  let battery = 0;
  for (const point of points) {
    const factor = powerValues ? fallbackStep : 1;
    const pointLoad = Math.max(0, point.load ?? 0) * factor;
    const pointGrid = powerValues ? Math.max(0, gridNetValue(point) ?? 0) * factor : Math.max(0, point.gridPurchase ?? 0);
    const pointBattery = powerValues ? Math.max(0, batteryNetValue(point) ?? 0) * factor : Math.max(0, point.batteryDischarge ?? 0);
    load += pointLoad;
    grid += Math.min(pointLoad, pointGrid);
    battery += Math.min(Math.max(0, pointLoad - pointGrid), pointBattery);
  }
  const directPv = Math.max(0, load - grid - battery);
  return { load, grid, battery, directPv };
}

function formatMw(value: number) {
  return value >= 1000 ? `${compactNumber.format(value / 1000)} GW` : `${compactNumber.format(value)} MW`;
}

function formatEnergyMwh(value: number) {
  if (value >= 1_000_000) return `${compactNumber.format(value / 1_000_000)} TWh`;
  if (value >= 1000) return `${compactNumber.format(value / 1000)} GWh`;
  return `${compactNumber.format(value)} MWh`;
}

function localHourFraction(timestamp: string) {
  const match = timestamp.match(/T(\d{2}):(\d{2})/);
  if (!match) return 0;
  return (Number(match[1]) * 60 + Number(match[2])) / 1440;
}

function formatKwh(value: number) {
  return `${compactNumber.format(value)} kWh`;
}

function axisLabel(point: BulgariaEnergyMixPoint, period: PeriodKey, customStart: string, customEnd: string) {
  const date = new Date(point.timestamp);
  if (period === "day") return hourFormatter.format(date);
  if (period === "week") return weekdayFormatter.format(date);
  if (period === "year") return monthFormatter.format(date);
  if (period === "custom" && customStart && customEnd && (dateFromInput(customEnd).getTime() - dateFromInput(customStart).getTime()) / DAY_MS > 90) return monthFormatter.format(date);
  return dayFormatter.format(date);
}

export function BulgariaEnergyMix({ data, householdFallback = [] }: Props) {
  const [period, setPeriod] = useState<PeriodKey>("day");
  const [anchor, setAnchor] = useState(() => new Date());
  const [customStart, setCustomStart] = useState(() => dateInputValue(new Date(Date.now() - 6 * DAY_MS)));
  const [customEnd, setCustomEnd] = useState(() => dateInputValue(new Date()));
  const [hiddenSeries, setHiddenSeries] = useState<Set<MixSeriesKey>>(() => new Set());
  const [hovered, setHovered] = useState<number | null>(null);
  const [hoveredDonut, setHoveredDonut] = useState<MixSeriesKey | null>(null);

  const effectiveAnchor = useMemo(() => {
    if (period !== "day" || !isCurrentPeriod("day", anchor) || !data.points.length) return anchor;
    const hasCurrentDay = data.points.some((point) => timestampInPeriod(point.timestamp, "day", anchor, customStart, customEnd));
    return hasCurrentDay ? anchor : new Date(data.points.at(-1)!.timestamp);
  }, [data.points, period, anchor, customStart, customEnd]);
  const rawPoints = useMemo(() => rawMixPoints(data, period, effectiveAnchor, customStart, customEnd), [data, period, effectiveAnchor, customStart, customEnd]);
  const points = useMemo(() => selectedMixPoints(data, period, effectiveAnchor, customStart, customEnd), [data, period, effectiveAnchor, customStart, customEnd]);
  const availableSeries = series.filter((item) => points.some((point) => point[item.key] > 0));
  const visibleSeries = availableSeries.filter((item) => !hiddenSeries.has(item.key));
  const generationSeries = series.filter((item) => item.key !== "imports");
  const intervalHours = Math.max(1 / 60, data.resolutionMinutes / 60);
  const energyTotals = Object.fromEntries(mixKeys.map((key) => [key, rawPoints.reduce((sum, point) => sum + point[key] * intervalHours, 0)])) as Record<MixSeriesKey, number>;
  const generation = generationSeries.reduce((sum, item) => sum + energyTotals[item.key], 0);
  const consumption = rawPoints.reduce((sum, point) => sum + Math.max(0, point.load) * intervalHours, 0);
  const renewableShare = generation > 0
    ? rawPoints.reduce((sum, point) => {
      const pointGeneration = generationSeries.reduce((pointSum, item) => pointSum + point[item.key], 0);
      return sum + point.renewableSharePct * pointGeneration * intervalHours;
    }, 0) / generation
    : 0;
  const renewableShareDisplay = Math.max(0, Math.min(100, renewableShare));

  const donutValues = generationSeries.map((item) => {
    const value = energyTotals[item.key];
    const percentage = generation > 0 ? value / generation * 100 : 0;
    return { ...item, value, percentage };
  }).filter((item) => item.value > 0);
  const donutItems = donutValues.map((item, index) => ({
    ...item,
    offset: donutValues.slice(0, index).reduce((sum, previous) => sum + previous.percentage, 0),
  }));
  const activeDonut = donutItems.find((item) => item.key === hoveredDonut);

  const width = 1000;
  const height = 320;
  const margin = { top: 20, right: 20, bottom: 48, left: 64 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const x = (index: number) => period === "day"
    ? margin.left + localHourFraction(points[index].timestamp) * plotWidth
    : margin.left + (points.length <= 1 ? plotWidth / 2 : index / (points.length - 1) * plotWidth);
  const stacks = points.map(() => 0);
  const areaSeries = visibleSeries.map((item) => {
    const lower = [...stacks];
    const upper = lower.map((value, index) => value + points[index][item.key]);
    upper.forEach((value, index) => { stacks[index] = value; });
    return { ...item, lower, upper };
  });
  const observedMax = Math.max(1, ...stacks);
  const upper = Math.max(1000, Math.ceil(observedMax / 1000) * 1000);
  const y = (value: number) => margin.top + (1 - value / upper) * plotHeight;
  const tickValues = Array.from({ length: 5 }, (_, index) => upper - index * upper / 4);
  const tickStep = Math.max(1, Math.ceil(points.length / 8));
  const dayTicks = Array.from({ length: 9 }, (_, index) => index * 3);
  const active = hovered === null ? undefined : points[hovered];

  const selectedHousehold = useMemo(() => householdPoints(data, period, anchor, customStart, customEnd, householdFallback), [data, period, anchor, customStart, customEnd, householdFallback]);
  const home = useMemo(() => householdSummary(selectedHousehold.points, selectedHousehold.powerValues), [selectedHousehold]);
  const homeSegments = [
    { label: "Hálózat", value: home.grid, color: "#2d7893" },
    { label: "Saját PV", value: home.directPv, color: "#e9aa20" },
    { label: "Akkumulátor", value: home.battery, color: "#118a87" },
  ];
  const periodSupply = mixKeys.map((key) => ({ key, value: energyTotals[key] }));
  const supplyTotal = periodSupply.reduce((sum, item) => sum + item.value, 0);
  const gridMix = periodSupply.filter((item) => item.value > 0).map((item) => {
    const definition = series.find((candidate) => candidate.key === item.key)!;
    return { ...definition, value: supplyTotal ? home.grid * item.value / supplyTotal : 0 };
  });

  const stepPeriod = (direction: -1 | 1) => {
    if (period === "custom") {
      const start = dateFromInput(customStart);
      const end = dateFromInput(customEnd);
      const span = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1);
      start.setDate(start.getDate() + direction * span);
      end.setDate(end.getDate() + direction * span);
      setCustomStart(dateInputValue(start));
      setCustomEnd(dateInputValue(end));
      return;
    }
    const next = new Date(effectiveAnchor);
    if (period === "day") next.setDate(next.getDate() + direction);
    if (period === "week") next.setDate(next.getDate() + direction * 7);
    if (period === "month") next.setMonth(next.getMonth() + direction);
    if (period === "year") next.setFullYear(next.getFullYear() + direction);
    setAnchor(next);
  };

  const onChartMove = (event: MouseEvent<HTMLDivElement>) => {
    if (!points.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const cursorX = Math.max(0, Math.min(width, (event.clientX - bounds.left) / bounds.width * width));
    const closest = points.reduce((best, _point, index) => Math.abs(x(index) - cursorX) < Math.abs(x(best) - cursorX) ? index : best, 0);
    if (period === "day" && Math.abs(x(closest) - cursorX) > plotWidth / 48) setHovered(null);
    else setHovered(closest);
  };

  return (
    <article className="bulgaria-mix card" id="energiamix">
      <div className="bulgaria-mix__head section-header">
        <div className="section-header__lead">
          <div className="section-kicker"><p className="eyebrow">Országos energia · Bulgária</p><BackToTop /></div>
          <h2>Bulgária energiamixe</h2>
          <p className="bulgaria-mix__freshness"><i className={data.source === "live" ? "is-live" : ""} />{data.source === "live" ? "Élő adat" : "Mintaadat"} · frissítve {new Intl.DateTimeFormat("hu-HU", { hour: "2-digit", minute: "2-digit" }).format(new Date(data.updatedAt))}</p>
        </div>
        <div className="period-tabs bulgaria-mix__tabs section-header__tools" role="tablist" aria-label="Bulgária energiamix időszaka">
          {periods.map((item) => <button key={item.key} role="tab" aria-selected={period === item.key} className={period === item.key ? "active" : ""} onClick={() => { setPeriod(item.key); setAnchor(new Date()); }}>{item.label}</button>)}
        </div>
      </div>

      <div className="bulgaria-mix__controls">
        <div className="period-stepper">
          <button onClick={() => stepPeriod(-1)} aria-label="Előző energiamix-időszak">←</button>
          <strong>{periodLabel(period, effectiveAnchor, customStart, customEnd)}</strong>
          <button onClick={() => stepPeriod(1)} disabled={period !== "custom" && isCurrentPeriod(period, effectiveAnchor)} aria-label="Következő energiamix-időszak">→</button>
        </div>
      </div>

      {period === "custom" && <div className="custom-range bulgaria-mix__custom"><label><span>Kezdőnap</span><input type="date" value={customStart} max={customEnd} onChange={(event) => setCustomStart(event.target.value)} /></label><span aria-hidden="true">→</span><label><span>Zárónap</span><input type="date" value={customEnd} min={customStart} max={dateInputValue(new Date())} onChange={(event) => setCustomEnd(event.target.value)} /></label></div>}

      <div className="bulgaria-mix__main">
        <section className="bulgaria-mix__now" aria-label="A kiválasztott időszak összesített energiamixe">
          <p>A kiválasztott időszak</p>
          <div className="bulgaria-mix__donut">
            <svg viewBox="0 0 100 100" role="img" aria-label={`Összes termelés: ${formatEnergyMwh(generation)}; megújuló részarány: ${compactNumber.format(renewableShareDisplay)}%`}>
              <circle className="mix-donut__track" cx="50" cy="50" r="39" pathLength="100" />
              {donutItems.map((item) => <circle key={item.key} className="mix-donut__slice" cx="50" cy="50" r="39" pathLength="100" stroke={item.color} strokeDasharray={`${item.percentage} ${100 - item.percentage}`} strokeDashoffset={-item.offset} tabIndex={0} onMouseEnter={() => setHoveredDonut(item.key)} onMouseLeave={() => setHoveredDonut(null)} onFocus={() => setHoveredDonut(item.key)} onBlur={() => setHoveredDonut(null)}><title>{item.label}: {formatEnergyMwh(item.value)}</title></circle>)}
            </svg>
            <div className="mix-donut__center">
              <svg className="mix-donut__renewable-ring" viewBox="0 0 100 100" aria-hidden="true">
                <circle className="mix-donut__renewable-track" cx="50" cy="50" r="43" pathLength="100" />
                <circle className="mix-donut__renewable-value" cx="50" cy="50" r="43" pathLength="100" strokeDasharray={`${renewableShareDisplay} ${100 - renewableShareDisplay}`} />
              </svg>
              <strong>{compactNumber.format(renewableShareDisplay)}%</strong><span>megújuló</span>
            </div>
            {activeDonut && <div className="mix-donut__tooltip"><span>{activeDonut.label}</span><strong>{formatEnergyMwh(activeDonut.value)}</strong></div>}
          </div>
          <strong>Országos fogyasztás: {formatEnergyMwh(consumption)}</strong>
          <span>Összes termelés: {formatEnergyMwh(generation)} · {periodLabel(period, effectiveAnchor, customStart, customEnd)}</span>
        </section>

        <section className="bulgaria-mix__history" aria-label="A bolgár energiamix alakulása">
          <div className="bulgaria-mix__chart-head"><strong>Termelési mix alakulása</strong><span>{period === "day" ? "óránként" : period === "year" ? "havi átlag" : "napi átlag"}</span></div>
          <div className="bulgaria-mix__chart" onMouseMove={onChartMove} onMouseLeave={() => setHovered(null)}>
            {points.length ? <>
              <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Rétegezett területdiagram, ${periodLabel(period, effectiveAnchor, customStart, customEnd)}`}>
                {tickValues.map((value) => <g key={value}><line className="mix-gridline" x1={margin.left} x2={width - margin.right} y1={y(value)} y2={y(value)} /><text className="mix-axis" x={margin.left - 10} y={y(value) + 4} textAnchor="end">{value >= 1000 ? `${compactNumber.format(value / 1000)}k` : compactNumber.format(value)}</text></g>)}
                <text className="mix-axis mix-axis__title" x={margin.left} y={13}>MW</text>
                {areaSeries.map((item) => {
                  const upperPath = item.upper.map((value, index) => `${index ? "L" : "M"}${x(index)},${y(value)}`).join(" ");
                  const lowerPath = item.lower.map((value, index) => ({ value, index })).reverse().map(({ value, index }) => `L${x(index)},${y(value)}`).join(" ");
                  return <path key={item.key} d={`${upperPath} ${lowerPath} Z`} fill={item.color} opacity=".9" />;
                })}
                {period === "day"
                  ? dayTicks.map((hour) => <text key={hour} className="mix-axis" x={margin.left + hour / 24 * plotWidth} y={height - 14} textAnchor={hour === 0 ? "start" : hour === 24 ? "end" : "middle"}>{String(hour).padStart(2, "0")}:00</text>)
                  : points.map((point, index) => (index % tickStep === 0 || index === points.length - 1) && <text key={point.timestamp} className="mix-axis" x={x(index)} y={height - 14} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}>{axisLabel(point, period, customStart, customEnd)}</text>)}
                {hovered !== null && <line className="mix-hover-line" x1={x(hovered)} x2={x(hovered)} y1={margin.top} y2={height - margin.bottom} />}
              </svg>
              {active && <div className="bulgaria-mix__tooltip"><strong>{fullTimeFormatter.format(new Date(active.timestamp))}</strong>{visibleSeries.map((item) => <span key={item.key}><i style={{ background: item.color }} />{item.label}<b>{formatMw(active[item.key])}</b></span>)}</div>}
            </> : <div className="bulgaria-mix__empty">Erre az időszakra még nincs energiamix-adat.</div>}
          </div>
          <div className="bulgaria-mix__legend" aria-label="Kapcsolható energiaforrások">{availableSeries.map((item) => <button type="button" key={item.key} className={hiddenSeries.has(item.key) ? "is-hidden" : ""} aria-pressed={!hiddenSeries.has(item.key)} onClick={() => setHiddenSeries((current) => { const next = new Set(current); if (next.has(item.key)) next.delete(item.key); else next.add(item.key); return next; })}><i style={{ background: item.color }} />{item.label}</button>)}</div>
        </section>
      </div>

      <section className="bulgaria-mix__home">
        <div className="bulgaria-mix__home-head"><div><p className="eyebrow">Kapcsolat az otthonoddal</p><h3>A házfogyasztás eredete</h3></div><strong>{formatKwh(home.load)}</strong></div>
        {home.load > 0 ? <div className="bulgaria-mix__home-grid">
          <div className="bulgaria-mix__home-supply">
            <div className="bulgaria-mix__bar-title"><span>Mi látta el a házat?</span><b>teljes fogyasztás</b></div>
            <div className="bulgaria-mix__stack">{homeSegments.filter((item) => item.value > 0).map((item) => <i key={item.label} style={{ width: `${item.value / home.load * 100}%`, background: item.color }} />)}</div>
            <div className="bulgaria-mix__source-list">{homeSegments.map((item) => <span key={item.label}><i style={{ background: item.color }} />{item.label} {formatKwh(item.value)}</span>)}</div>
          </div>
          {home.grid > 0 && <div className="bulgaria-mix__grid-detail">
            <div className="bulgaria-mix__bar-title"><span>A hálózatból vett {formatKwh(home.grid)} becsült összetétele</span><b>időszaki mix</b></div>
            <div className="bulgaria-mix__grid-scale" style={{ width: `${home.grid / home.load * 100}%` }}><div className="bulgaria-mix__stack">{gridMix.map((item) => <i key={item.key} style={{ width: `${item.value / home.grid * 100}%`, background: item.color }} />)}</div></div>
            <div className="bulgaria-mix__source-list">{gridMix.map((item) => <span key={item.key}><i style={{ background: item.color }} />{item.label} {formatKwh(item.value)}</span>)}</div>
          </div>}
        </div> : <p className="bulgaria-mix__home-empty">Erre az időszakra még nincs házfogyasztási adat.</p>}
        <p className="bulgaria-mix__note">A hálózati bontás az időszak országos mixével súlyozott becslés. Az akkumulátor töltési eredetének naplózását egy következő adatgyűjtési lépésben pontosítjuk.</p>
      </section>

      <p className="bulgaria-mix__credit">Forrás: <a href={data.sourceUrl} target="_blank" rel="noreferrer">Energy-Charts.info</a> · {data.license}</p>
    </article>
  );
}
