import { useMemo, useState } from "react";
import { smoothPath } from "../../chartUtils";
import { dateInputValue, isCurrentPeriod, periodLabel, timestampInPeriod } from "../../dateUtils";
import { dateKey, dateTimeFormatter, dayFraction, dayTicks } from "../../timeZone";
import { connectedSampleGap, latestObservation, observedPoints, observationSegments } from "../../observationQuality";
import { DataFreshness } from "../../components/DataFreshness";
import { batteryNetValue, gridNetValue } from "../../energyData";
import { householdSummary } from "../bulgaria-energy/householdSummary";
import { formatFixedNumber } from "../../formatUtils";
import type { DashboardData, EnergyChartPoint, PeriodKey } from "../../types";
import { ENERGY_SOURCE_COLORS } from "../../config/energyColors";
import { BackToTop } from "../../components/BackToTop";

type Props = {
  data: DashboardData;
  period: PeriodKey;
  anchor: Date;
  customStart: string;
  customEnd: string;
  onPeriodChange: (period: PeriodKey) => void;
  onStep: (direction: -1 | 1) => void;
  onCustomChange: (start: string, end: string) => void;
};

const periods: { key: PeriodKey; label: string }[] = [
  { key: "day", label: "Nap" },
  { key: "week", label: "Hét" },
  { key: "month", label: "Hónap" },
  { key: "year", label: "Év" },
  { key: "custom", label: "Egyedi" },
];

const colors = {
  pv: ENERGY_SOURCE_COLORS.solar,
  grid: ENERGY_SOURCE_COLORS.grid,
  gridPurchase: ENERGY_SOURCE_COLORS.grid,
  gridFeedIn: ENERGY_SOURCE_COLORS.gridFeedIn,
  battery: ENERGY_SOURCE_COLORS.battery,
  batteryCharge: ENERGY_SOURCE_COLORS.batteryCharge,
  batteryDischarge: ENERGY_SOURCE_COLORS.battery,
  load: "var(--series-load)",
  batterySoc: "var(--series-battery-soc)",
  temperature: "var(--series-temperature)",
  humidity: "var(--series-humidity)",
};

const shortDayFormatter = dateTimeFormatter({ month: "short", day: "numeric" });
const weekDayFormatter = dateTimeFormatter({ weekday: "short", month: "short", day: "numeric" });
const monthNameFormatter = dateTimeFormatter({ month: "short" });
const fullDayFormatter = dateTimeFormatter({ year: "numeric", month: "long", day: "numeric", weekday: "long" });
const clockFormatter = dateTimeFormatter({ hour: "2-digit", minute: "2-digit" });
const fullMonthFormatter = dateTimeFormatter({ year: "numeric", month: "long" });

function pointDate(point: EnergyChartPoint) {
  if (!point.timestamp) return undefined;
  const value = new Date(point.timestamp);
  return Number.isNaN(value.getTime()) ? undefined : value;
}

function axisPointLabel(point: EnergyChartPoint, period: PeriodKey) {
  const date = pointDate(point);
  if (!date) return point.label;
  if (period === "year") return monthNameFormatter.format(date);
  if (period === "week") return weekDayFormatter.format(date);
  if (period === "month" || period === "custom") return shortDayFormatter.format(date);
  return clockFormatter.format(date);
}

function tooltipPointLabel(point: EnergyChartPoint, period: PeriodKey) {
  const date = pointDate(point);
  if (!date) return point.label;
  if (period === "year") return fullMonthFormatter.format(date);
  const day = fullDayFormatter.format(date);
  return period === "day" ? `${day} · ${clockFormatter.format(date)}` : day;
}

function formatValue(value: number, unit: string) {
  return `${value.toLocaleString("hu-HU", { maximumFractionDigits: 2 })} ${unit}`;
}

function niceStep(value: number) {
  const exponent = Math.floor(Math.log10(Math.max(value, Number.EPSILON)));
  const magnitude = 10 ** exponent;
  const fraction = value / magnitude;
  const rounded = fraction < 1.5 ? 1 : fraction < 2.25 ? 2 : fraction < 3.5 ? 2.5 : fraction < 7.5 ? 5 : 10;
  return rounded * magnitude;
}

function formatAxisValue(value: number, step: number) {
  const fractionDigits = step < 1 ? Math.max(1, Math.ceil(-Math.log10(step))) : 0;
  return value.toLocaleString("hu-HU", { maximumFractionDigits: fractionDigits });
}

function gridFlowLabel(value: number) {
  if (value > 0) return "Hálózatból véve";
  if (value < 0) return "Hálózatba táplálva";
  return "Hálózat — nincs áramlás";
}

function batteryFlowLabel(value: number) {
  if (value > 0) return "Akkumulátorból leadva";
  if (value < 0) return "Akkumulátorba töltve";
  return "Akkumulátor — nincs áramlás";
}

export function EnergyAnalytics({ data, period, anchor, customStart, customEnd, onPeriodChange, onStep, onCustomChange }: Props) {
  const [energyView, setEnergyView] = useState<"balance" | "sources">("balance");
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(() => new Set());
  const [hovered, setHovered] = useState<number | null>(null);

  const points = useMemo(
    () => (period === "day" ? observedPoints(data.solar.energyChart ?? []) : (data.solar.energyChart ?? []).filter((point) => point.timestamp && dateKey(point.timestamp).slice(0, period === "year" ? 7 : 10) <= dateKey(new Date()).slice(0, period === "year" ? 7 : 10)))
      .filter((point) => timestampInPeriod(point.timestamp, period, anchor, customStart, customEnd)),
    [data.solar.energyChart, period, anchor, customStart, customEnd],
  );

  const isLine = period === "day";
  const stacked = !isLine && energyView === "sources";
  const sources = points.map((point) => householdSummary([point], false));
  const unit = isLine ? "kW" : "kWh";
  const width = 1000;
  const height = 330;
  const rightMargin = 28;
  const margin = { top: 24, right: rightMargin, bottom: 46, left: 64 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const bucketWidth = plotWidth / Math.max(points.length, 1);
  const seriesDefinitions = isLine ? [
    { key: "pv", label: "PV", color: colors.pv, value: (point: EnergyChartPoint) => point.pv },
    { key: "grid", label: "Hálózat", color: colors.grid, value: gridNetValue, groupStart: true },
    { key: "battery", label: "Akkumulátor", color: colors.battery, value: batteryNetValue, groupStart: true },
    { key: "load", label: "Fogyasztás", color: colors.load, value: (point: EnergyChartPoint) => point.load },
  ] : stacked ? [
    { key: "gridPurchase", label: "Hálózat", color: colors.grid, value: (point: EnergyChartPoint) => { const h = householdSummary([point], false); return h.hasBreakdown ? h.grid : undefined; } },
    { key: "directPv", label: "Közvetlen PV", color: colors.pv, value: (point: EnergyChartPoint) => { const h = householdSummary([point], false); return h.hasBreakdown ? h.directPv : undefined; } },
    { key: "batteryDischarge", label: "Akkumulátor", color: colors.battery, value: (point: EnergyChartPoint) => { const h = householdSummary([point], false); return h.hasBreakdown ? h.battery : undefined; } },
  ] : [
    { key: "pv", label: "PV-termelés", color: colors.pv, value: (point: EnergyChartPoint) => point.pv },
    { key: "load", label: "Fogyasztás", color: colors.load, value: (point: EnergyChartPoint) => point.load },
  ];
  const availableSeries = seriesDefinitions.filter((series) => points.some((point) => Number.isFinite(series.value(point))));
  const isEnergySeriesVisible = (key: string) => !hiddenSeries.has(key);
  const lineSeries = availableSeries.filter((series) => isEnergySeriesVisible(series.key));
  const hasBatterySoc = isLine && points.some((point) => Number.isFinite(point.batterySoc));
  const showBatterySoc = hasBatterySoc && isEnergySeriesVisible("batterySoc");
  const toggleEnergySeries = (key: string) => setHiddenSeries((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const values = points.flatMap((point) => lineSeries.map((series) => series.value(point)).filter((value): value is number => Number.isFinite(value)));
  const maxValue = Math.max(0, ...values, ...(stacked ? sources.filter((h) => h.hasBreakdown).map((h) => h.load) : []));
  const minValue = Math.min(0, ...values);
  const energyStep = niceStep(Math.max(maxValue - minValue, 1) / 6);
  const upper = Math.max(energyStep, Math.ceil(maxValue / energyStep) * energyStep);
  const lower = Math.floor(minValue / energyStep) * energyStep;
  const range = Math.max(upper - lower, 1);
  const lineX = (index: number) => margin.left + (points[index]?.timestamp ? dayFraction(points[index].timestamp!) : 0) * plotWidth;
  const bucketLeft = (index: number) => margin.left + index * bucketWidth;
  const bucketCenter = (index: number) => bucketLeft(index) + bucketWidth / 2;
  const pointX = (index: number) => isLine ? lineX(index) : bucketCenter(index);
  const maxGap = isLine ? connectedSampleGap(points, 15 * 60_000, 3 * 3_600_000) : period === "year" ? 32 * 86_400_000 : 36 * 3_600_000;
  const pathsFor = (value: (point: EnergyChartPoint) => number | undefined, projectY: (value: number) => number, gap = maxGap) =>
    observationSegments(points, value, gap).map((segment) => segment.map(({ index, value }) => ({ x: pointX(index), y: projectY(value) })));
  const y = (value: number) => margin.top + ((upper - value) / range) * plotHeight;
  const zeroY = y(0);
  const gridLines = Array.from({ length: Math.round((upper - lower) / energyStep) + 1 }, (_, index) => upper - index * energyStep);
  const socTop = height + 12, socHeight = 78;
  const totalHeight = showBatterySoc ? socTop + socHeight + 32 : height;
  const socY = (value: number) => socTop + (1 - value / 100) * socHeight;
  const tickStep = points.length <= 12 ? 1 : Math.max(1, Math.ceil(points.length / 10));
  const active = hovered === null ? null : points[hovered];
  const activeGrid = active ? gridNetValue(active) : undefined;
  const activeBattery = active ? batteryNetValue(active) : undefined;
  const nextDisabled = period !== "custom" && isCurrentPeriod(period, anchor);

  return (
    <article className="energy-analysis card" id="energia">
      <span className="plant-sprout plant-sprout--energy" aria-hidden="true"><i /><i /><i /></span>
      <div className="analysis-toolbar section-header">
        <div className="section-header__lead">
          <div className="section-kicker"><p className="eyebrow">Energiafolyam</p><BackToTop /></div>
          <h2>Termelés és felhasználás</h2>
        </div>
        <div className="period-control-stack section-header__tools">
          <div className="period-tabs" role="tablist" aria-label="Időfelbontás">
            {periods.map((item) => (
              <button key={item.key} role="tab" aria-selected={period === item.key} className={period === item.key ? "active" : ""} onClick={() => onPeriodChange(item.key)}>{item.label}</button>
            ))}
          </div>
          <div className="period-stepper">
            <button onClick={() => onStep(-1)} aria-label="Előző időszak">←</button>
            <strong>{periodLabel(period, anchor, customStart, customEnd)}</strong>
            <button onClick={() => onStep(1)} disabled={nextDisabled} aria-label="Következő időszak">→</button>
          </div>
          {period === "custom" && (
            <div className="custom-range period-control-stack__custom">
              <label><span>Kezdőnap</span><input type="date" value={customStart} max={customEnd} onChange={(event) => onCustomChange(event.target.value, customEnd)} /></label>
              <span aria-hidden="true">→</span>
              <label><span>Zárónap</span><input type="date" value={customEnd} min={customStart} max={dateInputValue(new Date())} onChange={(event) => onCustomChange(customStart, event.target.value)} /></label>
            </div>
          )}
        </div>
      </div>

      {!isLine && <div className="chart-view-switch" role="group" aria-label="Energiaábra nézete">
        <button aria-pressed={!stacked} onClick={() => { setEnergyView("balance"); setHovered(null); }}>Mennyi termelt és fogyott?</button>
        <button aria-pressed={stacked} onClick={() => { setEnergyView("sources"); setHovered(null); }}>Mi látta el a házat?</button>
      </div>}
      <div className="chart-legend" aria-label="Jelmagyarázat">
        {availableSeries.map((series) => <button type="button" key={series.key} className={isEnergySeriesVisible(series.key) ? "" : "is-hidden"} aria-pressed={isEnergySeriesVisible(series.key)} onClick={() => toggleEnergySeries(series.key)}><i style={{ background: series.color }} />{series.label}</button>)}
        {hasBatterySoc && <button type="button" className={showBatterySoc ? "" : "is-hidden"} aria-pressed={showBatterySoc} onClick={() => toggleEnergySeries("batterySoc")}><i style={{ background: colors.batterySoc }} />Akkutöltöttség · külön sáv</button>}
      </div>
      <div className="energy-chart" onMouseLeave={() => setHovered(null)}>
        {points.length ? (
          <>
            <svg viewBox={`0 0 ${width} ${totalHeight}`} role="img" aria-label={`${isLine ? "Folyamatos" : "Oszlopos"} energiagrafikon, ${periodLabel(period, anchor, customStart, customEnd)}`}>
              <defs>
                <linearGradient id="pv-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={colors.pv} stopOpacity=".34" /><stop offset="100%" stopColor={colors.pv} stopOpacity=".02" /></linearGradient>
              </defs>
              {gridLines.map((value) => <g key={value}><line className="energy-gridline" x1={margin.left} x2={width - margin.right} y1={y(value)} y2={y(value)} /><text className="energy-axis-label" x={margin.left - 12} y={y(value) + 4} textAnchor="end">{formatAxisValue(value, energyStep)}</text></g>)}
              <line className="energy-zero" x1={margin.left} x2={width - margin.right} y1={zeroY} y2={zeroY} />
              <text className="energy-axis-title" x={margin.left} y={14}>{isLine ? "Teljesítmény (kW)" : "Energia (kWh)"}</text>

              {hovered !== null && !isLine && <rect className="hover-band" x={bucketLeft(hovered)} y={margin.top} width={bucketWidth} height={plotHeight} />}

              {isLine ? lineSeries.map((series) => <g key={series.key}>{pathsFor(series.value, y).map((coords, segmentIndex) => {
                const path = smoothPath(coords);
                return <g key={segmentIndex}>{series.key === "pv" && coords.length > 1 && <path d={`${path} L${coords.at(-1)?.x},${zeroY} L${coords[0]?.x},${zeroY} Z`} fill="url(#pv-area)" />}<path d={path} fill="none" stroke={series.color} strokeWidth="2.4" vectorEffect="non-scaling-stroke" />{coords.length === 1 && <circle cx={coords[0].x} cy={coords[0].y} r="2.5" fill={series.color} />}</g>;
              })}</g>) : points.map((point, index) => {
                const groupWidth = Math.min(92, bucketWidth * .72);
                if (stacked && !sources[index].hasBreakdown) return <text key={index} x={bucketCenter(index)} y={zeroY - 6} textAnchor="middle" className="energy-axis-label"><title>Hiányos vagy becsült forrásbontás</title>–</text>;
                const available = lineSeries.filter((series) => Number.isFinite(series.value(point)));
                const barWidth = stacked ? groupWidth : groupWidth / Math.max(available.length, 1);
                let sum = 0;
                return <g key={index}>{available.map((series, slot) => {
                  const value = series.value(point)!;
                  const bottom = stacked ? sum : 0;
                  sum += value;
                  return <rect key={series.key} x={bucketCenter(index) - groupWidth / 2 + (stacked ? 0 : slot * barWidth)} y={y(bottom + value)} width={Math.max(1, barWidth - (stacked ? 0 : 2))} height={Math.max(0, y(bottom) - y(bottom + value))} fill={series.color} />;
                })}</g>;
              })}

              {showBatterySoc && <g aria-label="Akkutöltöttség 0–100%">
                <text x={margin.left} y={socTop - 8} className="energy-axis-title">Akkutöltöttség (%)</text>
                {[0, 50, 100].map((value) => <g key={value}><line className="energy-gridline" x1={margin.left} x2={width - margin.right} y1={socY(value)} y2={socY(value)} /><text className="energy-axis-label" x={margin.left - 12} y={socY(value) + 4} textAnchor="end">{value}%</text></g>)}
                {pathsFor((point) => Number.isFinite(point.batterySoc) && point.batterySoc! >= 0 && point.batterySoc! <= 100 ? point.batterySoc : undefined, socY).map((coords, index) => <g key={index}><path d={smoothPath(coords)} fill="none" stroke={colors.batterySoc} strokeWidth="2.2" vectorEffect="non-scaling-stroke" />{coords.length === 1 && <circle cx={coords[0].x} cy={coords[0].y} r="3" fill={colors.batterySoc} />}</g>)}
              </g>}

              {isLine && dayTicks(anchor).map((tick) => <text key={tick.label} className="energy-x-label" x={margin.left + tick.ratio * plotWidth} y={totalHeight - 12} textAnchor={tick.ratio === 0 ? "start" : tick.ratio === 1 ? "end" : "middle"}>{tick.label}</text>)}
              {points.map((point, index) => (
                <g key={`tick-${point.label}-${index}`}>
                  {!isLine && (index % tickStep === 0 || index === points.length - 1) && <text className="energy-x-label" x={pointX(index)} y={height - 16} textAnchor="middle">{axisPointLabel(point, period)}</text>}
                  <rect className="chart-hit" x={isLine ? lineX(index) - 2 : bucketLeft(index)} y={margin.top} width={isLine ? 4 : bucketWidth} height={totalHeight - margin.top - 25} onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(null)} />
                </g>
              ))}
              {hovered !== null && isLine && <line className="hover-line" x1={lineX(hovered)} x2={lineX(hovered)} y1={margin.top} y2={showBatterySoc ? socTop + socHeight : margin.top + plotHeight} />}
            </svg>
            {active && <div className="chart-tooltip"><strong>{tooltipPointLabel(active, period)}</strong>
              {lineSeries.map((series) => { const value = series.value(active); return Number.isFinite(value) ? <span key={series.key}>{isLine && series.key === "grid" ? gridFlowLabel(activeGrid!) : isLine && series.key === "battery" ? batteryFlowLabel(activeBattery!) : series.label}<b>{formatValue(isLine ? Math.abs(value!) : value!, unit)}</b></span> : null; })}
              {stacked && !sources[hovered!]?.hasBreakdown && <span>Nincs megbízható forrásbontás</span>}
              {showBatterySoc && Number.isFinite(active.batterySoc) && <span>Akku töltöttség <b>{formatFixedNumber(active.batterySoc!, 0)}%</b></span>}
            </div>}
          </>
        ) : <div className="chart-empty"><strong>Nincs adat ebben az időszakban</strong><span>Válassz másik dátumot, vagy várd meg a következő adatfrissítést.</span></div>}
      </div>
      <div className="chart-footnotes">
        <DataFreshness collectedAt={data.refreshedAt ?? data.updatedAt}
          observedAt={isLine ? latestObservation(points, (point) => Number.isFinite(point.pv) || Number.isFinite(point.load)) : undefined}
          observationLabel={isLine ? "Utolsó energiaminta" : "Mérési időpont"}
          note={isLine ? "A hiányzó és a jövőbeli mérések helye üres." : "Időszaki energiaszámlálók; a folyamatban levő időszak részleges."} />
        {stacked && <p className="data-quality-note">Csak ismert fogyasztás, hálózati vételezés és akkuleadás esetén készül bontás. A közvetlen PV ezek maradéka; hiányos vagy becsült bontás helye üres.</p>}
      </div>
    </article>
  );
}
