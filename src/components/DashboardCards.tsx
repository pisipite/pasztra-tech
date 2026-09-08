import { useState } from "react";
import { isValidClimateValues, type ClimateAggregation } from "../climateData";
import { isCurrentPeriod, periodLabel } from "../dateUtils";
import { formatTime } from "../formatUtils";
import type { ClimatePoint, DashboardData, PeriodKey, SolarData } from "../types";
import { BackToTop } from "./BackToTop";
import { ClimateChart } from "./ClimateChart";

type Props = {
  data: DashboardData;
  climateSeries: ClimatePoint[];
  climatePeriod: PeriodKey;
  climateAnchor: Date;
  climateCustomStart: string;
  climateCustomEnd: string;
  climateAggregation: ClimateAggregation;
  climateLoading: boolean;
  onClimatePeriodChange: (period: PeriodKey) => void;
  onClimateStep: (direction: -1 | 1) => void;
  onClimateCustomChange: (start: string, end: string) => void;
  onClimateAggregationChange: (aggregation: ClimateAggregation) => void;
  batterySoc?: number;
  loading: boolean;
  onRefresh: () => void;
};

function solarStatusText(status: SolarData["status"]) {
  if (status === "online") return "A rendszer termel";
  if (status === "warning") return "Figyelmet kér";
  return "Nem elérhető";
}

function SolarCard({ data, batterySoc, loading, onRefresh }: Pick<Props, "data" | "batterySoc" | "loading" | "onRefresh">) {
  const batteryLabel = Number.isFinite(batterySoc) ? batterySoc!.toFixed(0) : "—";
  const batteryLevel = Math.max(0, Math.min(100, batterySoc ?? 0));
  const batteryTemperature = Number.isFinite(data.solar.batteryTemperatureC) ? `${data.solar.batteryTemperatureC!.toFixed(1)} °C` : "—";
  const batteryVoltage = Number.isFinite(data.solar.batteryVoltageV) ? `${data.solar.batteryVoltageV!.toFixed(1)} V` : "—";

  return (
    <article className="card solar-card" id="napelem">
      <div className="solar-orbit" aria-hidden="true"><i /><i /><i /></div>
      <span className="sun-charm sun-charm--solar" aria-hidden="true"><i /></span>
      <div className="card__head">
        <div>
          <div className="section-kicker"><p className="eyebrow eyebrow--light">Termelés</p><BackToTop /></div>
          <div className="system-status"><span className={`dot dot--${data.solar.status}`} />{solarStatusText(data.solar.status)}</div>
        </div>
        <button className="refresh-button" onClick={onRefresh} disabled={loading}>{loading ? "Frissül…" : "Frissítés ↻"}</button>
      </div>
      <div className="solar-main">
        <div className="power-reading">
          <span className="power-reading__value">{data.solar.currentPowerKw.toLocaleString("hu-HU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span className="power-reading__unit">kW</span>
          <p>pillanatnyi teljesítmény</p>
        </div>
        <div className="energy-flow">
          <div><span>Otthon fogyasztása</span><strong>{data.solar.houseLoadKw.toFixed(2)} kW</strong></div>
          <div><span>{data.solar.gridPowerKw < 0 ? "Hálózatba táplálva" : "Hálózatból véve"}</span><strong>{Math.abs(data.solar.gridPowerKw).toFixed(2)} kW</strong></div>
        </div>
      </div>
      <div className="battery-status-panel" aria-label={`Akkumulátor töltöttsége: ${Number.isFinite(batterySoc) ? `${batteryLabel} százalék` : "nincs adat"}`}>
        <div>
          <span>Akkumulátor</span>
          <strong>{batteryLabel}<small>%</small></strong>
          <p>aktuális töltöttségi szint</p>
          <div className="battery-details">
            <span><small>Hőmérséklet</small><b>{batteryTemperature}</b></span>
            <span><small>Feszültség</small><b>{batteryVoltage}</b></span>
          </div>
        </div>
        <span className="battery-shape" aria-hidden="true"><i style={{ width: `${batteryLevel}%` }} /></span>
      </div>
      <div className="solar-stats">
        <div><span>Termelés ma</span><strong>{data.solar.todayKwh.toFixed(1)} <small>kWh</small></strong></div>
        <div><span>Ebben a hónapban</span><strong>{data.solar.monthKwh.toLocaleString("hu-HU")} <small>kWh</small></strong></div>
        <div><span>Összes termelés</span><strong>{data.solar.lifetimeMwh.toFixed(1)} <small>MWh</small></strong></div>
      </div>
    </article>
  );
}

const climatePeriods: { key: PeriodKey; label: string }[] = [
  { key: "day", label: "Nap" },
  { key: "week", label: "Hét" },
  { key: "month", label: "Hónap" },
  { key: "year", label: "Év" },
  { key: "custom", label: "Egyéb" },
];

function ClimateCard({ data, climateSeries, climatePeriod, climateAnchor, climateCustomStart, climateCustomEnd, climateAggregation, climateLoading, onClimatePeriodChange, onClimateStep, onClimateCustomChange, onClimateAggregationChange }: Pick<Props, "data" | "climateSeries" | "climatePeriod" | "climateAnchor" | "climateCustomStart" | "climateCustomEnd" | "climateAggregation" | "climateLoading" | "onClimatePeriodChange" | "onClimateStep" | "onClimateCustomChange" | "onClimateAggregationChange">) {
  const [temperatureVisible, setTemperatureVisible] = useState(true);
  const [humidityVisible, setHumidityVisible] = useState(true);
  const validDevices = data.govee.devices.filter((device) => isValidClimateValues(device.temperatureC, device.humidityPct));
  const activeDevice = validDevices[0];
  if (!activeDevice) {
    return (
      <article className="card climate-card" id="klima">
        <div className="card__head"><div><div className="section-kicker"><p className="eyebrow">Hőmérséklet</p><BackToTop /></div><h2>Nincs elérhető mérő</h2></div></div>
      </article>
    );
  }

  const comfortable = activeDevice.temperatureC >= 20
    && activeDevice.temperatureC <= 25
    && activeDevice.humidityPct >= 40
    && activeDevice.humidityPct <= 60;
  const aggregationAvailable = climatePeriod !== "day";
  const weatherTwins = data.govee.weatherTwins ?? [];
  const closestWeatherTwin = weatherTwins[0];
  const otherWeatherTwins = weatherTwins.slice(1, 6);

  return (
    <article className="card climate-card" id="klima">
      <span className="plant-sprout plant-sprout--climate" aria-hidden="true"><i /><i /><i /></span>
      <div className="card__head">
        <div><div className="section-kicker"><p className="eyebrow">Hőmérséklet</p><BackToTop /></div><h2>{activeDevice.room}</h2></div>
        <span className={`comfort-badge ${comfortable ? "" : "comfort-badge--alert"}`}>{comfortable ? "Kellemes" : "Ellenőrizendő"}</span>
      </div>
      <div className="climate-reading">
        <div className="temperature"><strong>{activeDevice.temperatureC.toFixed(1)}°</strong><span>C</span></div>
        <div className="humidity-reading">
          <svg className="humidity-drop" viewBox="0 0 34 44" aria-hidden="true">
            <path className="humidity-drop__body" d="M17 2.8C14.7 8.5 5.2 18.7 5.2 27.1c0 7.2 5.1 12.2 11.8 12.2s11.8-5 11.8-12.2C28.8 18.7 19.3 8.5 17 2.8Z" />
            <path className="humidity-drop__glint" d="M11.1 28.5c.5 3.1 2.5 5.1 5.3 5.7" />
          </svg>
          <div><strong>{activeDevice.humidityPct}%</strong><span>pára</span></div>
        </div>
      </div>
      {closestWeatherTwin && <div className="weather-twins">
        <span>Éppen mint</span>
        <button type="button" aria-describedby={otherWeatherTwins.length ? "weather-twins-tooltip" : undefined}>
          {closestWeatherTwin.locative}.
          {otherWeatherTwins.length > 0 && <span className="weather-twins__tooltip" id="weather-twins-tooltip" role="tooltip">
            <strong>Hasonló most még</strong>
            {otherWeatherTwins.map((place) => <span key={`${place.city}-${place.country}`}><b>{place.city}</b><small>{place.country} · {place.temperatureC.toFixed(1)} °C · {place.humidityPct.toFixed(0)}%</small></span>)}
          </span>}
        </button>
      </div>}
      <div className="climate-chart-wrap">
        <div className="climate-chart-heading">
          <div><span>Hőmérséklet alakulása</span><strong>Hőmérséklet és páratartalom</strong></div>
          <div className="period-tabs climate-period-tabs" role="tablist" aria-label="Klímaadatok időszaka">
            {climatePeriods.map((item) => <button key={item.key} role="tab" aria-selected={climatePeriod === item.key} className={climatePeriod === item.key ? "active" : ""} onClick={() => onClimatePeriodChange(item.key)}>{item.label}</button>)}
          </div>
        </div>
        <div className="climate-chart-controls">
          <div className="period-stepper">
            <button onClick={() => onClimateStep(-1)} aria-label="Előző klíma-időszak">←</button>
            <strong>{periodLabel(climatePeriod, climateAnchor, climateCustomStart, climateCustomEnd)}</strong>
            <button onClick={() => onClimateStep(1)} disabled={climatePeriod !== "custom" && isCurrentPeriod(climatePeriod, climateAnchor)} aria-label="Következő klíma-időszak">→</button>
          </div>
          <div className="climate-chart-options">
            {aggregationAvailable && <div className="climate-aggregation" role="group" aria-label="Megjelenített klímaérték"><button className={climateAggregation === "min" ? "active" : ""} aria-pressed={climateAggregation === "min"} onClick={() => onClimateAggregationChange("min")}>Minimum</button><button className={climateAggregation === "average" ? "active" : ""} aria-pressed={climateAggregation === "average"} onClick={() => onClimateAggregationChange("average")}>Átlag</button><button className={climateAggregation === "max" ? "active" : ""} aria-pressed={climateAggregation === "max"} onClick={() => onClimateAggregationChange("max")}>Maximum</button></div>}
            <div className="climate-legend" aria-label="Jelmagyarázat"><button className={temperatureVisible ? "" : "is-hidden"} aria-pressed={temperatureVisible} onClick={() => setTemperatureVisible((value) => !value)}><i className="is-temperature" />Hőmérséklet</button><button className={humidityVisible ? "" : "is-hidden"} aria-pressed={humidityVisible} onClick={() => setHumidityVisible((value) => !value)}><i className="is-humidity" />Páratartalom</button></div>
          </div>
        </div>
        {climatePeriod === "custom" && <div className="custom-range climate-custom-range"><label><span>Kezdőnap</span><input type="date" value={climateCustomStart} max={climateCustomEnd} onChange={(event) => onClimateCustomChange(event.target.value, climateCustomEnd)} /></label><span aria-hidden="true">→</span><label><span>Zárónap</span><input type="date" value={climateCustomEnd} min={climateCustomStart} max={new Date().toISOString().slice(0, 10)} onChange={(event) => onClimateCustomChange(climateCustomStart, event.target.value)} /></label></div>}
        <div className={climateLoading ? "is-climate-loading" : ""}><ClimateChart data={climateSeries} period={climatePeriod} temperatureVisible={temperatureVisible} humidityVisible={humidityVisible} /></div>
      </div>
      <div className="device-list">
        {validDevices.map((device) => (
          <div className="device-row" key={device.id}>
            <span className="device-icon"><i /><i /></span>
            <div><strong>{device.room}</strong><span>{device.name} · {formatTime(device.updatedAt)}</span></div>
            <div className="device-row__values"><strong>{device.temperatureC.toFixed(1)}°</strong><span>{device.humidityPct}% · {device.batteryPct}% akku</span></div>
          </div>
        ))}
      </div>
    </article>
  );
}

export function DashboardCards(props: Props) {
  const { loading } = props;
  return (
    <section className={`dashboard-grid ${loading ? "is-loading" : ""}`} aria-busy={loading}>
      <SolarCard {...props} />
      <ClimateCard {...props} />
    </section>
  );
}
