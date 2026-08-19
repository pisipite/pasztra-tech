import { useMemo, useState } from "react";
import { smoothPath } from "./chartUtils";
import { isCurrentPeriod, periodLabel, timestampInPeriod } from "./dateUtils";
import { batteryChargeValue, batteryDischargeValue, gridFeedInValue, gridPurchaseValue, mergeEnergyAndClimate } from "./energyData";
import type { DashboardData, EnergyChartPoint, PeriodKey } from "./types";

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
  pv: "#d8902f",
  grid: "#54778a",
  gridPurchase: "#16a9ad",
  gridFeedIn: "#83d0cf",
  batteryCharge: "#7eb5d8",
  batteryDischarge: "#338fc4",
  load: "#c9ad00",
  batterySoc: "#2f7057",
  temperature: "#b95734",
  humidity: "#65738b",
};

const shortDayFormatter = new Intl.DateTimeFormat("hu-HU", { month: "short", day: "numeric" });
const weekDayFormatter = new Intl.DateTimeFormat("hu-HU", { weekday: "short", month: "short", day: "numeric" });
const monthNameFormatter = new Intl.DateTimeFormat("hu-HU", { month: "short" });
const fullDayFormatter = new Intl.DateTimeFormat("hu-HU", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
const fullMonthFormatter = new Intl.DateTimeFormat("hu-HU", { year: "numeric", month: "long" });

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
  return point.label;
}

function tooltipPointLabel(point: EnergyChartPoint, period: PeriodKey) {
  const date = pointDate(point);
  if (!date) return point.label;
  return period === "year" ? fullMonthFormatter.format(date) : fullDayFormatter.format(date);
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

export function EnergyAnalytics({ data, period, anchor, customStart, customEnd, onPeriodChange, onStep, onCustomChange }: Props) {
  const [temperatureVisible, setTemperatureVisible] = useState(false);
  const [humidityVisible, setHumidityVisible] = useState(false);
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(() => new Set());
  const [hovered, setHovered] = useState<number | null>(null);

  const rawPoints = useMemo(() => mergeEnergyAndClimate(data, period), [data, period]);

  const points = useMemo(
    () => rawPoints.filter((point) => timestampInPeriod(point.timestamp, period, anchor, customStart, customEnd)),
    [rawPoints, period, anchor, customStart, customEnd],
  );

  const isLine = period === "day";
  const climateIsAverage = period === "week" || period === "month" || period === "year";
  const unit = isLine ? "kW" : "kWh";
  const width = 1000;
  const height = 330;
  const margin = { top: 24, right: 118, bottom: 46, left: 64 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const bucketWidth = plotWidth / Math.max(points.length, 1);
  const seriesDefinitions = isLine ? [
    { key: "pv", label: "PV", color: colors.pv, value: (point: EnergyChartPoint) => point.pv },
    { key: "grid", label: "Hálózat", color: colors.grid, value: (point: EnergyChartPoint) => point.grid },
    { key: "batteryCharge", label: "Akkuba töltés", color: colors.batteryCharge, value: batteryChargeValue },
    { key: "batteryDischarge", label: "Akkuból leadás", color: colors.batteryDischarge, value: batteryDischargeValue },
    { key: "load", label: "Fogyasztás", color: colors.load, value: (point: EnergyChartPoint) => point.load },
  ] : [
    { key: "pv", label: "PV-termelés", color: colors.pv, value: (point: EnergyChartPoint) => point.pv },
    { key: "gridPurchase", label: "Hálózati vételezés", color: colors.gridPurchase, value: gridPurchaseValue },
    { key: "gridFeedIn", label: "Hálózati betáplálás", color: colors.gridFeedIn, value: gridFeedInValue },
    { key: "batteryCharge", label: "Akkuba töltés", color: colors.batteryCharge, value: batteryChargeValue },
    { key: "batteryDischarge", label: "Akkuból leadás", color: colors.batteryDischarge, value: batteryDischargeValue },
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
  const maxValue = Math.max(0, ...values);
  const minValue = Math.min(0, ...values);
  const energyStep = niceStep(Math.max(maxValue - minValue, 1) / 6);
  const upper = Math.max(energyStep, Math.ceil(maxValue / energyStep) * energyStep);
  const lower = minValue < 0 ? Math.floor(minValue / energyStep) * energyStep : 0;
  const range = Math.max(upper - lower, 1);
  const lineX = (index: number) => margin.left + (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const bucketLeft = (index: number) => margin.left + index * bucketWidth;
  const bucketCenter = (index: number) => bucketLeft(index) + bucketWidth / 2;
  const pointX = (index: number) => isLine ? lineX(index) : bucketCenter(index);
  const y = (value: number) => margin.top + ((upper - value) / range) * plotHeight;
  const zeroY = y(0);
  const tempValues = points.map((point) => point.temperature).filter((value): value is number => Number.isFinite(value));
  const tempMin = Math.min(...tempValues, 15) - 1;
  const tempMax = Math.max(...tempValues, 25) + 1;
  const climateY = (value: number, kind: "temperature" | "humidity") => {
    const normalized = kind === "humidity" ? value / 100 : (value - tempMin) / Math.max(tempMax - tempMin, 1);
    return margin.top + (1 - normalized) * plotHeight;
  };
  const temperatureCoords = points.flatMap((point, index) => Number.isFinite(point.temperature) ? [{ x: pointX(index), y: climateY(point.temperature!, "temperature") }] : []);
  const humidityCoords = points.flatMap((point, index) => Number.isFinite(point.humidity) ? [{ x: pointX(index), y: climateY(point.humidity!, "humidity") }] : []);
  const gridLineCount = Math.round((upper - lower) / energyStep) + 1;
  const gridLines = Array.from({ length: gridLineCount }, (_, index) => upper - index * energyStep);
  const percentageTicks = [0, 25, 50, 75, 100];
  const temperatureTicks = Array.from({ length: 5 }, (_, index) => tempMax - (index / 4) * (tempMax - tempMin));
  const tickStep = points.length <= 12 ? 1 : Math.max(1, Math.ceil(points.length / 10));
  const active = hovered === null ? null : points[hovered];
  const nextDisabled = period !== "custom" && isCurrentPeriod(period, anchor);

  return (
    <article className="energy-analysis card" id="energia">
      <span className="plant-sprout plant-sprout--energy" aria-hidden="true"><i /><i /><i /></span>
      <div className="analysis-toolbar">
        <div>
          <p className="eyebrow">Energiafolyam</p>
          <h2>Termelés és felhasználás</h2>
        </div>
        <div className="period-tabs" role="tablist" aria-label="Időfelbontás">
          {periods.map((item) => (
            <button key={item.key} role="tab" aria-selected={period === item.key} className={period === item.key ? "active" : ""} onClick={() => onPeriodChange(item.key)}>{item.label}</button>
          ))}
        </div>
      </div>

      <div className="analysis-controls">
        <div className="period-stepper">
          <button onClick={() => onStep(-1)} aria-label="Előző időszak">←</button>
          <strong>{periodLabel(period, anchor, customStart, customEnd)}</strong>
          <button onClick={() => onStep(1)} disabled={nextDisabled} aria-label="Következő időszak">→</button>
        </div>
        <div className="overlay-toggles" aria-label="Kiegészítő adatsorok">
          <button className={temperatureVisible ? "active temperature" : ""} aria-pressed={temperatureVisible} onClick={() => setTemperatureVisible((value) => !value)}><i />Hőmérséklet</button>
          <button className={humidityVisible ? "active humidity" : ""} aria-pressed={humidityVisible} onClick={() => setHumidityVisible((value) => !value)}><i />Páratartalom</button>
        </div>
      </div>

      {period === "custom" && (
        <div className="custom-range">
          <label><span>Kezdőnap</span><input type="date" value={customStart} max={customEnd} onChange={(event) => onCustomChange(event.target.value, customEnd)} /></label>
          <span aria-hidden="true">→</span>
          <label><span>Zárónap</span><input type="date" value={customEnd} min={customStart} max={new Date().toISOString().slice(0, 10)} onChange={(event) => onCustomChange(customStart, event.target.value)} /></label>
        </div>
      )}

      <div className={`chart-legend${isLine ? "" : " is-bar-legend"}`} aria-label="Jelmagyarázat">
        {availableSeries.map((series) => <button type="button" key={series.key} className={isEnergySeriesVisible(series.key) ? "" : "is-hidden"} aria-pressed={isEnergySeriesVisible(series.key)} onClick={() => toggleEnergySeries(series.key)}><i style={{ background: series.color }} />{series.label}</button>)}
        {hasBatterySoc && <button type="button" className={showBatterySoc ? "" : "is-hidden"} aria-pressed={showBatterySoc} onClick={() => toggleEnergySeries("batterySoc")}><i style={{ background: colors.batterySoc }} />Akkumulátor töltöttség</button>}
        <button type="button" className={temperatureVisible ? "" : "is-hidden"} aria-pressed={temperatureVisible} onClick={() => setTemperatureVisible((value) => !value)}><i style={{ background: colors.temperature }} />Hőmérséklet{climateIsAverage ? " (átlag)" : ""}</button>
        <button type="button" className={humidityVisible ? "" : "is-hidden"} aria-pressed={humidityVisible} onClick={() => setHumidityVisible((value) => !value)}><i style={{ background: colors.humidity }} />Páratartalom{climateIsAverage ? " (átlag)" : ""}</button>
      </div>

      <div className="energy-chart" onMouseLeave={() => setHovered(null)}>
        {points.length ? (
          <>
            <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${isLine ? "Folyamatos" : "Oszlopos"} energiagrafikon, ${periodLabel(period, anchor, customStart, customEnd)}`}>
              <defs>
                <linearGradient id="pv-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={colors.pv} stopOpacity=".34" /><stop offset="100%" stopColor={colors.pv} stopOpacity=".02" /></linearGradient>
              </defs>
              {gridLines.map((value) => <g key={value}><line className="energy-gridline" x1={margin.left} x2={width - margin.right} y1={y(value)} y2={y(value)} /><text className="energy-axis-label" x={margin.left - 12} y={y(value) + 4} textAnchor="end">{formatAxisValue(value, energyStep)}</text></g>)}
              <line className="energy-zero" x1={margin.left} x2={width - margin.right} y1={zeroY} y2={zeroY} />
              <text className="energy-axis-title" x={margin.left} y={14}>{isLine ? "Teljesítmény (kW)" : "Energia (kWh)"}</text>
              {temperatureTicks.map((value) => <text key={`temperature-axis-${value}`} className="energy-axis-label" x={width - margin.right + 10} y={climateY(value, "temperature") + 4} fill={colors.temperature}>{value.toFixed(0)} °C</text>)}
              {percentageTicks.map((value) => <text key={`percentage-axis-${value}`} className="energy-axis-label" x={width - margin.right + 68} y={climateY(value, "humidity") + 4} fill={colors.humidity}>{value}%</text>)}

              {hovered !== null && !isLine && <rect className="hover-band" x={bucketLeft(hovered)} y={margin.top} width={bucketWidth} height={plotHeight} />}

              {isLine ? lineSeries.map((series) => {
                const coords = points.flatMap((point, index) => Number.isFinite(series.value(point)) ? [{ x: lineX(index), y: y(Number(series.value(point))) }] : []);
                const path = smoothPath(coords);
                return <g key={series.key}>{series.key === "pv" && coords.length > 1 && <path d={`${path} L${coords.at(-1)?.x},${zeroY} L${coords[0]?.x},${zeroY} Z`} fill="url(#pv-area)" />}<path d={path} fill="none" stroke={series.color} strokeWidth="2.4" vectorEffect="non-scaling-stroke" /></g>;
              }) : points.map((point, index) => {
                const groupWidth = Math.min(92, bucketWidth * .82);
                const available = lineSeries.filter((series) => Number.isFinite(series.value(point)));
                const slotFor = (key: string) => key === "gridPurchase" || key === "gridFeedIn" ? "grid" : key;
                const slots = [...new Set(available.map((series) => slotFor(series.key)))];
                const barGap = Math.min(3, groupWidth / Math.max(slots.length * 5, 1));
                const barWidth = Math.max(2, (groupWidth - barGap * Math.max(slots.length - 1, 0)) / Math.max(slots.length, 1));
                const center = bucketCenter(index);
                return <g key={`${point.label}-${index}`}>{available.map((series) => {
                  const value = Number(series.value(point) ?? 0);
                  const barY = value >= 0 ? y(value) : zeroY;
                  const barHeight = Math.max(1, Math.abs(y(value) - zeroY));
                  const slotIndex = slots.indexOf(slotFor(series.key));
                  return <rect className="energy-bar" key={series.key} x={center - groupWidth / 2 + slotIndex * (barWidth + barGap)} y={barY} width={barWidth} height={barHeight} rx="1.5" fill={series.color} />;
                })}</g>;
              })}

              {temperatureVisible && temperatureCoords.length > 1 && <path d={smoothPath(temperatureCoords)} fill="none" stroke={colors.temperature} strokeWidth="2" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />}
              {temperatureVisible && temperatureCoords.map((point, index) => <circle key={`temperature-${index}`} cx={point.x} cy={point.y} r="3" fill={colors.temperature} />)}
              {humidityVisible && humidityCoords.length > 1 && <path d={smoothPath(humidityCoords)} fill="none" stroke={colors.humidity} strokeWidth="2" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />}
              {humidityVisible && humidityCoords.map((point, index) => <circle key={`humidity-${index}`} cx={point.x} cy={point.y} r="3" fill={colors.humidity} />)}
              {showBatterySoc && <path d={smoothPath(points.flatMap((point, index) => Number.isFinite(point.batterySoc) ? [{ x: pointX(index), y: climateY(point.batterySoc!, "humidity") }] : []))} fill="none" stroke={colors.batterySoc} strokeWidth="2.2" vectorEffect="non-scaling-stroke" />}

              {points.map((point, index) => (
                <g key={`tick-${point.label}-${index}`}>
                  {(index % tickStep === 0 || index === points.length - 1) && <text className="energy-x-label" x={pointX(index)} y={height - 16} textAnchor="middle">{axisPointLabel(point, period)}</text>}
                  <rect className="chart-hit" x={isLine ? lineX(index) - Math.max(10, bucketWidth / 2) : bucketLeft(index)} y={margin.top} width={isLine ? Math.max(20, bucketWidth) : bucketWidth} height={plotHeight} onMouseEnter={() => setHovered(index)} />
                </g>
              ))}
              {hovered !== null && isLine && <line className="hover-line" x1={lineX(hovered)} x2={lineX(hovered)} y1={margin.top} y2={margin.top + plotHeight} />}
            </svg>
            {active && <div className="chart-tooltip"><strong>{tooltipPointLabel(active, period)}</strong>{isEnergySeriesVisible("pv") && Number.isFinite(active.pv) && <span>PV-termelés <b>{formatValue(active.pv!, unit)}</b></span>}{isEnergySeriesVisible("load") && Number.isFinite(active.load) && <span>Fogyasztás <b>{formatValue(active.load!, unit)}</b></span>}{isLine && isEnergySeriesVisible("grid") && Number.isFinite(active.grid) && <span>Hálózat <b>{formatValue(active.grid!, unit)}</b></span>}{!isLine && isEnergySeriesVisible("gridPurchase") && Number.isFinite(gridPurchaseValue(active)) && <span>Hálózati vételezés <b>{formatValue(gridPurchaseValue(active)!, unit)}</b></span>}{!isLine && isEnergySeriesVisible("gridFeedIn") && Number.isFinite(gridFeedInValue(active)) && <span>Hálózati betáplálás <b>{formatValue(Math.abs(gridFeedInValue(active)!), unit)}</b></span>}{isEnergySeriesVisible("batteryCharge") && Number.isFinite(batteryChargeValue(active)) && <span>Akkuba töltés <b>{formatValue(Math.abs(batteryChargeValue(active)!), unit)}</b></span>}{isEnergySeriesVisible("batteryDischarge") && Number.isFinite(batteryDischargeValue(active)) && <span>Akkuból leadás <b>{formatValue(batteryDischargeValue(active)!, unit)}</b></span>}{showBatterySoc && Number.isFinite(active.batterySoc) && <span>Akku töltöttség <b>{active.batterySoc!.toFixed(0)}%</b></span>}{temperatureVisible && Number.isFinite(active.temperature) && <span>{climateIsAverage ? "Átlaghőmérséklet" : "Hőmérséklet"} <b>{active.temperature!.toFixed(1)} °C</b></span>}{humidityVisible && Number.isFinite(active.humidity) && <span>{climateIsAverage ? "Átlagos páratartalom" : "Páratartalom"} <b>{active.humidity!.toFixed(0)}%</b></span>}</div>}
          </>
        ) : <div className="chart-empty"><strong>Nincs adat ebben az időszakban</strong><span>Válassz másik dátumot, vagy várd meg a következő adatfrissítést.</span></div>}
      </div>
    </article>
  );
}
