import { useMemo, useState } from "react";
import { smoothPath } from "./chartUtils";
import { isCurrentPeriod, periodLabel, timestampInPeriod } from "./dateUtils";
import { batteryChargeValue, batteryDischargeValue, mergeEnergyAndClimate } from "./energyData";
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
  batteryCharge: "#3c91a8",
  batteryDischarge: "#76a99a",
  load: "#a96843",
  batterySoc: "#2f7057",
  temperature: "#b95734",
  humidity: "#65738b",
};

function formatValue(value: number, unit: string) {
  return `${value.toLocaleString("hu-HU", { maximumFractionDigits: 2 })} ${unit}`;
}

export function EnergyAnalytics({ data, period, anchor, customStart, customEnd, onPeriodChange, onStep, onCustomChange }: Props) {
  const [temperatureVisible, setTemperatureVisible] = useState(false);
  const [humidityVisible, setHumidityVisible] = useState(false);
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
  const margin = { top: 24, right: 66, bottom: 46, left: 64 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const values = points.flatMap((point) => [point.pv, point.grid, batteryChargeValue(point), batteryDischargeValue(point), point.load].filter((value): value is number => Number.isFinite(value)));
  const maxValue = Math.max(1, ...values.map((value) => Math.abs(value)));
  const minValue = Math.min(0, ...values);
  const upper = maxValue * 1.12;
  const lower = minValue < 0 ? minValue * 1.15 : 0;
  const range = Math.max(upper - lower, 1);
  const x = (index: number) => margin.left + (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const y = (value: number) => margin.top + ((upper - value) / range) * plotHeight;
  const zeroY = y(0);
  const tempValues = points.map((point) => point.temperature).filter((value): value is number => Number.isFinite(value));
  const tempMin = Math.min(...tempValues, 15) - 1;
  const tempMax = Math.max(...tempValues, 25) + 1;
  const climateY = (value: number, kind: "temperature" | "humidity") => {
    const normalized = kind === "humidity" ? value / 100 : (value - tempMin) / Math.max(tempMax - tempMin, 1);
    return margin.top + (1 - normalized) * plotHeight;
  };
  const temperatureCoords = points.flatMap((point, index) => Number.isFinite(point.temperature) ? [{ x: x(index), y: climateY(point.temperature!, "temperature") }] : []);
  const humidityCoords = points.flatMap((point, index) => Number.isFinite(point.humidity) ? [{ x: x(index), y: climateY(point.humidity!, "humidity") }] : []);
  const gridLines = Array.from({ length: 5 }, (_, index) => upper - (index / 4) * range);
  const tickStep = Math.max(1, Math.ceil(points.length / 8));
  const active = hovered === null ? null : points[hovered];
  const nextDisabled = period !== "custom" && isCurrentPeriod(period, anchor);

  const lineSeries = [
    { key: "pv", label: "PV", color: colors.pv, value: (point: EnergyChartPoint) => point.pv },
    { key: "grid", label: "Hálózat", color: colors.grid, value: (point: EnergyChartPoint) => point.grid },
    { key: "batteryCharge", label: "Akkuba töltés", color: colors.batteryCharge, value: batteryChargeValue },
    { key: "batteryDischarge", label: "Akkuból leadás", color: colors.batteryDischarge, value: batteryDischargeValue },
    { key: "load", label: "Fogyasztás", color: colors.load, value: (point: EnergyChartPoint) => point.load },
  ].filter((series) => points.some((point) => Number.isFinite(series.value(point))));
  const hasBatterySoc = points.some((point) => Number.isFinite(point.batterySoc));

  return (
    <article className="energy-analysis card">
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

      <div className="chart-legend" aria-label="Jelmagyarázat">
        {lineSeries.map((series) => <span key={series.key}><i style={{ background: series.color }} />{series.label}</span>)}
        {hasBatterySoc && <span><i style={{ background: colors.batterySoc }} />Akkumulátor töltöttség</span>}
        {temperatureVisible && <span><i style={{ background: colors.temperature }} />Hőmérséklet{climateIsAverage ? " (átlag)" : ""}</span>}
        {humidityVisible && <span><i style={{ background: colors.humidity }} />Páratartalom{climateIsAverage ? " (átlag)" : ""}</span>}
      </div>

      <div className="energy-chart" onMouseLeave={() => setHovered(null)}>
        {points.length ? (
          <>
            <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${isLine ? "Folyamatos" : "Oszlopos"} energiagrafikon, ${periodLabel(period, anchor, customStart, customEnd)}`}>
              <defs>
                <linearGradient id="pv-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={colors.pv} stopOpacity=".34" /><stop offset="100%" stopColor={colors.pv} stopOpacity=".02" /></linearGradient>
              </defs>
              {gridLines.map((value) => <g key={value}><line className="energy-gridline" x1={margin.left} x2={width - margin.right} y1={y(value)} y2={y(value)} /><text className="energy-axis-label" x={margin.left - 12} y={y(value) + 4} textAnchor="end">{value.toFixed(value < 10 ? 1 : 0)}</text></g>)}
              <line className="energy-zero" x1={margin.left} x2={width - margin.right} y1={zeroY} y2={zeroY} />
              <text className="energy-axis-title" x={margin.left} y={14}>{isLine ? "Teljesítmény (kW)" : "Energia (kWh)"}</text>
              {(temperatureVisible || humidityVisible || hasBatterySoc) && <text className="energy-axis-title" x={width - margin.right} y={14} textAnchor="end">{temperatureVisible || humidityVisible ? "Klíma / akku (°C / %)" : "Akku töltöttség (%)"}</text>}
              {hasBatterySoc && [0, 25, 50, 75, 100].map((value) => <text key={`soc-${value}`} className="energy-axis-label" x={width - margin.right + 12} y={climateY(value, "humidity") + 4}>{value}</text>)}

              {isLine ? lineSeries.map((series) => {
                const coords = points.flatMap((point, index) => Number.isFinite(series.value(point)) ? [{ x: x(index), y: y(Number(series.value(point))) }] : []);
                const path = smoothPath(coords);
                return <g key={series.key}>{series.key === "pv" && coords.length > 1 && <path d={`${path} L${coords.at(-1)?.x},${zeroY} L${coords[0]?.x},${zeroY} Z`} fill="url(#pv-area)" />}<path d={path} fill="none" stroke={series.color} strokeWidth="2.4" vectorEffect="non-scaling-stroke" /></g>;
              }) : points.map((point, index) => {
                const groupWidth = Math.min(54, plotWidth / Math.max(points.length, 1) * .7);
                const available = lineSeries.filter((series) => Number.isFinite(series.value(point)));
                const barWidth = Math.max(3, groupWidth / Math.max(available.length, 1) - 2);
                const center = margin.left + ((index + .5) / points.length) * plotWidth;
                return <g key={`${point.label}-${index}`}>{available.map((series, seriesIndex) => {
                  const value = Number(series.value(point) ?? 0);
                  const barY = value >= 0 ? y(value) : zeroY;
                  const barHeight = Math.max(1, Math.abs(y(value) - zeroY));
                  return <rect key={series.key} x={center - groupWidth / 2 + seriesIndex * (barWidth + 2)} y={barY} width={barWidth} height={barHeight} rx="2" fill={series.color} opacity=".9" />;
                })}</g>;
              })}

              {temperatureVisible && temperatureCoords.length > 1 && <path d={smoothPath(temperatureCoords)} fill="none" stroke={colors.temperature} strokeWidth="2" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />}
              {temperatureVisible && temperatureCoords.map((point, index) => <circle key={`temperature-${index}`} cx={point.x} cy={point.y} r="3" fill={colors.temperature} />)}
              {humidityVisible && humidityCoords.length > 1 && <path d={smoothPath(humidityCoords)} fill="none" stroke={colors.humidity} strokeWidth="2" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />}
              {humidityVisible && humidityCoords.map((point, index) => <circle key={`humidity-${index}`} cx={point.x} cy={point.y} r="3" fill={colors.humidity} />)}
              {hasBatterySoc && <path d={smoothPath(points.flatMap((point, index) => Number.isFinite(point.batterySoc) ? [{ x: x(index), y: climateY(point.batterySoc!, "humidity") }] : []))} fill="none" stroke={colors.batterySoc} strokeWidth="2.2" vectorEffect="non-scaling-stroke" />}

              {points.map((point, index) => (
                <g key={`tick-${point.label}-${index}`}>
                  {(index % tickStep === 0 || index === points.length - 1) && <text className="energy-x-label" x={isLine ? x(index) : margin.left + ((index + .5) / points.length) * plotWidth} y={height - 16} textAnchor="middle">{point.label}</text>}
                  <rect className="chart-hit" x={(isLine ? x(index) : margin.left + ((index + .5) / points.length) * plotWidth) - Math.max(10, plotWidth / points.length / 2)} y={margin.top} width={Math.max(20, plotWidth / points.length)} height={plotHeight} onMouseEnter={() => setHovered(index)} />
                </g>
              ))}
              {hovered !== null && <line className="hover-line" x1={x(hovered)} x2={x(hovered)} y1={margin.top} y2={margin.top + plotHeight} />}
            </svg>
            {active && <div className="chart-tooltip"><strong>{active.label}</strong>{Number.isFinite(active.pv) && <span>PV <b>{formatValue(active.pv!, unit)}</b></span>}{Number.isFinite(active.load) && <span>Fogyasztás <b>{formatValue(active.load!, unit)}</b></span>}{Number.isFinite(active.grid) && <span>Hálózat <b>{formatValue(active.grid!, unit)}</b></span>}{Number.isFinite(batteryChargeValue(active)) && <span>Akkuba töltés <b>{formatValue(Math.abs(batteryChargeValue(active)!), unit)}</b></span>}{Number.isFinite(batteryDischargeValue(active)) && <span>Akkuból leadás <b>{formatValue(batteryDischargeValue(active)!, unit)}</b></span>}{Number.isFinite(active.batterySoc) && <span>Akku töltöttség <b>{active.batterySoc!.toFixed(0)}%</b></span>}{temperatureVisible && Number.isFinite(active.temperature) && <span>{climateIsAverage ? "Átlaghőmérséklet" : "Hőmérséklet"} <b>{active.temperature!.toFixed(1)} °C</b></span>}{humidityVisible && Number.isFinite(active.humidity) && <span>{climateIsAverage ? "Átlagos páratartalom" : "Páratartalom"} <b>{active.humidity!.toFixed(0)}%</b></span>}</div>}
          </>
        ) : <div className="chart-empty"><strong>Nincs adat ebben az időszakban</strong><span>Válassz másik dátumot, vagy várd meg a következő adatfrissítést.</span></div>}
      </div>
    </article>
  );
}
