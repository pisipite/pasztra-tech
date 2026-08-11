import { useMemo, useState } from "react";
import { smoothPath } from "./chartUtils";
import type { DashboardData, SolarForecastPoint } from "./types";

type Props = { data: DashboardData };

function timePosition(label: string) {
  const [hour = 0, minute = 0] = label.split(":").map(Number);
  return (hour * 60 + minute) / 1440;
}

export function SolarForecast({ data }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const forecast = data.forecast;
  const selectedDay = forecast?.days[Math.min(selectedIndex, Math.max(0, forecast.days.length - 1))];

  const actual = useMemo(() => {
    if (!selectedDay || selectedIndex !== 0) return [];
    return (data.solar.energyChart ?? [])
      .filter((point) => point.label.includes(":") && Number.isFinite(point.pv))
      .map((point) => ({ label: point.label, value: Number(point.pv) }));
  }, [data.solar.energyChart, selectedDay, selectedIndex]);

  if (!forecast || !selectedDay) {
    return <article className="forecast-card card"><div><p className="eyebrow">Termelési előrejelzés</p><h2>Az időjárási becslés a következő frissítéssel érkezik.</h2></div></article>;
  }

  const width = 1000;
  const height = 300;
  const margin = { top: 25, right: 26, bottom: 42, left: 58 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maximum = Math.max(forecast.systemKwp, ...selectedDay.points.map((point) => point.expectedPowerKw), ...actual.map((point) => point.value), 1);
  const x = (label: string) => margin.left + timePosition(label) * plotWidth;
  const y = (value: number) => margin.top + (1 - value / maximum) * plotHeight;
  const expectedCoords = selectedDay.points.map((point) => ({ x: x(point.label), y: y(point.expectedPowerKw) }));
  const actualCoords = actual.map((point) => ({ x: x(point.label), y: y(point.value) }));
  const daylightPoints = selectedDay.points.filter((point) => point.irradianceWm2 > 0);
  const averageCloud = daylightPoints.length ? daylightPoints.reduce((sum, point) => sum + point.cloudCoverPct, 0) / daylightPoints.length : 0;
  const rainChance = Math.max(0, ...selectedDay.points.map((point) => point.precipitationProbabilityPct));
  const peakIrradiance = Math.max(0, ...selectedDay.points.map((point) => point.irradianceWm2));
  const active: SolarForecastPoint | undefined = hovered === null ? undefined : selectedDay.points[hovered];
  const gridValues = [0, maximum / 2, maximum];

  return (
    <article className="forecast-card card">
      <span className="sun-charm sun-charm--forecast" aria-hidden="true"><i /></span>
      <div className="forecast-head">
        <div>
          <p className="eyebrow">Open-Meteo · 72 óra</p>
          <h2>Termelési előrejelzés</h2>
          <p className="forecast-subtitle">5 kWp rendszer · becsült 27° dőlés · dél–délnyugati tájolás</p>
        </div>
        <div className="forecast-tabs" role="tablist" aria-label="Előrejelzési nap">
          {forecast.days.map((day, index) => <button key={day.date} role="tab" aria-selected={selectedIndex === index} className={selectedIndex === index ? "active" : ""} onClick={() => { setSelectedIndex(index); setHovered(null); }}>{day.label}</button>)}
        </div>
      </div>

      <div className="forecast-summary">
        <div><span>Várható termelés</span><strong>{selectedDay.expectedKwh.toFixed(1)} <small>kWh</small></strong></div>
        <div><span>Legjobb fogyasztási időszak</span><strong>{selectedDay.bestWindow}</strong></div>
        <div><span>Nappali felhőzet</span><strong>{averageCloud.toFixed(0)}<small>%</small></strong></div>
        <div><span>Csapadék esélye</span><strong>{rainChance.toFixed(0)}<small>%</small></strong></div>
        <div><span>Csúcsbesugárzás</span><strong>{peakIrradiance.toFixed(0)} <small>W/m²</small></strong></div>
      </div>

      <div className="forecast-legend">
        {actual.length > 1 && <span><i className="actual" />Tényleges termelés</span>}
        <span><i className="expected" />Időjárás alapján várható</span>
      </div>

      <div className="forecast-chart" onMouseLeave={() => setHovered(null)}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${selectedDay.label}: ${selectedDay.expectedKwh.toFixed(1)} kilowattóra várható termelés`}>
          <defs><linearGradient id="forecast-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#d8902f" stopOpacity=".22" /><stop offset="100%" stopColor="#d8902f" stopOpacity=".02" /></linearGradient></defs>
          {gridValues.map((value) => <g key={value}><line className="forecast-gridline" x1={margin.left} x2={width - margin.right} y1={y(value)} y2={y(value)} /><text className="forecast-axis-label" x={margin.left - 10} y={y(value) + 4} textAnchor="end">{value.toFixed(1)}</text></g>)}
          <text className="forecast-axis-title" x={margin.left} y={14}>Teljesítmény (kW)</text>
          <path d={`${smoothPath(expectedCoords)} L${expectedCoords.at(-1)?.x},${y(0)} L${expectedCoords[0]?.x},${y(0)} Z`} fill="url(#forecast-area)" />
          <path className="forecast-line forecast-line--expected" d={smoothPath(expectedCoords)} />
          {actualCoords.length > 1 && <path className="forecast-line forecast-line--actual" d={smoothPath(actualCoords)} />}
          {selectedDay.points.map((point, index) => <g key={point.timestamp}>
            {index % 3 === 0 && <text className="forecast-x-label" x={x(point.label)} y={height - 15} textAnchor="middle">{point.label.slice(0, 2)}</text>}
            <rect className="forecast-hit" x={x(point.label) - plotWidth / 48} y={margin.top} width={plotWidth / 24} height={plotHeight} onMouseEnter={() => setHovered(index)} />
          </g>)}
          {active && <><line className="forecast-hover" x1={x(active.label)} x2={x(active.label)} y1={margin.top} y2={margin.top + plotHeight} /><circle cx={x(active.label)} cy={y(active.expectedPowerKw)} r="4" className="forecast-marker" /></>}
        </svg>
        {active && <div className="forecast-tooltip"><strong>{active.label}</strong><span>Várható <b>{active.expectedPowerKw.toFixed(2)} kW</b></span><span>Besugárzás <b>{active.irradianceWm2.toFixed(0)} W/m²</b></span><span>Felhőzet <b>{active.cloudCoverPct.toFixed(0)}%</b></span><span>Csapadék <b>{active.precipitationProbabilityPct.toFixed(0)}%</b></span></div>}
      </div>
      <p className="forecast-note">Az előrejelzés időjárási modellből készült becslés; a helyi hegyoldal árnyékolása eltérést okozhat.</p>
    </article>
  );
}
