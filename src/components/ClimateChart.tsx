import { useState, type MouseEvent } from "react";
import { smoothPath } from "../chartUtils";
import type { ClimatePoint } from "../types";

type Props = {
  data: ClimatePoint[];
};

const width = 1000;
const height = 300;
const margin = { top: 24, right: 68, bottom: 48, left: 60 };

export function ClimateChart({ data }: Props) {
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

  const x = (index: number) => margin.left + (data.length === 1 ? plotWidth / 2 : index / (data.length - 1) * plotWidth);
  const temperatureY = (value: number) => margin.top + (tempMax - value) / (tempMax - tempMin) * plotHeight;
  const humidityY = (value: number) => margin.top + (humidityMax - value) / Math.max(humidityMax - humidityMin, 1) * plotHeight;
  const temperaturePath = smoothPath(data.map((point, index) => ({ x: x(index), y: temperatureY(point.temperature) })));
  const humidityPath = smoothPath(data.map((point, index) => ({ x: x(index), y: humidityY(point.humidity) })));
  const ticks = Array.from({ length: 5 }, (_, index) => index / 4);
  const labelStep = Math.max(1, Math.ceil(data.length / 9));
  const active = hovered === null ? null : data[hovered];

  const handlePointer = (event: MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left + event.currentTarget.scrollLeft;
    const ratio = Math.min(1, Math.max(0, pointerX / event.currentTarget.scrollWidth));
    setHovered(Math.round(ratio * (data.length - 1)));
  };

  return (
    <div className="climate-history-chart" onMouseMove={handlePointer} onMouseLeave={() => setHovered(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Hőmérséklet és páratartalom alakulása">
        {ticks.map((ratio) => {
          const y = margin.top + ratio * plotHeight;
          const temperature = tempMax - ratio * (tempMax - tempMin);
          const humidity = humidityMax - ratio * (humidityMax - humidityMin);
          return <g key={ratio}><line className="climate-gridline" x1={margin.left} x2={width - margin.right} y1={y} y2={y} /><text className="climate-axis climate-axis--temperature" x={margin.left - 11} y={y + 4} textAnchor="end">{temperature.toFixed(0)} °C</text><text className="climate-axis climate-axis--humidity" x={width - margin.right + 11} y={y + 4}>{humidity.toFixed(0)}%</text></g>;
        })}
        <path className="climate-line climate-line--temperature" d={temperaturePath} />
        <path className="climate-line climate-line--humidity" d={humidityPath} />
        {data.length === 1 && <><circle className="climate-point climate-point--temperature" cx={x(0)} cy={temperatureY(data[0].temperature)} r="4" /><circle className="climate-point climate-point--humidity" cx={x(0)} cy={humidityY(data[0].humidity)} r="4" /></>}
        {hovered !== null && <line className="climate-hover-line" x1={x(hovered)} x2={x(hovered)} y1={margin.top} y2={height - margin.bottom} />}
        {hovered !== null && <><circle className="climate-point climate-point--temperature" cx={x(hovered)} cy={temperatureY(data[hovered].temperature)} r="4" /><circle className="climate-point climate-point--humidity" cx={x(hovered)} cy={humidityY(data[hovered].humidity)} r="4" /></>}
        {data.map((point, index) => (index % labelStep === 0 || index === data.length - 1) && <text key={`${point.label}-${index}`} className="climate-x-label" x={x(index)} y={height - 18} textAnchor={index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"}>{point.label}</text>)}
      </svg>
      {active && <div className="climate-tooltip"><strong>{active.label}</strong><span><i className="is-temperature" />Hőmérséklet <b>{active.temperature.toFixed(1)} °C</b></span><span><i className="is-humidity" />Páratartalom <b>{active.humidity.toFixed(0)}%</b></span></div>}
    </div>
  );
}
