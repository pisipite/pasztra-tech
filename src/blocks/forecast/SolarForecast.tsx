import { useEffect, useMemo, useState } from "react";
import { smoothPath } from "../../chartUtils";
import { BackToTop } from "../../components/BackToTop";
import { formatFixedNumber, formatTime } from "../../formatUtils";
import { dateKey, dayFraction, dayTicks, parseLocalDateTime } from "../../timeZone";
import type { DashboardData, SolarForecastPoint } from "../../types";
import "./forecast.css";
import { observedPoints, observationSegments } from "../../observationQuality";
import { DataFreshness } from "../../components/DataFreshness";

import { remainingForecast } from "./forecastSummary";

type Props = { data: DashboardData };

function timePosition(label: string) {
  const [hour = 0, minute = 0] = label.split(":").map(Number);
  return (hour * 60 + minute) / 1440;
}

function ForecastSource({ demo = false }: { demo?: boolean }) {
  return <p className="forecast-note forecast-source">
    {demo ? "Mintaadatok. Élő módban az időjárási adatok forrása: " : "Időjárási adatok forrása: "}
    <a href="https://open-meteo.com/en/docs" target="_blank" rel="noreferrer">Open-Meteo</a>
    {demo ? "." : " · órás besugárzás, felhőzet és csapadékvalószínűség. A termelési becslés ezekből készül."}
  </p>;
}

export function SolarForecast({ data }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const [baseLoad, setBaseLoad] = useState(.25);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);
  const forecast = data.forecast;
  const selectedDay = forecast?.days[Math.min(selectedIndex, Math.max(0, forecast.days.length - 1))];

  const actual = useMemo(() => {
    if (!selectedDay || selectedIndex !== 0) return [];
    return observedPoints(data.solar.energyChart ?? [], data.connections?.solar.updatedAt ?? data.updatedAt)
      .filter((point) => point.timestamp && dateKey(point.timestamp) === selectedDay.date)
      .map((point) => ({ label: point.timestamp ? formatTime(point.timestamp) : point.label, timestamp: point.timestamp, value: Number.isFinite(point.pv) ? point.pv! : Number.NaN }));
  }, [data.solar.energyChart, data.connections?.solar.updatedAt, data.updatedAt, selectedDay, selectedIndex]);

  if (!forecast || !selectedDay) {
    return <article className="forecast-card card" id="elojelzes"><div className="forecast-head section-header"><div className="section-header__lead"><div className="section-kicker"><p className="eyebrow">Előrejelzés</p><BackToTop /></div><h2>Termelési előrejelzés</h2><p className="forecast-subtitle">Az időjárási becslés a következő frissítéssel érkezik.</p></div></div><ForecastSource demo={data.source === "demo"} /></article>;
  }

  const remainder = remainingForecast(selectedDay.points, clock, baseLoad);
  const today = selectedDay.date === dateKey(clock);
  const width = 1000;
  const height = 300;
  const margin = { top: 25, right: 26, bottom: 42, left: 58 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maximum = Math.max(forecast.systemKwp, ...selectedDay.points.map((point) => point.expectedPowerKw), ...actual.map((point) => point.value).filter(Number.isFinite), 1);
  const x = (point: { label: string; timestamp?: string }) => margin.left + (point.timestamp ? dayFraction(point.timestamp) : timePosition(point.label)) * plotWidth;
  const y = (value: number) => margin.top + (1 - value / maximum) * plotHeight;
  const expectedCoords = selectedDay.points.map((point) => ({ x: x(point), y: y(point.expectedPowerKw) }));
  const actualSegments = observationSegments(actual, (point) => point.value, 15 * 60_000);
  const daylightPoints = selectedDay.points.filter((point) => point.irradianceWm2 > 0);
  const averageCloud = daylightPoints.length ? daylightPoints.reduce((sum, point) => sum + point.cloudCoverPct, 0) / daylightPoints.length : 0;
  const rainChance = Math.max(0, ...selectedDay.points.map((point) => point.precipitationProbabilityPct));
  const peakIrradiance = Math.max(0, ...selectedDay.points.map((point) => point.irradianceWm2));
  const active: SolarForecastPoint | undefined = hovered === null ? undefined : selectedDay.points[hovered];
  const gridValues = [0, maximum / 2, maximum];

  return (
    <article className="forecast-card card" id="elojelzes">
      <span className="sun-charm sun-charm--forecast" aria-hidden="true"><i /></span>
      <div className="forecast-head section-header">
        <div className="section-header__lead">
          <div className="section-kicker"><p className="eyebrow">Előrejelzés</p><BackToTop /></div>
          <h2>Termelési előrejelzés</h2>
        </div>
        <div className="forecast-tabs section-header__tools" role="tablist" aria-label="Előrejelzési nap">
          {forecast.days.map((day, index) => <button key={day.date} role="tab" aria-selected={selectedIndex === index} className={selectedIndex === index ? "active" : ""} onClick={() => { setSelectedIndex(index); setHovered(null); }}>{day.label}</button>)}
        </div>
      </div>

      <div className="forecast-summary">
        <div><span>{today ? "Ma még várható termelés" : "Várható termelés"}</span><strong>{remainder.hours ? formatFixedNumber(remainder.energyKwh, 1) : "–"} <small>kWh</small></strong></div>
        <div><span>Becsült többlet · akkutöltés előtt</span><strong>{remainder.hours ? formatFixedNumber(remainder.surplusKwh, 1) : "–"} <small>kWh</small></strong><small>{formatFixedNumber(baseLoad, 2)} kW állandó háttérfogyasztással; az akkutöltés ebből még levonandó.</small></div>
        <div><span>Ajánlott fogyasztási ablak</span><strong>{remainder.best ? `${formatTime(new Date(remainder.best.from).toISOString())}–${formatTime(new Date(remainder.best.end).toISOString())}` : "Nincs becsült többlet"}</strong><small>A hátralévő órás modellintervallumok közül a legtöbb többletet adó.</small></div>
      </div>
      <details className="chart-details"><summary>Meteorológiai részletek és feltételezések</summary>
        <div className="forecast-summary">
          <div><span>Nappali felhőzet</span><strong>{formatFixedNumber(averageCloud, 0)}%</strong></div>
          <div><span>Csapadék esélye</span><strong>{formatFixedNumber(rainChance, 0)}%</strong></div>
          <div><span>Csúcsbesugárzás</span><strong>{formatFixedNumber(peakIrradiance, 0)} W/m²</strong></div>
        </div>
        <label>Feltételezett háttérfogyasztás <input type="number" min="0" max="20" step="0.05" value={baseLoad} onChange={(event) => setBaseLoad(Math.max(0, Math.min(20, Number(event.target.value) || 0)))} /> kW</label>
        <p>A többlet nem garantáltan szabad energia: nem tartalmazza az akku feltöltését, a külön bekapcsolt fogyasztókat és a helyi árnyékolást.</p>
      </details>

      <div className="forecast-legend">
        {actual.length > 1 && <span><i className="actual" />Tényleges termelés</span>}
        <span><i className="expected" />Időjárás alapján várható</span>
      </div>

      <div className="forecast-chart" onMouseLeave={() => setHovered(null)}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${selectedDay.label}: ${formatFixedNumber(selectedDay.expectedKwh, 1)} kilowattóra várható termelés`}>
          <defs><linearGradient id="forecast-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#d8902f" stopOpacity=".22" /><stop offset="100%" stopColor="#d8902f" stopOpacity=".02" /></linearGradient></defs>
          {gridValues.map((value) => <g key={value}><line className="forecast-gridline" x1={margin.left} x2={width - margin.right} y1={y(value)} y2={y(value)} /><text className="forecast-axis-label" x={margin.left - 10} y={y(value) + 4} textAnchor="end">{formatFixedNumber(value, 1)}</text></g>)}
          <text className="forecast-axis-title" x={margin.left} y={14}>Teljesítmény (kW)</text>
          <path d={`${smoothPath(expectedCoords)} L${expectedCoords.at(-1)?.x},${y(0)} L${expectedCoords[0]?.x},${y(0)} Z`} fill="url(#forecast-area)" />
          <path className="forecast-line forecast-line--expected" d={smoothPath(expectedCoords)} />
          {actualSegments.map((segment, key) => <path key={key} className="forecast-line forecast-line--actual" d={smoothPath(segment.map(({ point, value }) => ({ x: x(point), y: y(value) })))} />)}
          {dayTicks(parseLocalDateTime(selectedDay.date)).map((tick) => <text key={tick.label} className="forecast-x-label" x={margin.left + tick.ratio * plotWidth} y={height - 15} textAnchor="middle">{tick.label.slice(0, 2)}</text>)}
          {selectedDay.points.map((point, index) => <g key={point.timestamp}>
            <rect className="forecast-hit" x={x(point) - plotWidth / (selectedDay.points.length * 2)} y={margin.top} width={plotWidth / selectedDay.points.length} height={plotHeight} onMouseEnter={() => setHovered(index)} />
          </g>)}
          {active && <><line className="forecast-hover" x1={x(active)} x2={x(active)} y1={margin.top} y2={margin.top + plotHeight} /><circle cx={x(active)} cy={y(active.expectedPowerKw)} r="4" className="forecast-marker" /></>}
        </svg>
        {active && <div className="forecast-tooltip"><strong>{formatTime(active.timestamp)}</strong><span>Várható <b>{formatFixedNumber(active.expectedPowerKw, 2)} kW</b></span><span>Besugárzás <b>{formatFixedNumber(active.irradianceWm2, 0)} W/m²</b></span><span>Felhőzet <b>{formatFixedNumber(active.cloudCoverPct, 0)}%</b></span><span>Csapadék <b>{formatFixedNumber(active.precipitationProbabilityPct, 0)}%</b></span></div>}
      </div>
      <p className="chart-footnote">5 kWp rendszer · becsült 27° dőlés · dél–délnyugati tájolás</p>
      <p className="forecast-note">Az előrejelzés időjárási modellből készült becslés; a helyi hegyoldal árnyékolása eltérést okozhat.</p>
      <DataFreshness collectedAt={forecast.updatedAt} showObservation={false} note="Modellbecslés, nem mérés; a szaggatott vonal a jövőre is kiterjed." />
      <ForecastSource demo={data.source === "demo"} />
    </article>
  );
}
