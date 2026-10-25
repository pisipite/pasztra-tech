import { useMemo, useState } from "react";
import { smoothPath } from "../../chartUtils";
import { dateInputValue, isCurrentPeriod, periodLabel, timestampInPeriod } from "../../dateUtils";
import { dateKey, dateTimeFormatter, dayFraction, dayTicks } from "../../timeZone";
import { latestObservation, observedPoints, observationSegments } from "../../observationQuality";
import { DataFreshness } from "../../components/DataFreshness";
import { batteryChargeValue, batteryDischargeValue, batteryNetValue, gridFeedInValue, gridNetValue, gridPurchaseValue, mergeEnergyAndClimate } from "../../energyData";
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
  const [temperatureVisible, setTemperatureVisible] = useState(false);
  const [humidityVisible, setHumidityVisible] = useState(false);
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(() => new Set());
  const [hovered, setHovered] = useState<number | null>(null);

  const rawPoints = useMemo(() => mergeEnergyAndClimate(data, period), [data, period]);

  const points = useMemo(
    () => (period === "day" ? observedPoints(rawPoints) : rawPoints.filter((point) => point.timestamp && dateKey(point.timestamp).slice(0, period === "year" ? 7 : 10) <= dateKey(new Date()).slice(0, period === "year" ? 7 : 10)))
      .filter((point) => timestampInPeriod(point.timestamp, period, anchor, customStart, customEnd)),
    [rawPoints, period, anchor, customStart, customEnd],
  );

  const isLine = period === "day";
  const climateIsAverage = period === "week" || period === "month" || period === "year";
  const unit = isLine ? "kW" : "kWh";
  const width = 1000;
  const height = 330;
  const rightMargin = temperatureVisible && humidityVisible ? 118 : temperatureVisible || humidityVisible ? 66 : 28;
  const margin = { top: 24, right: rightMargin, bottom: 46, left: 64 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const bucketWidth = plotWidth / Math.max(points.length, 1);
  const seriesDefinitions = isLine ? [
    { key: "pv", label: "PV", color: colors.pv, value: (point: EnergyChartPoint) => point.pv },
    { key: "grid", label: "Hálózat", color: colors.grid, value: gridNetValue, groupStart: true },
    { key: "battery", label: "Akkumulátor", color: colors.battery, value: batteryNetValue, groupStart: true },
    { key: "load", label: "Fogyasztás", color: colors.load, value: (point: EnergyChartPoint) => point.load },
  ] : [
    { key: "pv", label: "PV-termelés", color: colors.pv, value: (point: EnergyChartPoint) => point.pv },
    { key: "gridPurchase", label: "Hálózati vételezés", color: colors.gridPurchase, value: gridPurchaseValue, groupStart: true },
    { key: "gridFeedIn", label: "Hálózati betáplálás", color: colors.gridFeedIn, value: gridFeedInValue },
    { key: "batteryCharge", label: "Akkumulátor töltése", color: colors.batteryCharge, value: batteryChargeValue, groupStart: true },
    { key: "batteryDischarge", label: "Akkumulátor leadása", color: colors.batteryDischarge, value: batteryDischargeValue },
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
  const tempValues = points.map((point) => point.temperature).filter((value): value is number => Number.isFinite(value));
  const tempObservedMin = Math.min(0, ...tempValues);
  const tempObservedMax = Math.max(25, ...tempValues);
  const maxValue = Math.max(0, ...values);
  const minValue = Math.min(0, ...values);
  const energyStep = niceStep(Math.max(maxValue - minValue, 1) / 6);
  const upper = Math.max(energyStep, Math.ceil(maxValue / energyStep) * energyStep);
  const lower = minValue < 0
    ? Math.floor(minValue / energyStep) * energyStep
    : temperatureVisible && tempObservedMin < 0
      ? -energyStep
      : 0;
  const range = Math.max(upper - lower, 1);
  const lineX = (index: number) => margin.left + (points[index]?.timestamp ? dayFraction(points[index].timestamp!) : 0) * plotWidth;
  const bucketLeft = (index: number) => margin.left + index * bucketWidth;
  const bucketCenter = (index: number) => bucketLeft(index) + bucketWidth / 2;
  const pointX = (index: number) => isLine ? lineX(index) : bucketCenter(index);
  const maxGap = isLine ? 15 * 60_000 : period === "year" ? 32 * 86_400_000 : 36 * 3_600_000;
  const pathsFor = (value: (point: EnergyChartPoint) => number | undefined, projectY: (value: number) => number, gap = maxGap) =>
    observationSegments(points, value, gap).map((segment) => segment.map(({ index, value }) => ({ x: pointX(index), y: projectY(value) })));
  // Climate is sampled independently: empty PV rows are not missing climate
  // measurements. Connect only nearby climate observations, never long outages.
  const climatePathsFor = (key: "temperature" | "humidity") => observationSegments(
    points.map((point, sourceIndex) => ({ ...point, sourceIndex })).filter((point) => Number.isFinite(point[key])),
    (point) => point[key], isLine ? 30 * 60_000 : maxGap,
  ).map((segment) => segment.map(({ point, value }) => ({ x: pointX(point.sourceIndex), y: climateY(value, key) })));
  const y = (value: number) => margin.top + ((upper - value) / range) * plotHeight;
  const zeroY = y(0);
  const tempStep = niceStep(Math.max(tempObservedMax - tempObservedMin, 25) / 4);
  const tempMin = Math.floor(tempObservedMin / tempStep) * tempStep;
  const tempMax = Math.max(tempStep, Math.ceil(tempObservedMax / tempStep) * tempStep);
  const positiveClimateHeight = Math.max(zeroY - margin.top, 1);
  const negativeClimateHeight = Math.max(margin.top + plotHeight - zeroY, 0);
  const climateY = (value: number, kind: "temperature" | "humidity") => {
    if (kind === "humidity") return zeroY - (value / 100) * positiveClimateHeight;
    if (value >= 0) return zeroY - (value / tempMax) * positiveClimateHeight;
    return zeroY + (value / tempMin) * negativeClimateHeight;
  };
  const temperatureCoords = points.flatMap((point, index) => Number.isFinite(point.temperature) ? [{ x: pointX(index), y: climateY(point.temperature!, "temperature") }] : []);
  const humidityCoords = points.flatMap((point, index) => Number.isFinite(point.humidity) ? [{ x: pointX(index), y: climateY(point.humidity!, "humidity") }] : []);
  const gridLineCount = Math.round((upper - lower) / energyStep) + 1;
  const gridLines = Array.from({ length: gridLineCount }, (_, index) => upper - index * energyStep);
  const percentageTicks = [0, 25, 50, 75, 100];
  const temperatureTickCount = Math.round((tempMax - tempMin) / tempStep) + 1;
  const temperatureTicks = Array.from({ length: temperatureTickCount }, (_, index) => tempMax - index * tempStep);
  const temperatureAxisX = width - margin.right + 10;
  const humidityAxisX = width - margin.right + (temperatureVisible ? 68 : 10);
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

      <div className="analysis-controls analysis-controls--overlays">
        <div className="overlay-toggles" aria-label="Kiegészítő adatsorok">
          <button className={temperatureVisible ? "active temperature" : ""} aria-pressed={temperatureVisible} onClick={() => setTemperatureVisible((value) => !value)}><i />Hőmérséklet</button>
          <button className={humidityVisible ? "active humidity" : ""} aria-pressed={humidityVisible} onClick={() => setHumidityVisible((value) => !value)}><i />Páratartalom</button>
        </div>
      </div>

      <div className={`chart-legend${isLine ? "" : " is-bar-legend"}`} aria-label="Jelmagyarázat">
        {availableSeries.map((series) => <button type="button" key={series.key} className={`${series.groupStart ? "series-group-start " : ""}${isEnergySeriesVisible(series.key) ? "" : "is-hidden"}`.trim()} aria-pressed={isEnergySeriesVisible(series.key)} onClick={() => toggleEnergySeries(series.key)}><i style={{ background: series.color }} />{series.label}</button>)}
        {hasBatterySoc && <button type="button" className={showBatterySoc ? "" : "is-hidden"} aria-pressed={showBatterySoc} onClick={() => toggleEnergySeries("batterySoc")}><i style={{ background: colors.batterySoc }} />Akkumulátor töltöttség</button>}
        <button type="button" className={temperatureVisible ? "" : "is-hidden"} aria-pressed={temperatureVisible} onClick={() => setTemperatureVisible((value) => !value)}><i style={{ background: colors.temperature }} />Hőmérséklet{climateIsAverage ? " (átlag)" : ""}</button>
        <button type="button" className={humidityVisible ? "" : "is-hidden"} aria-pressed={humidityVisible} onClick={() => setHumidityVisible((value) => !value)}><i style={{ background: colors.humidity }} />Páratartalom{climateIsAverage ? " (átlag)" : ""}</button>
      </div>

      <DataFreshness collectedAt={data.refreshedAt ?? data.updatedAt}
        observedAt={isLine ? latestObservation(points, (point) => Number.isFinite(point.pv) || Number.isFinite(point.load)) : undefined}
        observationLabel={isLine ? "Utolsó energiaminta" : "Mérési időpont"}
        note={isLine ? "A hiányzó és a jövőbeli mérések helye üres." : "Időszaki energiaszámlálók; a folyamatban levő időszak részleges."} />
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
              {temperatureVisible && temperatureTicks.map((value) => <text key={`temperature-axis-${value}`} className="energy-axis-label" x={temperatureAxisX} y={climateY(value, "temperature") + 4} fill={colors.temperature}>{formatFixedNumber(value, 0)} °C</text>)}
              {humidityVisible && percentageTicks.map((value) => <text key={`percentage-axis-${value}`} className="energy-axis-label" x={humidityAxisX} y={climateY(value, "humidity") + 4} fill={colors.humidity}>{value}%</text>)}

              {hovered !== null && !isLine && <rect className="hover-band" x={bucketLeft(hovered)} y={margin.top} width={bucketWidth} height={plotHeight} />}

              {isLine ? lineSeries.map((series) => <g key={series.key}>{pathsFor(series.value, y).map((coords, segmentIndex) => {
                const path = smoothPath(coords);
                return <g key={segmentIndex}>{series.key === "pv" && coords.length > 1 && <path d={`${path} L${coords.at(-1)?.x},${zeroY} L${coords[0]?.x},${zeroY} Z`} fill="url(#pv-area)" />}<path d={path} fill="none" stroke={series.color} strokeWidth="2.4" vectorEffect="non-scaling-stroke" />{coords.length === 1 && <circle cx={coords[0].x} cy={coords[0].y} r="2.5" fill={series.color} />}</g>;
              })}</g>) : points.map((point, index) => {
                const groupWidth = Math.min(92, bucketWidth * .82);
                const available = lineSeries.filter((series) => Number.isFinite(series.value(point)));
                const slotFor = (key: string) => {
                  if (key === "gridPurchase" || key === "gridFeedIn") return "grid";
                  if (key === "batteryCharge" || key === "batteryDischarge") return "battery";
                  return key;
                };
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

              {temperatureVisible && climatePathsFor("temperature").map((coords, index) => <path key={index} d={smoothPath(coords)} fill="none" stroke={colors.temperature} strokeWidth="2" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />)}
              {temperatureVisible && temperatureCoords.map((point, index) => <circle key={`temperature-${index}`} cx={point.x} cy={point.y} r="3" fill={colors.temperature} />)}
              {humidityVisible && climatePathsFor("humidity").map((coords, index) => <path key={index} d={smoothPath(coords)} fill="none" stroke={colors.humidity} strokeWidth="2" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />)}
              {humidityVisible && humidityCoords.map((point, index) => <circle key={`humidity-${index}`} cx={point.x} cy={point.y} r="3" fill={colors.humidity} />)}
              {showBatterySoc && pathsFor((point) => point.batterySoc, (value) => climateY(value, "humidity")).map((coords, index) => <path key={index} d={smoothPath(coords)} fill="none" stroke={colors.batterySoc} strokeWidth="2.2" vectorEffect="non-scaling-stroke" />)}

              {isLine && dayTicks(anchor).map((tick) => <text key={tick.label} className="energy-x-label" x={margin.left + tick.ratio * plotWidth} y={height - 16} textAnchor={tick.ratio === 0 ? "start" : tick.ratio === 1 ? "end" : "middle"}>{tick.label}</text>)}
              {points.map((point, index) => (
                <g key={`tick-${point.label}-${index}`}>
                  {!isLine && (index % tickStep === 0 || index === points.length - 1) && <text className="energy-x-label" x={pointX(index)} y={height - 16} textAnchor="middle">{axisPointLabel(point, period)}</text>}
                  <rect className="chart-hit" x={isLine ? lineX(index) - 2 : bucketLeft(index)} y={margin.top} width={isLine ? 4 : bucketWidth} height={plotHeight} onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(null)} />
                </g>
              ))}
              {hovered !== null && isLine && <line className="hover-line" x1={lineX(hovered)} x2={lineX(hovered)} y1={margin.top} y2={margin.top + plotHeight} />}
            </svg>
            {active && <div className="chart-tooltip"><strong>{tooltipPointLabel(active, period)}</strong>{isEnergySeriesVisible("pv") && Number.isFinite(active.pv) && <span>PV-termelés <b>{formatValue(active.pv!, unit)}</b></span>}{isEnergySeriesVisible("load") && Number.isFinite(active.load) && <span>Fogyasztás <b>{formatValue(active.load!, unit)}</b></span>}{isLine && isEnergySeriesVisible("grid") && Number.isFinite(activeGrid) && <span>{gridFlowLabel(activeGrid!)} <b>{formatValue(Math.abs(activeGrid!), unit)}</b></span>}{isLine && isEnergySeriesVisible("battery") && Number.isFinite(activeBattery) && <span>{batteryFlowLabel(activeBattery!)} <b>{formatValue(Math.abs(activeBattery!), unit)}</b></span>}{!isLine && isEnergySeriesVisible("gridPurchase") && Number.isFinite(gridPurchaseValue(active)) && <span>Hálózatból véve <b>{formatValue(gridPurchaseValue(active)!, unit)}</b></span>}{!isLine && isEnergySeriesVisible("gridFeedIn") && Number.isFinite(gridFeedInValue(active)) && <span>Hálózatba táplálva <b>{formatValue(Math.abs(gridFeedInValue(active)!), unit)}</b></span>}{!isLine && isEnergySeriesVisible("batteryCharge") && Number.isFinite(batteryChargeValue(active)) && <span>Akkumulátor töltése <b>{formatValue(Math.abs(batteryChargeValue(active)!), unit)}</b></span>}{!isLine && isEnergySeriesVisible("batteryDischarge") && Number.isFinite(batteryDischargeValue(active)) && <span>Akkumulátor leadása <b>{formatValue(batteryDischargeValue(active)!, unit)}</b></span>}{showBatterySoc && Number.isFinite(active.batterySoc) && <span>Akku töltöttség <b>{formatFixedNumber(active.batterySoc!, 0)}%</b></span>}{temperatureVisible && Number.isFinite(active.temperature) && <span>{climateIsAverage ? "Átlaghőmérséklet" : "Hőmérséklet"} <b>{formatFixedNumber(active.temperature!, 1)} °C</b></span>}{humidityVisible && Number.isFinite(active.humidity) && <span>{climateIsAverage ? "Átlagos páratartalom" : "Páratartalom"} <b>{formatFixedNumber(active.humidity!, 0)}%</b></span>}</div>}
          </>
        ) : <div className="chart-empty"><strong>Nincs adat ebben az időszakban</strong><span>Válassz másik dátumot, vagy várd meg a következő adatfrissítést.</span></div>}
      </div>
    </article>
  );
}
