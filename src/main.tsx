import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { makeDemoData } from "./demoData";
import { EnergyAnalytics } from "./EnergyAnalytics";
import type { DashboardData, PeriodKey, RangeKey } from "./types";
import "./styles.css";

const periodRange: Record<PeriodKey, RangeKey> = { day: "today", week: "7d", month: "30d", year: "year", custom: "30d" };

function rangeForPeriod(period: PeriodKey, from?: string, to?: string): RangeKey {
  if (period !== "custom" || !from || !to) return periodRange[period];
  const days = Math.max(1, (new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / 86_400_000 + 1);
  return days > 62 ? "year" : "30d";
}

function climatePointIsVisible(timestamp: string | undefined, period: PeriodKey, anchor: Date, customStart: string, customEnd: string) {
  if (!timestamp) return true;
  const time = new Date(timestamp);
  if (period === "day") return time.toDateString() === anchor.toDateString();
  if (period === "month") return time.getFullYear() === anchor.getFullYear() && time.getMonth() === anchor.getMonth();
  if (period === "year") return time.getFullYear() === anchor.getFullYear();
  if (period === "custom") return time >= new Date(`${customStart}T00:00:00`) && time <= new Date(`${customEnd}T23:59:59`);
  const start = new Date(anchor);
  const weekday = start.getDay() || 7;
  start.setDate(start.getDate() - weekday + 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return time >= start && time < end;
}

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
  const [period, setPeriod] = useState<PeriodKey>("day");
  const [anchor, setAnchor] = useState(() => new Date());
  const [customStart, setCustomStart] = useState(() => new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10));
  const [customEnd, setCustomEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [settings, setSettings] = useState<Settings>(getInitialSettings);
  const [data, setData] = useState(() => makeDemoData("today"));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadData = useCallback(async (currentPeriod: PeriodKey, currentSettings: Settings, currentAnchor: Date, from?: string, to?: string) => {
    const currentRange = rangeForPeriod(currentPeriod, from, to);
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
      url.searchParams.set("period", currentPeriod);
      url.searchParams.set("date", currentAnchor.toISOString().slice(0, 10));
      if (currentPeriod === "custom" && from && to) {
        url.searchParams.set("from", from);
        url.searchParams.set("to", to);
      }
      url.searchParams.set("updated", String(Date.now()));
      const response = await fetch(url, { cache: "no-store" });
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
    const initial = window.setTimeout(() => void loadData(period, settings, anchor, customStart, customEnd), 0);
    const timer = window.setInterval(() => void loadData(period, settings, anchor, customStart, customEnd), settings.refreshSeconds * 1000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [period, anchor, customStart, customEnd, settings, loadData]);

  const activeDevice = data.govee.devices[0];
  const climateSeries = useMemo(
    () => data.govee.chart
      .filter((point) => climatePointIsVisible(point.timestamp, period, anchor, customStart, customEnd))
      .map((point) => ({ label: point.label, value: point.temperature })),
    [data, period, anchor, customStart, customEnd],
  );
  const comfort = activeDevice.temperatureC >= 20 && activeDevice.temperatureC <= 25 && activeDevice.humidityPct >= 40 && activeDevice.humidityPct <= 60;
  const source = data.source ?? (!settings.live || !settings.endpoint ? "demo" : "live");
  const sourceLabel = source === "live" ? "Élő kapcsolat" : source === "partial" ? "Részleges élő adat" : "Bemutató adatok";

  const saveSettings = (next: Settings) => {
    localStorage.setItem("solar-home-settings", JSON.stringify(next));
    setSettings(next);
    void loadData(period, next, anchor, customStart, customEnd);
    setSettingsOpen(false);
  };

  const stepPeriod = (direction: -1 | 1) => {
    if (period === "custom") {
      const start = new Date(`${customStart}T12:00:00`);
      const end = new Date(`${customEnd}T12:00:00`);
      const span = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
      start.setDate(start.getDate() + direction * span);
      end.setDate(end.getDate() + direction * span);
      setCustomStart(start.toISOString().slice(0, 10));
      setCustomEnd(end.toISOString().slice(0, 10));
      return;
    }
    const next = new Date(anchor);
    if (period === "day") next.setDate(next.getDate() + direction);
    if (period === "week") next.setDate(next.getDate() + direction * 7);
    if (period === "month") next.setMonth(next.getMonth() + direction);
    if (period === "year") next.setFullYear(next.getFullYear() + direction);
    setAnchor(next);
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
          <p className="intro__aside">A termelés, fogyasztás és otthonklíma egyetlen, részletes nézetben.</p>
        </section>

        {error && <div className="notice" role="status">{error}</div>}

        <EnergyAnalytics
          data={data}
          period={period}
          anchor={anchor}
          customStart={customStart}
          customEnd={customEnd}
          onPeriodChange={(next) => { setPeriod(next); setAnchor(new Date()); }}
          onStep={stepPeriod}
          onCustomChange={(start, end) => { setCustomStart(start); setCustomEnd(end); }}
        />

        <section className={`dashboard-grid ${loading ? "is-loading" : ""}`} aria-busy={loading}>
          <article className="card solar-card">
            <div className="solar-orbit" aria-hidden="true"><i /><i /><i /></div>
            <div className="card__head">
              <div>
                <p className="eyebrow eyebrow--light">Sungrow napelem</p>
                <div className="system-status"><span className={`dot dot--${data.solar.status}`} />{statusText(data.solar.status)}</div>
              </div>
              <button className="refresh-button" onClick={() => void loadData(period, settings, anchor, customStart, customEnd)} disabled={loading}>{loading ? "Frissül…" : "Frissítés ↻"}</button>
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
              <div className="section-title"><span>Termelés</span><strong>{period === "day" ? `${data.solar.todayKwh.toFixed(1)} kWh ma` : "összesített energia"}</strong></div>
              <LineChart data={data.solar.chart} suffix={period === "day" ? "kW" : "kWh"} />
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
