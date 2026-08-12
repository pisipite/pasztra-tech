import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { DashboardCards } from "./components/DashboardCards";
import { SettingsPanel } from "./components/SettingsPanel";
import { ConsumptionPlanner } from "./ConsumptionPlanner";
import { dateFromInput, dateInputValue, DAY_MS, rangeForPeriod, timestampInPeriod } from "./dateUtils";
import { getInitialSettings, storeSettings, type DashboardSettings } from "./dashboardSettings";
import { makeDemoData } from "./demoData";
import { EnergyAnalytics } from "./EnergyAnalytics";
import { formatHeadingDate, formatTime } from "./formatUtils";
import { SolarForecast } from "./SolarForecast";
import { SunHorizon } from "./SunHorizon";
import type { DashboardData, DataConnection, PeriodKey } from "./types";
import "./styles.css";

const connectionStaleMs = 45 * 60 * 1000;

function connectionIsFresh(connection: DataConnection | undefined, fallbackConnected: boolean, fallbackUpdatedAt: string, clock: number) {
  const connected = connection?.connected ?? fallbackConnected;
  const updatedAt = connection?.updatedAt ?? fallbackUpdatedAt;
  const age = clock - new Date(updatedAt).getTime();
  return connected && Number.isFinite(age) && age >= -5 * 60_000 && age <= connectionStaleMs;
}

function App() {
  const [period, setPeriod] = useState<PeriodKey>("day");
  const [anchor, setAnchor] = useState(() => new Date());
  const [customStart, setCustomStart] = useState(() => dateInputValue(new Date(Date.now() - 6 * DAY_MS)));
  const [customEnd, setCustomEnd] = useState(() => dateInputValue(new Date()));
  const [settings, setSettings] = useState<DashboardSettings>(getInitialSettings);
  const [data, setData] = useState(() => makeDemoData("today"));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(() => Date.now());

  const loadData = useCallback(async (currentPeriod: PeriodKey, currentSettings: DashboardSettings, currentAnchor: Date, from?: string, to?: string) => {
    const currentRange = rangeForPeriod(currentPeriod, from, to);
    if (!currentSettings.live || !currentSettings.endpoint) {
      setData(makeDemoData(currentRange));
      setError("");
      return;
    }
    setLoading(true);
    try {
      const selectedDate = dateInputValue(currentAnchor);
      const requestedRange = currentPeriod === "day" && selectedDate !== dateInputValue(new Date())
        ? `day-${selectedDate}`
        : currentRange;
      const endpoint = currentSettings.endpoint.replace("{range}", requestedRange);
      const url = new URL(endpoint, window.location.href);
      url.searchParams.set("range", currentRange);
      url.searchParams.set("period", currentPeriod);
      url.searchParams.set("date", dateInputValue(currentAnchor));
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
    const timer = window.setInterval(() => void loadData(period, settings, anchor, customStart, customEnd), Math.min(settings.refreshSeconds, 300) * 1000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [period, anchor, customStart, customEnd, settings, loadData]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const climateSeries = useMemo(
    () => data.govee.chart
      .filter((point) => timestampInPeriod(point.timestamp, period, anchor, customStart, customEnd))
      .map((point) => ({ label: point.label, value: point.temperature })),
    [data, period, anchor, customStart, customEnd],
  );
  const batterySoc = useMemo(() => {
    const point = [...(data.solar.energyChart ?? [])].reverse().find((item) => Number.isFinite(item.batterySoc));
    return point?.batterySoc;
  }, [data.solar.energyChart]);
  const activeDevice = data.govee.devices[0];
  const source = data.source ?? (!settings.live || !settings.endpoint ? "demo" : "live");
  const solarConnected = connectionIsFresh(data.connections?.solar, source === "live" && data.solar.status === "online", data.updatedAt, clock);
  const climateConnected = connectionIsFresh(data.connections?.climate, source === "live" && Boolean(activeDevice), activeDevice?.updatedAt ?? data.updatedAt, clock);

  const saveSettings = (next: DashboardSettings) => {
    storeSettings(next);
    setSettings(next);
    void loadData(period, next, anchor, customStart, customEnd);
    setSettingsOpen(false);
  };

  const stepPeriod = (direction: -1 | 1) => {
    if (period === "custom") {
      const start = dateFromInput(customStart);
      const end = dateFromInput(customEnd);
      const span = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1);
      start.setDate(start.getDate() + direction * span);
      end.setDate(end.getDate() + direction * span);
      setCustomStart(dateInputValue(start));
      setCustomEnd(dateInputValue(end));
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
        <a href="#main" className="brand" aria-label="Pasztra tech: Napfény kezdőlap">
          <span className="brand__mark"><i /></span>
          <span>Pasztra tech<em>:</em> Napfény</span>
        </a>
        <div className="topbar__actions">
          <div className="stream-indicators" aria-label="Adatfolyamok állapota">
            <span className={`stream-indicator ${solarConnected ? "is-online" : "is-offline"}`} title={`Napelem: ${solarConnected ? "kapcsolódva" : "nincs friss adat"}`}><i /><span><strong>Napelem</strong><small>{solarConnected ? "kapcsolat" : "nincs adat"}</small></span></span>
            <span className={`stream-indicator ${climateConnected ? "is-online" : "is-offline"}`} title={`Hőmérséklet: ${climateConnected ? "kapcsolódva" : "nincs friss adat"}`}><i /><span><strong>Hőmérséklet</strong><small>{climateConnected ? "kapcsolat" : "nincs adat"}</small></span></span>
          </div>
          <button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="Adatkapcsolat beállításai">•••</button>
        </div>
      </header>

      <main id="main">
        <section className="intro">
          <img className="intro__photo" src={`${import.meta.env.BASE_URL}pasztra-home.png`} alt="A hegyoldali otthon madártávlatból" />
          <div className="intro__shade" aria-hidden="true" />
          <span className="sun-charm sun-charm--hero" aria-hidden="true"><i /></span>
          <div className="intro__content">
            <p className="eyebrow">{formatHeadingDate()}</p>
            <h1>Jó napot!<br />Itthon minden rendben.</h1>
          </div>
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

        <SolarForecast data={data} />

        <ConsumptionPlanner data={data} />

        <SunHorizon />

        <DashboardCards
          data={data}
          climateSeries={climateSeries}
          batterySoc={batterySoc}
          loading={loading}
          onRefresh={() => void loadData(period, settings, anchor, customStart, customEnd)}
        />

        <footer><span>Utolsó adatfrissítés: {formatTime(data.updatedAt)}</span><button onClick={() => setSettingsOpen(true)}>Adatkapcsolat beállítása →</button></footer>
      </main>
      {settingsOpen && <SettingsPanel key={`${settings.live}-${settings.endpoint}-${settings.refreshSeconds}`} settings={settings} onClose={() => setSettingsOpen(false)} onSave={saveSettings} />}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
