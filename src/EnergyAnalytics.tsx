import { useMemo, useState } from "react";
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
  pv: "#ff9f43",
  grid: "#5d7cff",
  battery: "#38bdf8",
  load: "#d9c600",
  batterySoc: "#0d9a7a",
  temperature: "#f36f45",
  humidity: "#6d58d9",
};

function startOfWeek(value: Date) {
  const date = new Date(value);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfWeek(value: Date) {
  const date = startOfWeek(value);
  date.setDate(date.getDate() + 6);
  return date;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function periodLabel(period: PeriodKey, anchor: Date, customStart: string, customEnd: string) {
  const day = new Intl.DateTimeFormat("hu-HU", { year: "numeric", month: "long", day: "numeric" });
  if (period === "day") return day.format(anchor);
  if (period === "week") return `${day.format(startOfWeek(anchor))} – ${day.format(endOfWeek(anchor))}`;
  if (period === "month") return new Intl.DateTimeFormat("hu-HU", { year: "numeric", month: "long" }).format(anchor);
  if (period === "year") return `${anchor.getFullYear()}`;
  const from = customStart ? day.format(new Date(`${customStart}T12:00:00`)) : "–";
  const to = customEnd ? day.format(new Date(`${customEnd}T12:00:00`)) : "–";
  return `${from} – ${to}`;
}

function withinSelectedPeriod(point: EnergyChartPoint, period: PeriodKey, anchor: Date, customStart: string, customEnd: string) {
  if (!point.timestamp) return true;
  const time = new Date(point.timestamp);
  if (period === "day") return sameDay(time, anchor);
  if (period === "week") return time >= startOfWeek(anchor) && time <= new Date(endOfWeek(anchor).setHours(23, 59, 59, 999));
  if (period === "month") return time.getFullYear() === anchor.getFullYear() && time.getMonth() === anchor.getMonth();
  if (period === "year") return time.getFullYear() === anchor.getFullYear();
  if (!customStart || !customEnd) return true;
  return time >= new Date(`${customStart}T00:00:00`) && time <= new Date(`${customEnd}T23:59:59`);
}

function smoothPath(points: { x: number; y: number }[]) {
  if (!points.length) return "";
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index];
    const mid = (previous.x + point.x) / 2;
    return `${path} C${mid},${previous.y} ${mid},${point.y} ${point.x},${point.y}`;
  }, `M${points[0].x},${points[0].y}`);
}

function formatValue(value: number, unit: string) {
  return `${value.toLocaleString("hu-HU", { maximumFractionDigits: 2 })} ${unit}`;
}

function climateBucketKey(timestamp: string, period: PeriodKey) {
  const time = new Date(timestamp);
  const year = time.getFullYear();
  const month = String(time.getMonth() + 1).padStart(2, "0");
  if (period === "year") return `${year}-${month}`;
  return `${year}-${month}-${String(time.getDate()).padStart(2, "0")}`;
}

function averageClimateByPeriod(climate: DashboardData["govee"]["chart"], period: PeriodKey) {
  if (period === "day" || !climate.every((point) => point.timestamp)) return climate;

  const grouped = new Map<string, {
    first: DashboardData["govee"]["chart"][number];
    temperatureTotal: number;
    temperatureCount: number;
    humidityTotal: number;
    humidityCount: number;
  }>();

  for (const point of climate) {
    const key = climateBucketKey(point.timestamp!, period);
    const group = grouped.get(key) ?? {
      first: point,
      temperatureTotal: 0,
      temperatureCount: 0,
      humidityTotal: 0,
      humidityCount: 0,
    };
    if (Number.isFinite(point.temperature)) {
      group.temperatureTotal += point.temperature;
      group.temperatureCount += 1;
    }
    if (Number.isFinite(point.humidity)) {
      group.humidityTotal += point.humidity;
      group.humidityCount += 1;
    }
    grouped.set(key, group);
  }

  return [...grouped.values()].map((group) => ({
    ...group.first,
    temperature: group.temperatureCount ? group.temperatureTotal / group.temperatureCount : group.first.temperature,
    humidity: group.humidityCount ? group.humidityTotal / group.humidityCount : group.first.humidity,
  }));
}

export function EnergyAnalytics({ data, period, anchor, customStart, customEnd, onPeriodChange, onStep, onCustomChange }: Props) {
  const [temperatureVisible, setTemperatureVisible] = useState(false);
  const [humidityVisible, setHumidityVisible] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);

  const rawPoints = useMemo<EnergyChartPoint[]>(() => {
    const climate = averageClimateByPeriod(data.govee.chart, period);
    const energy: EnergyChartPoint[] = data.solar.energyChart ?? data.solar.chart.map((point, index) => ({
      label: point.label,
      pv: point.value,
      temperature: climate[index]?.temperature,
      humidity: climate[index]?.humidity,
    }));
    const merged = energy.map((point) => ({ ...point }));

    for (const climatePoint of climate) {
      let match = -1;
      if (climatePoint.timestamp) {
        const climateTime = new Date(climatePoint.timestamp).getTime();
        if (period === "day") {
          let smallestDistance = 11 * 60_000;
          merged.forEach((point, index) => {
            if (!point.timestamp) return;
            const distance = Math.abs(new Date(point.timestamp).getTime() - climateTime);
            if (distance < smallestDistance) {
              smallestDistance = distance;
              match = index;
            }
          });
        } else {
          const key = climateBucketKey(climatePoint.timestamp, period);
          match = merged.findIndex((point) => point.timestamp && climateBucketKey(point.timestamp, period) === key);
        }
      }
      if (match < 0 && climate.length === merged.length) match = climate.indexOf(climatePoint);

      if (match >= 0) {
        merged[match] = {
          ...merged[match],
          temperature: climatePoint.temperature,
          humidity: climatePoint.humidity,
        };
      } else {
        merged.push({
          label: climatePoint.label,
          timestamp: climatePoint.timestamp,
          temperature: climatePoint.temperature,
          humidity: climatePoint.humidity,
        });
      }
    }

    return merged.sort((a, b) => {
      if (!a.timestamp || !b.timestamp) return 0;
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    });
  }, [data, period]);

  const points = useMemo(
    () => rawPoints.filter((point) => withinSelectedPeriod(point, period, anchor, customStart, customEnd)),
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
  const values = points.flatMap((point) => [point.pv, point.grid, point.battery, point.load].filter((value): value is number => Number.isFinite(value)));
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
  const today = new Date();
  const nextDisabled = period !== "custom" && (
    (period === "day" && sameDay(anchor, today))
    || (period === "week" && sameDay(startOfWeek(anchor), startOfWeek(today)))
    || (period === "month" && anchor.getFullYear() === today.getFullYear() && anchor.getMonth() === today.getMonth())
    || (period === "year" && anchor.getFullYear() === today.getFullYear())
  );

  const lineSeries = [
    { key: "pv" as const, label: "PV", color: colors.pv },
    { key: "grid" as const, label: "Hálózat", color: colors.grid },
    { key: "battery" as const, label: "Akkumulátor", color: colors.battery },
    { key: "load" as const, label: "Fogyasztás", color: colors.load },
  ].filter((series) => points.some((point) => Number.isFinite(point[series.key])));

  return (
    <article className="energy-analysis card">
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
        {points.some((point) => Number.isFinite(point.batterySoc)) && <span><i style={{ background: colors.batterySoc }} />Akkumulátor töltöttség</span>}
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
              {(temperatureVisible || humidityVisible) && <text className="energy-axis-title" x={width - margin.right} y={14} textAnchor="end">Klíma (°C / %)</text>}

              {isLine ? lineSeries.map((series) => {
                const coords = points.flatMap((point, index) => Number.isFinite(point[series.key]) ? [{ x: x(index), y: y(Number(point[series.key])) }] : []);
                const path = smoothPath(coords);
                return <g key={series.key}>{series.key === "pv" && coords.length > 1 && <path d={`${path} L${coords.at(-1)?.x},${zeroY} L${coords[0]?.x},${zeroY} Z`} fill="url(#pv-area)" />}<path d={path} fill="none" stroke={series.color} strokeWidth="2.4" vectorEffect="non-scaling-stroke" /></g>;
              }) : points.map((point, index) => {
                const groupWidth = Math.min(54, plotWidth / Math.max(points.length, 1) * .7);
                const available = lineSeries.filter((series) => Number.isFinite(point[series.key]));
                const barWidth = Math.max(3, groupWidth / Math.max(available.length, 1) - 2);
                const center = margin.left + ((index + .5) / points.length) * plotWidth;
                return <g key={`${point.label}-${index}`}>{available.map((series, seriesIndex) => {
                  const value = Number(point[series.key] ?? 0);
                  const barY = value >= 0 ? y(value) : zeroY;
                  const barHeight = Math.max(1, Math.abs(y(value) - zeroY));
                  return <rect key={series.key} x={center - groupWidth / 2 + seriesIndex * (barWidth + 2)} y={barY} width={barWidth} height={barHeight} rx="2" fill={series.color} opacity=".9" />;
                })}</g>;
              })}

              {temperatureVisible && temperatureCoords.length > 1 && <path d={smoothPath(temperatureCoords)} fill="none" stroke={colors.temperature} strokeWidth="2" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />}
              {temperatureVisible && temperatureCoords.map((point, index) => <circle key={`temperature-${index}`} cx={point.x} cy={point.y} r="3" fill={colors.temperature} />)}
              {humidityVisible && humidityCoords.length > 1 && <path d={smoothPath(humidityCoords)} fill="none" stroke={colors.humidity} strokeWidth="2" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />}
              {humidityVisible && humidityCoords.map((point, index) => <circle key={`humidity-${index}`} cx={point.x} cy={point.y} r="3" fill={colors.humidity} />)}
              {points.some((point) => Number.isFinite(point.batterySoc)) && <path d={smoothPath(points.flatMap((point, index) => Number.isFinite(point.batterySoc) ? [{ x: x(index), y: climateY(point.batterySoc!, "humidity") }] : []))} fill="none" stroke={colors.batterySoc} strokeWidth="2.2" vectorEffect="non-scaling-stroke" />}

              {points.map((point, index) => (
                <g key={`tick-${point.label}-${index}`}>
                  {(index % tickStep === 0 || index === points.length - 1) && <text className="energy-x-label" x={isLine ? x(index) : margin.left + ((index + .5) / points.length) * plotWidth} y={height - 16} textAnchor="middle">{point.label}</text>}
                  <rect className="chart-hit" x={(isLine ? x(index) : margin.left + ((index + .5) / points.length) * plotWidth) - Math.max(10, plotWidth / points.length / 2)} y={margin.top} width={Math.max(20, plotWidth / points.length)} height={plotHeight} onMouseEnter={() => setHovered(index)} />
                </g>
              ))}
              {hovered !== null && <line className="hover-line" x1={x(hovered)} x2={x(hovered)} y1={margin.top} y2={margin.top + plotHeight} />}
            </svg>
            {active && <div className="chart-tooltip"><strong>{active.label}</strong>{Number.isFinite(active.pv) && <span>PV <b>{formatValue(active.pv!, unit)}</b></span>}{Number.isFinite(active.load) && <span>Fogyasztás <b>{formatValue(active.load!, unit)}</b></span>}{Number.isFinite(active.grid) && <span>Hálózat <b>{formatValue(active.grid!, unit)}</b></span>}{temperatureVisible && Number.isFinite(active.temperature) && <span>{climateIsAverage ? "Átlaghőmérséklet" : "Hőmérséklet"} <b>{active.temperature!.toFixed(1)} °C</b></span>}{humidityVisible && Number.isFinite(active.humidity) && <span>{climateIsAverage ? "Átlagos páratartalom" : "Páratartalom"} <b>{active.humidity!.toFixed(0)}%</b></span>}</div>}
          </>
        ) : <div className="chart-empty"><strong>Nincs adat ebben az időszakban</strong><span>Válassz másik dátumot, vagy várd meg a következő adatfrissítést.</span></div>}
      </div>
    </article>
  );
}
