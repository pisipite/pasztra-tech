import { useState } from "react";
import { isValidClimateValues } from "../../climateData";
import { dateInputValue, isCurrentPeriod, periodLabel } from "../../dateUtils";
import { formatFixedNumber, formatNumber } from "../../formatUtils";
import type { ClimatePoint, DashboardData, PeriodKey } from "../../types";
import { BackToTop } from "../../components/BackToTop";
import { ClimateChart } from "./ClimateChart";
import { DataFreshness } from "../../components/DataFreshness";
import { dewPointC, recentClimateChange } from "../../../shared/climateInsights.mjs";

type Props = {
  data: DashboardData;
  climateHistory: ClimatePoint[];
  climateSeries: ClimatePoint[];
  nowMs: number;
  climatePeriod: PeriodKey;
  climateAnchor: Date;
  climateCustomStart: string;
  climateCustomEnd: string;
  climateLoading: boolean;
  onClimatePeriodChange: (period: PeriodKey) => void;
  onClimateStep: (direction: -1 | 1) => void;
  onClimateCustomChange: (start: string, end: string) => void;
  loading: boolean;
  refreshLabel: string;
  onRefresh: () => void;
};

const climatePeriods: { key: PeriodKey; label: string }[] = [
  { key: "day", label: "Nap" },
  { key: "week", label: "Hét" },
  { key: "month", label: "Hónap" },
  { key: "year", label: "Év" },
  { key: "custom", label: "Egyéb" },
];

function ClimateCard({ data, climateHistory, climateSeries, nowMs, climatePeriod, climateAnchor, climateCustomStart, climateCustomEnd, climateLoading, loading, refreshLabel, onRefresh, onClimatePeriodChange, onClimateStep, onClimateCustomChange }: Props) {
  const [temperatureVisible, setTemperatureVisible] = useState(true);
  const [humidityVisible, setHumidityVisible] = useState(true);
  const validDevices = data.govee.devices.filter((device) => isValidClimateValues(device.temperatureC, device.humidityPct));
  const activeDevice = validDevices[0];
  if (!activeDevice) {
    return (
      <article className="card climate-card" id="klima">
        <div className="card__head section-header"><div className="section-header__lead"><div className="section-kicker"><p className="eyebrow">Hőmérséklet</p><BackToTop /></div><h2>Nincs elérhető mérő</h2></div><button className="refresh-button section-header__tools" onClick={onRefresh} disabled={loading} title="Az oldal összes adatának frissítése"><span aria-hidden="true">↻ </span>{refreshLabel}</button></div>
      </article>
    );
  }

  const weatherTwins = data.govee.weatherTwins ?? [];
  const closestWeatherTwin = weatherTwins[0];
  const tooltipWeatherTwins = weatherTwins.slice(0, 6);
  const change = recentClimateChange(climateHistory, activeDevice, nowMs);
  const dewPoint = change.status === "stale" ? null : dewPointC(activeDevice.temperatureC, activeDevice.humidityPct);
  const signedChange = (value: number, digits: number) => {
    const rounded = Number(value.toFixed(digits));
    return rounded === 0 ? "0" : `${rounded > 0 ? "+" : "−"}${formatNumber(Math.abs(rounded), digits)}`;
  };

  return (
    <article className="card climate-card" id="klima">
      <span className="plant-sprout plant-sprout--climate" aria-hidden="true"><i /><i /><i /></span>
      <div className="card__head section-header">
        <div className="section-header__lead"><div className="section-kicker"><p className="eyebrow">Hőmérséklet</p><BackToTop /></div><h2>{activeDevice.room}</h2></div>
        <button className="refresh-button section-header__tools" onClick={onRefresh} disabled={loading} title="Az oldal összes adatának frissítése"><span aria-hidden="true">↻ </span>{refreshLabel}</button>
      </div>
      <div className="climate-reading">
        <div className="climate-metric">
          <div className="temperature"><strong>{formatFixedNumber(activeDevice.temperatureC, 1)}°</strong><span>C</span></div>
          {change.status === "ok" && <small className="climate-trend">Kb. 3 óra alatt: {signedChange(change.temperatureDeltaC, 1)} °C</small>}
        </div>
        <div className="climate-metric climate-metric--humidity">
          <div className="humidity-reading">
            <svg className="humidity-drop" viewBox="0 0 34 44" aria-hidden="true">
              <path className="humidity-drop__body" d="M17 2.8C14.7 8.5 5.2 18.7 5.2 27.1c0 7.2 5.1 12.2 11.8 12.2s11.8-5 11.8-12.2C28.8 18.7 19.3 8.5 17 2.8Z" />
              <path className="humidity-drop__glint" d="M11.1 28.5c.5 3.1 2.5 5.1 5.3 5.7" />
            </svg>
            <div><strong>{formatNumber(activeDevice.humidityPct, 1)}%</strong><span>pára</span></div>
          </div>
          {change.status === "ok" && <small className="climate-trend">Kb. 3 óra alatt: {signedChange(change.humidityDeltaPoints, 1)} százalékpont</small>}
        </div>
      </div>
      {change.status !== "ok" && <p className="climate-trend-unavailable">3 órás változás: {change.status === "stale" ? "nincs friss lekérdezés" : "hiányos mérési előzmény"}.</p>}
      <div className="climate-dewpoint">
        <span>Harmatpont <small>becslés</small> <strong>{dewPoint === null ? "—" : `${formatFixedNumber(dewPoint, 1)} °C`}</strong></span>
        <small>{dewPoint === null ? "Friss mérés szükséges." : "A levegő telítődési hőmérséklete; falhőmérséklet nélkül nem páralecsapódás-jelzés."}</small>
      </div>
      {closestWeatherTwin && <div className="weather-twins">
        <span>Éppen mint</span>
        <button type="button" aria-describedby={tooltipWeatherTwins.length ? "weather-twins-tooltip" : undefined}>
          {closestWeatherTwin.locative}.
          {tooltipWeatherTwins.length > 0 && <span className="weather-twins__tooltip" id="weather-twins-tooltip" role="tooltip">
            <strong>Hasonló időjárás most</strong>
            {tooltipWeatherTwins.map((place, index) => <span className={index === 0 ? "is-primary" : undefined} key={`${place.city}-${place.country}`}><b>{place.city}</b><small>{place.country} · {formatFixedNumber(place.temperatureC, 1)} °C · {formatFixedNumber(place.humidityPct, 0)}%</small></span>)}
          </span>}
        </button>
      </div>}
      <div className="climate-chart-wrap">
        <div className="climate-chart-heading">
          <div><span>Hőmérséklet alakulása</span><strong>Hőmérséklet és páratartalom</strong></div>
          <div className="period-control-stack">
            <div className="period-tabs climate-period-tabs" role="tablist" aria-label="Klímaadatok időszaka">
              {climatePeriods.map((item) => <button key={item.key} role="tab" aria-selected={climatePeriod === item.key} className={climatePeriod === item.key ? "active" : ""} onClick={() => onClimatePeriodChange(item.key)}>{item.label}</button>)}
            </div>
            <div className="period-stepper">
              <button onClick={() => onClimateStep(-1)} aria-label="Előző klíma-időszak">←</button>
              <strong>{periodLabel(climatePeriod, climateAnchor, climateCustomStart, climateCustomEnd)}</strong>
              <button onClick={() => onClimateStep(1)} disabled={climatePeriod !== "custom" && isCurrentPeriod(climatePeriod, climateAnchor)} aria-label="Következő klíma-időszak">→</button>
            </div>
            {climatePeriod === "custom" && <div className="custom-range period-control-stack__custom"><label><span>Kezdőnap</span><input type="date" value={climateCustomStart} max={climateCustomEnd} onChange={(event) => onClimateCustomChange(event.target.value, climateCustomEnd)} /></label><span aria-hidden="true">→</span><label><span>Zárónap</span><input type="date" value={climateCustomEnd} min={climateCustomStart} max={dateInputValue(new Date())} onChange={(event) => onClimateCustomChange(climateCustomStart, event.target.value)} /></label></div>}
          </div>
        </div>
        <div className="climate-chart-controls">
          <div className="climate-chart-options">
            <div className="climate-legend" aria-label="Jelmagyarázat"><button className={temperatureVisible ? "" : "is-hidden"} aria-pressed={temperatureVisible} onClick={() => setTemperatureVisible((value) => !value)}><i className="is-temperature" />Hőmérséklet</button><button className={humidityVisible ? "" : "is-hidden"} aria-pressed={humidityVisible} onClick={() => setHumidityVisible((value) => !value)}><i className="is-humidity" />Páratartalom</button></div>
          </div>
        </div>
        <div className={climateLoading ? "is-climate-loading" : ""}><ClimateChart data={climateSeries} period={climatePeriod} temperatureVisible={temperatureVisible} humidityVisible={humidityVisible} /></div>
      </div>
      <div className="chart-footnotes"><DataFreshness collectedAt={data.refreshedAt ?? data.updatedAt} observedAt={activeDevice.updatedAt}
        observationLabel="Utolsó szenzorlekérdezés" note="Az eszköz külön mérési időbélyeget nem közöl." /></div>
      {validDevices.length > 1 && <details className="climate-other-devices"><summary>További mérők ({validDevices.length - 1})</summary>
        {validDevices.slice(1).map((device) => <p key={device.id}>{device.room}: {formatFixedNumber(device.temperatureC, 1)} °C · {formatFixedNumber(device.humidityPct, 0)}% páratartalom</p>)}
      </details>}
    </article>
  );
}

export function DashboardCards(props: Props) {
  const { loading } = props;
  return (
    <section className={`dashboard-grid ${loading ? "is-loading" : ""}`} aria-busy={loading}>
      <ClimateCard {...props} />
    </section>
  );
}
