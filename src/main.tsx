import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { makeDemoData } from "./demoData";
import type { DashboardData, RangeKey } from "./types";
import "./styles.css";

const ranges: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Ma" },
  { key: "7d", label: "7 nap" },
  { key: "30d", label: "30 nap" },
];

type Settings = { live: boolean; endpoint: string; refreshSeconds: number };

function getInitialSettings(): Settings {
  const configured = window.SOLAR_HOME_CONFIG ?? {};
  const saved = localStorage.getItem("solar-home-settings");
  if (saved) {
    try { return JSON.parse(saved) as Settings; } catch { /* use file config */ }
  }
  return {
    live: configured.mode === "live",
    endpoint: configured.endpoint ?? "",
    refreshSeconds: configured.refreshSeconds ?? 300,
  };
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("hu-HU", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function statusText(status: DashboardData["solar"]["status"]) {
  return status === "online" ? "A rendszer termel" : status === "warning" ? "Figyelmet kér" : "Nem elérhető";
}

function LineChart({ data, suffix, tone = "solar" }: { data: { label: string; value: number }[]; suffix: string; tone?: "solar" | "climate" }) {
  const max = Math.max(...data.map((item) => item.value), 1);
  const points = data.map((item, index) => ({
    x: data.length === 1 ? 50 : (index / (data.length - 1)) * 100,
    y: 88 - (item.value / max) * 72,
    ...item,
  }));
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ");
  const area = `${line} L100,92 L0,92 Z`;

  return (
    <div className={`chart chart--${tone}`} aria-label={`Grafikon, maximum ${max.toFixed(1)} ${suffix}`}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img">
        <defs>
          <linearGradient id={`fill-${tone}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity=".28" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="chart__area" d={area} fill={`url(#fill-${tone})`} />
        <path className="chart__line" d={line} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="chart__labels">
        {data.map((item) => <span key={item.label}>{item.label}</span>)}
      </div>
    </div>
  );
}

function SettingsPanel({ settings, onClose, onSave }: { settings: Settings; onClose: () => void; onSave: (value: Settings) => void }) {
  const [draft, setDraft] = useState(settings);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="settings" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <button className="icon-button settings__close" onClick={onClose} aria-label="Beállítások bezárása">×</button>
        <p className="eyebrow">Adatkapcsolat</p>
        <h2 id="settings-title">Kapcsold össze az otthonoddal</h2>
        <p className="settings__intro">A GitHub Pages nyilvános oldal. Ezért ide egy saját, biztonságos közvetítő végpont címe kerülhet — Sungrow vagy Govee API-kulcs soha.</p>
        <label className="switch-row">
          <span><strong>Élő adatok</strong><small>Demo helyett a megadott végpont használata</small></span>
          <input type="checkbox" checked={draft.live} onChange={(event) => setDraft({ ...draft, live: event.target.checked })} />
        </label>
        <label className="field">
          <span>Adatvégpont URL</span>
          <input type="url" placeholder="https://api.sajatdomain.hu/dashboard" value={draft.endpoint} onChange={(event) => setDraft({ ...draft, endpoint: event.target.value })} />
        </label>
        <label className="field">
          <span>Automatikus frissítés</span>
          <select value={draft.refreshSeconds} onChange={(event) => setDraft({ ...draft, refreshSeconds: Number(event.target.value) })}>
            <option value={60}>1 percenként</option>
            <option value={300}>5 percenként</option>
            <option value={900}>15 percenként</option>
          </select>
        </label>
        <button className="primary-button" onClick={() => onSave(draft)}>Beállítások mentése</button>
      </section>
    </div>
  );
}

function App() {
  const [range, setRange] = useState<RangeKey>("today");
  const [settings, setSettings] = useState<Settings>(getInitialSettings);
  const [data, setData] = useState(() => makeDemoData("today"));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadData = useCallback(async (currentRange: RangeKey, currentSettings: Settings) => {
    if (!currentSettings.live || !currentSettings.endpoint) {
      setData(makeDemoData(currentRange));
      setError("");
      return;
    }
    setLoading(true);
    try {
      const endpoint = currentSettings.endpoint.replace("{range}", currentRange);
      const url = new URL(endpoint, window.location.href);
      url.searchParams.set("range", currentRange);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setData(await response.json() as DashboardData);
      setError("");
    } catch {
      setError("Az élő adatforrás most nem érhető el. Az utolsó ismert adatok láthatók.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void loadData(range, settings), 0);
    const timer = window.setInterval(() => void loadData(range, settings), settings.refreshSeconds * 1000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [range, settings, loadData]);

  const activeDevice = data.govee.devices[0];
  const climateSeries = useMemo(() => data.govee.chart.map((point) => ({ label: point.label, value: point.temperature })), [data]);
  const comfort = activeDevice.temperatureC >= 20 && activeDevice.temperatureC <= 25 && activeDevice.humidityPct >= 40 && activeDevice.humidityPct <= 60;
  const source = data.source ?? (!settings.live || !settings.endpoint ? "demo" : "live");
  const sourceLabel = source === "live" ? "Élő kapcsolat" : source === "partial" ? "Részleges élő adat" : "Bemutató adatok";

  const saveSettings = (next: Settings) => {
    localStorage.setItem("solar-home-settings", JSON.stringify(next));
    setSettings(next);
    void loadData(range, next);
    setSettingsOpen(false);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a href="#main" className="brand" aria-label="Napfény Otthon kezdőlap">
          <span className="brand__mark"><i /></span>
          <span>napfény<em>/</em>otthon</span>
        </a>
        <div className="topbar__actions">
          <span className={`status-pill ${source !== "live" ? "status-pill--demo" : ""}`}><i />{sourceLabel}</span>
          <button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="Adatkapcsolat beállításai">•••</button>
        </div>
      </header>

      <main id="main">
        <section className="intro">
          <div>
            <p className="eyebrow">{new Intl.DateTimeFormat("hu-HU", { weekday: "long", month: "long", day: "numeric" }).format(new Date())}</p>
            <h1>Jó napot!<br />Itthon minden rendben.</h1>
          </div>
          <div className="range-tabs" aria-label="Időtáv">
            {ranges.map((item) => <button key={item.key} className={range === item.key ? "active" : ""} onClick={() => { setRange(item.key); void loadData(item.key, settings); }}>{item.label}</button>)}
          </div>
        </section>

        {error && <div className="notice" role="status">{error}</div>}

        <section className={`dashboard-grid ${loading ? "is-loading" : ""}`} aria-busy={loading}>
          <article className="card solar-card">
            <div className="solar-orbit" aria-hidden="true"><i /><i /><i /></div>
            <div className="card__head">
              <div>
                <p className="eyebrow eyebrow--light">Sungrow napelem</p>
                <div className="system-status"><span className={`dot dot--${data.solar.status}`} />{statusText(data.solar.status)}</div>
              </div>
              <button className="refresh-button" onClick={() => void loadData(range, settings)} disabled={loading}>{loading ? "Frissül…" : "Frissítés ↻"}</button>
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
            <div className="solar-chart-wrap">
              <div className="section-title"><span>Termelés</span><strong>{range === "today" ? `${data.solar.todayKwh.toFixed(1)} kWh ma` : "összesített energia"}</strong></div>
              <LineChart data={data.solar.chart} suffix={range === "today" ? "kW" : "kWh"} />
            </div>
            <div className="solar-stats">
              <div><span>Ebben a hónapban</span><strong>{data.solar.monthKwh.toLocaleString("hu-HU")} <small>kWh</small></strong></div>
              <div><span>Összes termelés</span><strong>{data.solar.lifetimeMwh.toFixed(1)} <small>MWh</small></strong></div>
              <div><span>CO₂ megtakarítás ma</span><strong>{data.solar.co2SavedKg.toFixed(1)} <small>kg</small></strong></div>
            </div>
          </article>

          <article className="card climate-card">
            <div className="card__head">
              <div><p className="eyebrow">Govee otthonklíma</p><h2>{activeDevice.room}</h2></div>
              <span className={`comfort-badge ${comfort ? "" : "comfort-badge--alert"}`}>{comfort ? "Kellemes" : "Ellenőrizendő"}</span>
            </div>
            <div className="climate-reading">
              <div className="temperature"><strong>{activeDevice.temperatureC.toFixed(1)}°</strong><span>C</span></div>
              <div className="humidity-gauge" style={{ "--humidity": `${activeDevice.humidityPct * 3.6}deg` } as React.CSSProperties}>
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

          <article className="card insight-card">
            <div className="insight-icon">↗</div>
            <div><p className="eyebrow">Mai energiaegyensúly</p><h2>A nap fedezi az otthonod fogyasztásának nagy részét.</h2></div>
            <div className="progress-block"><div><span>Pillanatnyi saját felhasználás</span><strong>{data.solar.selfConsumptionPct}%</strong></div><span className="progress-track"><i style={{ width: `${data.solar.selfConsumptionPct}%` }} /></span></div>
          </article>
        </section>

        <footer><span>Utolsó adatfrissítés: {formatTime(data.updatedAt)}</span><button onClick={() => setSettingsOpen(true)}>Adatkapcsolat beállítása →</button></footer>
      </main>
      {settingsOpen && <SettingsPanel key={`${settings.live}-${settings.endpoint}-${settings.refreshSeconds}`} settings={settings} onClose={() => setSettingsOpen(false)} onSave={saveSettings} />}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
