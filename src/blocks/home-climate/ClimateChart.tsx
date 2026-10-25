import { useState, type MouseEvent } from "react";
import { formatFixedNumber } from "../../formatUtils";
import { dateTimeFormatter, dayFraction, dayTicks } from "../../timeZone";
import type { ClimatePoint, PeriodKey } from "../../types";
import { connectedSampleGap, observationSegments } from "../../observationQuality";

type Props = { data: ClimatePoint[]; period: PeriodKey; temperatureVisible: boolean; humidityVisible: boolean };
const time = dateTimeFormatter({ month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const width = 1000, left = 72, right = 25, plotWidth = width - left - right;
export function ClimateChart({ data, period, temperatureVisible, humidityVisible }: Props) {
  const [hovered, setHovered] = useState<number | null>(null);
  if (!data.length) return <div className="climate-chart-empty">Ehhez az időszakhoz még nincs klímaadat.</div>;
  const daily = period === "day";
  const first = Date.parse(data[0].timestamp ?? ""), last = Date.parse(data.at(-1)?.timestamp ?? "");
  const x = (index: number) => left + (daily && data[index].timestamp ? dayFraction(data[index].timestamp!) : Number.isFinite(first) && Number.isFinite(last) && last > first && data[index].timestamp ? (Date.parse(data[index].timestamp!) - first) / (last - first) : data.length > 1 ? index / (data.length - 1) : .5) * plotWidth;
  const panels = [
    ...(temperatureVisible ? [{ key: "temperature" as const, label: "Hőmérséklet", unit: "°C", color: "var(--series-temperature)" }] : []),
    ...(humidityVisible ? [{ key: "humidity" as const, label: "Páratartalom", unit: "%", color: "var(--series-humidity)" }] : []),
  ];
  const mean = (point: ClimatePoint, key: "temperature" | "humidity") => daily ? point[key] : point[`${key}Mean`] ?? point[key];
  const gap = daily ? connectedSampleGap(data, 30 * 60_000, 6 * 3_600_000) : period === "year" ? 32 * 86_400_000 : 36 * 3_600_000;
  const height = Math.max(1, panels.length) * 170 + 38;
  const active = hovered === null ? undefined : data[hovered];
  const move = (event: MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const cursor = (event.clientX - bounds.left + event.currentTarget.scrollLeft) / event.currentTarget.scrollWidth * width;
    const index = data.reduce((best, _, i) => Math.abs(x(i) - cursor) < Math.abs(x(best) - cursor) ? i : best, 0);
    setHovered(Math.abs(x(index) - cursor) <= (daily ? plotWidth / 96 : 30) ? index : null);
  };
  return <div className="climate-history-chart" onMouseMove={move} onMouseLeave={() => setHovered(null)}>
    {!daily && <p className="chart-explanation">Vonal: átlag · halvány sáv: mért minimum–maximum. A sáv nem előrejelzési bizonytalanság.</p>}
    {!panels.length ? <p>Kapcsolj vissza egy adatsort a jelmagyarázatban.</p> : <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Hőmérséklet és páratartalom külön grafikonon, közös időtengellyel">
      {panels.map((panel, panelIndex) => {
        const top = panelIndex * 170 + 30, bottom = top + 120;
        const amounts = data.flatMap((p) => [mean(p, panel.key), p[`${panel.key}Min`], p[`${panel.key}Max`]]).filter((v): v is number => Number.isFinite(v));
        const min = panel.key === "humidity" ? Math.max(0, Math.floor(Math.min(...amounts) - 5)) : Math.floor(Math.min(...amounts) - 1);
        const max = panel.key === "humidity" ? Math.min(100, Math.ceil(Math.max(...amounts) + 5)) : Math.ceil(Math.max(...amounts) + 1);
        const y = (value: number) => bottom - (value - min) / Math.max(1, max - min) * 120;
        const segments = observationSegments(data, (p) => mean(p, panel.key), gap);
        return <g key={panel.key}>
          <text className="energy-axis-title" x={left} y={top - 12}>{panel.label} ({panel.unit}){daily ? "" : " · átlag és tartomány"}</text>
          {[min, (min + max) / 2, max].map((v) => <g key={v}><line className="climate-gridline" x1={left} x2={width - right} y1={y(v)} y2={y(v)} /><text className="climate-axis" x={left - 12} y={y(v) + 4} textAnchor="end">{formatFixedNumber(v, 1)}</text></g>)}
          {segments.map((segment, i) => {
            const upper = segment.map(({ point, index }) => `${x(index)},${y(point[`${panel.key}Max`] ?? mean(point, panel.key))}`);
            const lower = [...segment].reverse().map(({ point, index }) => `${x(index)},${y(point[`${panel.key}Min`] ?? mean(point, panel.key))}`);
            return <g key={i}>{!daily && <polygon points={[...upper, ...lower].join(" ")} fill={panel.color} opacity=".16" />}
              <polyline points={segment.map(({ index, value }) => `${x(index)},${y(value)}`).join(" ")} stroke={panel.color} strokeWidth="2" fill="none" vectorEffect="non-scaling-stroke" />
              {segment.length === 1 && <circle cx={x(segment[0].index)} cy={y(segment[0].value)} r="3" fill={panel.color} />}
            </g>;
          })}
          {active && hovered !== null && <><line className="climate-hover-line" x1={x(hovered)} x2={x(hovered)} y1={top} y2={bottom} /><circle cx={x(hovered)} cy={y(mean(active, panel.key))} r="4" fill={panel.color} /></>}
        </g>;
      })}
      {daily ? dayTicks(data[0].timestamp ?? new Date()).map((tick) => <text className="climate-x-label" key={tick.label} x={left + tick.ratio * plotWidth} y={height - 10} textAnchor="middle">{tick.label}</text>) : data.map((p, i) => (i % Math.max(1, Math.ceil(data.length / 8)) === 0 || i === data.length - 1) && <text key={i} className="climate-x-label" x={x(i)} y={height - 10} textAnchor="middle">{p.label}</text>)}
    </svg>}
    {active && panels.length > 0 && <div className="climate-tooltip"><strong>{active.timestamp ? time.format(new Date(active.timestamp)) : active.label}</strong>{panels.map((panel) => <span key={panel.key}>{panel.label}<b>{formatFixedNumber(mean(active, panel.key), 1)} {panel.unit}{!daily && Number.isFinite(active[`${panel.key}Min`]) ? ` · ${formatFixedNumber(active[`${panel.key}Min`]!, 1)}–${formatFixedNumber(active[`${panel.key}Max`]!, 1)}` : ""}</b></span>)}</div>}
  </div>;
}
