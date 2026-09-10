import { useState, type MouseEvent } from "react";
import { smoothPath } from "../chartUtils";
import { formatFixedNumber } from "../formatUtils";
import type { ClimatePoint, PeriodKey } from "../types";

type Props = {
  data: ClimatePoint[];
  period: PeriodKey;
  temperatureVisible: boolean;
  humidityVisible: boolean;
};

const width = 1000;
const height = 300;
const margin = { top: 24, right: 68, bottom: 48, left: 60 };
const timeFormatter = new Intl.DateTimeFormat("hu-HU", { hour: "2-digit", minute: "2-digit" });
const dayTimeTicks = Array.from({ length: 9 }, (_, index) => ({
  ratio: index / 8,
  label: `${String(index * 3).padStart(2, "0")}:00`,
}));

export function ClimateChart({ data, period, temperatureVisible, humidityVisible }: Props) {
  const [hovered, setHovered] = useState<number | null>(null);
  if (!data.length) return <div className="climate-chart-empty">Ehhez az időszakhoz még nincs klímaadat.</div>;

  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const temperatures = data.map((point) => point.temperature);
  const humidities = data.map((point) => point.humidity);
  let tempMin = Math.floor(Math.min(...temperatures) - 1);
  let tempMax = Math.ceil(Math.max(...temperatures) + 1);
  if (tempMax - tempMin < 4) {
    tempMin -= 1;
    tempMax += 1;
  }
  let humidityMin = Math.max(0, Math.floor((Math.min(...humidities) - 5) / 5) * 5);
  let humidityMax = Math.min(100, Math.ceil((Math.max(...humidities) + 5) / 5) * 5);
  if (humidityMax - humidityMin < 20) {
    humidityMin = Math.max(0, humidityMin - 5);
    humidityMax = Math.min(100, humidityMax + 5);
  }

  const firstTimestamp = data.find((point) => point.timestamp)?.timestamp;
  const dayStart = firstTimestamp ? new Date(firstTimestamp) : undefined;
  dayStart?.setHours(0, 0, 0, 0);
  const dayEnd = dayStart ? new Date(dayStart) : undefined;
  dayEnd?.setDate(dayEnd.getDate() + 1);
  const x = (index: number) => {
    const timestamp = data[index]?.timestamp;
    if (period === "day" && timestamp && dayStart && dayEnd) {
      const ratio = (new Date(timestamp).getTime() - dayStart.getTime()) / Math.max(dayEnd.getTime() - dayStart.getTime(), 1);
      return margin.left + Math.min(1, Math.max(0, ratio)) * plotWidth;
    }
    return margin.left + (data.length === 1 ? plotWidth / 2 : index / (data.length - 1) * plotWidth);
  };
  const temperatureY = (value: number) => margin.top + (tempMax - value) / (tempMax - tempMin) * plotHeight;
  const humidityY = (value: number) => margin.top + (humidityMax - value) / Math.max(humidityMax - humidityMin, 1) * plotHeight;
  const temperaturePath = smoothPath(data.map((point, index) => ({ x: x(index), y: temperatureY(point.temperature) })));
  const humidityPath = smoothPath(data.map((point, index) => ({ x: x(index), y: humidityY(point.humidity) })));
  const ticks = Array.from({ length: 5 }, (_, index) => index / 4);
  const labelStep = Math.max(1, Math.ceil(data.length / 9));
  const active = hovered === null ? null : data[hovered];
  const activeLabel = active?.timestamp && period === "day" ? `Időpont: ${timeFormatter.format(new Date(active.timestamp))}` : active?.label;

  const handlePointer = (event: MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left + event.currentTarget.scrollLeft;
    const viewBoxX = pointerX / event.currentTarget.scrollWidth * width;
    const nearestIndex = data.reduce((nearest, _point, index) => Math.abs(x(index) - viewBoxX) < Math.abs(x(nearest) - viewBoxX) ? index : nearest, 0);
    setHovered(nearestIndex);
  };

  return (
    <div className="climate-history-chart" onMouseMove={handlePointer} onMouseLeave={() => setHovered(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Hőmérséklet és páratartalom alakulása">
        {ticks.map((ratio) => {
          const y = margin.top + ratio * plotHeight;
          const temperature = tempMax - ratio * (tempMax - tempMin);
          const humidity = humidityMax - ratio * (humidityMax - humidityMin);
          return <g key={ratio}><line className="climate-gridline" x1={margin.left} x2={width - margin.right} y1={y} y2={y} />{temperatureVisible && <text className="climate-axis climate-axis--temperature" x={margin.left - 11} y={y + 4} textAnchor="end">{formatFixedNumber(temperature, 0)} °C</text>}{humidityVisible && <text className="climate-axis climate-axis--humidity" x={width - margin.right + 11} y={y + 4}>{formatFixedNumber(humidity, 0)}%</text>}</g>;
        })}
        {temperatureVisible && <path className="climate-line climate-line--temperature" d={temperaturePath} />}
        {humidityVisible && <path className="climate-line climate-line--humidity" d={humidityPath} />}
        {data.length === 1 && <>{temperatureVisible && <circle className="climate-point climate-point--temperature" cx={x(0)} cy={temperatureY(data[0].temperature)} r="4" />}{humidityVisible && <circle className="climate-point climate-point--humidity" cx={x(0)} cy={humidityY(data[0].humidity)} r="4" />}</>}
        {hovered !== null && <line className="climate-hover-line" x1={x(hovered)} x2={x(hovered)} y1={margin.top} y2={height - margin.bottom} />}
        {hovered !== null && <>{temperatureVisible && <circle className="climate-point climate-point--temperature" cx={x(hovered)} cy={temperatureY(data[hovered].temperature)} r="4" />}{humidityVisible && <circle className="climate-point climate-point--humidity" cx={x(hovered)} cy={humidityY(data[hovered].humidity)} r="4" />}</>}
        {period === "day" ? dayTimeTicks.map((tick, index) => {
          const tickX = margin.left + tick.ratio * plotWidth;
          return <g key={tick.label}><line className="climate-time-gridline" x1={tickX} x2={tickX} y1={margin.top} y2={height - margin.bottom} /><text className="climate-x-label" x={tickX} y={height - 18} textAnchor={index === 0 ? "start" : index === dayTimeTicks.length - 1 ? "end" : "middle"}>{tick.label}</text></g>;
        }) : data.map((point, index) => (index % labelStep === 0 || index === data.length - 1) && <text key={`${point.label}-${index}`} className="climate-x-label" x={x(index)} y={height - 18} textAnchor={index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"}>{point.label}</text>)}
      </svg>
      {!temperatureVisible && !humidityVisible && <div className="climate-lines-hidden">Kapcsolj vissza egy adatsort a jelmagyarázatban.</div>}
      {active && (temperatureVisible || humidityVisible) && <div className="climate-tooltip"><strong>{activeLabel}</strong>{temperatureVisible && <span><i className="is-temperature" />Hőmérséklet <b>{formatFixedNumber(active.temperature, 1)} °C</b></span>}{humidityVisible && <span><i className="is-humidity" />Páratartalom <b>{formatFixedNumber(active.humidity, 0)}%</b></span>}</div>}
    </div>
  );
}
