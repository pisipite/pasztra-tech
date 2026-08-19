import type { CSSProperties } from "react";
import { formatTime } from "../formatUtils";
import type { ChartPoint, DashboardData, SolarData } from "../types";
import { LineChart } from "./LineChart";

type Props = {
  data: DashboardData;
  climateSeries: ChartPoint[];
  batterySoc?: number;
  loading: boolean;
  onRefresh: () => void;
};

function solarStatusText(status: SolarData["status"]) {
  if (status === "online") return "A rendszer termel";
  if (status === "warning") return "Figyelmet kér";
  return "Nem elérhető";
}

function SolarCard({ data, batterySoc, loading, onRefresh }: Omit<Props, "climateSeries">) {
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
          <p className="eyebrow eyebrow--light">Sungrow napelem</p>
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

function ClimateCard({ data, climateSeries }: Pick<Props, "data" | "climateSeries">) {
  const activeDevice = data.govee.devices[0];
  if (!activeDevice) {
    return (
      <article className="card climate-card" id="klima">
        <div className="card__head"><div><p className="eyebrow">Govee otthonklíma</p><h2>Nincs elérhető mérő</h2></div></div>
      </article>
    );
  }

  const comfortable = activeDevice.temperatureC >= 20
    && activeDevice.temperatureC <= 25
    && activeDevice.humidityPct >= 40
    && activeDevice.humidityPct <= 60;

  return (
    <article className="card climate-card" id="klima">
      <span className="plant-sprout plant-sprout--climate" aria-hidden="true"><i /><i /><i /></span>
      <div className="card__head">
        <div><p className="eyebrow">Govee otthonklíma</p><h2>{activeDevice.room}</h2></div>
        <span className={`comfort-badge ${comfortable ? "" : "comfort-badge--alert"}`}>{comfortable ? "Kellemes" : "Ellenőrizendő"}</span>
      </div>
      <div className="climate-reading">
        <div className="temperature"><strong>{activeDevice.temperatureC.toFixed(1)}°</strong><span>C</span></div>
        <div className="humidity-gauge" style={{ "--humidity": `${activeDevice.humidityPct * 3.6}deg` } as CSSProperties}>
          <div><strong>{activeDevice.humidityPct}%</strong><span>pára</span></div>
        </div>
      </div>
      <div className="climate-chart-wrap">
        <div className="section-title"><span>Hőmérséklet alakulása</span><strong>{climateSeries.at(-1)?.value.toFixed(1)} °C</strong></div>
        <LineChart data={climateSeries} suffix="°C" tone="climate" />
      </div>
      <div className="device-list">
        {data.govee.devices.map((device) => (
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
  const { data, climateSeries, loading } = props;
  return (
    <section className={`dashboard-grid ${loading ? "is-loading" : ""}`} aria-busy={loading}>
      <SolarCard {...props} />
      <ClimateCard data={data} climateSeries={climateSeries} />
    </section>
  );
}
