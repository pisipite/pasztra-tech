import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { DashboardCards } from "./components/DashboardCards";
import { SettingsPanel } from "./components/SettingsPanel";
import { climatePointsForPeriod, type ClimateAggregation } from "./climateData";
import { ConsumptionPlanner } from "./ConsumptionPlanner";
import { dateFromInput, dateInputValue, DAY_MS, rangeForPeriod } from "./dateUtils";
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
  const [climatePeriod, setClimatePeriod] = useState<PeriodKey>("day");
  const [climateAnchor, setClimateAnchor] = useState(() => new Date());
  const [climateCustomStart, setClimateCustomStart] = useState(() => dateInputValue(new Date(Date.now() - 6 * DAY_MS)));
  const [climateCustomEnd, setClimateCustomEnd] = useState(() => dateInputValue(new Date()));
  const [climateAggregation, setClimateAggregation] = useState<ClimateAggregation>("average");
  const [climateHistory, setClimateHistory] = useState(() => makeDemoData("today").govee.chart);
  const [climateLoading, setClimateLoading] = useState(false);
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

  const loadClimateHistory = useCallback(async (currentSettings: DashboardSettings, currentPeriod: PeriodKey, currentAnchor: Date, from?: string, to?: string) => {
    const currentRange = rangeForPeriod(currentPeriod, from, to);
    if (!currentSettings.live || !currentSettings.endpoint) {
      setClimateHistory(makeDemoData(currentRange).govee.chart);
      return;
    }
    setClimateLoading(true);
    try {
      const dashboardUrl = new URL(currentSettings.endpoint.replace("{range}", "today"), window.location.href);
      const historyUrl = new URL("govee-history.json", dashboardUrl);
      historyUrl.searchParams.set("updated", String(Date.now()));
      const response = await fetch(historyUrl, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const history = await response.json() as DashboardData["govee"]["chart"];
      if (!Array.isArray(history)) throw new Error("Érvénytelen klímaelőzmény.");
      setClimateHistory(history);
    } catch {
      try {
        const selectedDate = dateInputValue(currentAnchor);
        const requestedRange = currentPeriod === "day" && selectedDate !== dateInputValue(new Date()) ? `day-${selectedDate}` : currentRange;
        const endpoint = currentSettings.endpoint.replace("{range}", requestedRange);
        const response = await fetch(new URL(endpoint, window.location.href), { cache: "no-store" });
        if (response.ok) setClimateHistory((await response.json() as DashboardData).govee.chart);
      } catch { /* keep the last known climate history */ }
    } finally {
      setClimateLoading(false);
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
    const initial = window.setTimeout(() => void loadClimateHistory(settings, climatePeriod, climateAnchor, climateCustomStart, climateCustomEnd), 0);
    const timer = window.setInterval(() => void loadClimateHistory(settings, climatePeriod, climateAnchor, climateCustomStart, climateCustomEnd), Math.min(settings.refreshSeconds, 300) * 1000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [climatePeriod, climateAnchor, climateCustomStart, climateCustomEnd, settings, loadClimateHistory]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const climateSeries = useMemo(
    () => climatePointsForPeriod(climateHistory, climatePeriod, climateAnchor, climateCustomStart, climateCustomEnd, climatePeriod === "week" || climatePeriod === "month" || climatePeriod === "year" ? climateAggregation : "average"),
    [climateHistory, climatePeriod, climateAnchor, climateCustomStart, climateCustomEnd, climateAggregation],
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

  const stepClimatePeriod = (direction: -1 | 1) => {
    if (climatePeriod === "custom") {
      const start = dateFromInput(climateCustomStart);
      const end = dateFromInput(climateCustomEnd);
      const span = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1);
      start.setDate(start.getDate() + direction * span);
      end.setDate(end.getDate() + direction * span);
      setClimateCustomStart(dateInputValue(start));
      setClimateCustomEnd(dateInputValue(end));
      return;
    }
    const next = new Date(climateAnchor);
    if (climatePeriod === "day") next.setDate(next.getDate() + direction);
    if (climatePeriod === "week") next.setDate(next.getDate() + direction * 7);
    if (climatePeriod === "month") next.setMonth(next.getMonth() + direction);
    if (climatePeriod === "year") next.setFullYear(next.getFullYear() + direction);
    setClimateAnchor(next);
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

      <nav className="section-nav" aria-label="Ugrás az oldal szakaszaihoz">
        <div className="section-nav__track">
          <a href="#kezdolap">Kezdőlap</a>
          <a href="#energia">Energia</a>
          <a href="#elojelzes">Előrejelzés</a>
          <a href="#fogyasztasi-proba">Fogyasztási próba</a>
          <a href="#napallas">Napállás</a>
          <a href="#napelem">Napelem</a>
          <a href="#klima">Klíma</a>
        </div>
      </nav>

      <main id="main">
        <section className="intro" id="kezdolap">
          <img className="intro__photo" src={`${import.meta.env.BASE_URL}pasztra-poster-hero.png`} alt="A hegyoldali otthon turisztikai plakát stílusú látképe" />
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
          climatePeriod={climatePeriod}
          climateAnchor={climateAnchor}
          climateCustomStart={climateCustomStart}
          climateCustomEnd={climateCustomEnd}
          climateAggregation={climateAggregation}
          climateLoading={climateLoading}
          onClimatePeriodChange={(next) => { setClimatePeriod(next); setClimateAnchor(new Date()); }}
          onClimateStep={stepClimatePeriod}
          onClimateCustomChange={(start, end) => { setClimateCustomStart(start); setClimateCustomEnd(end); }}
          onClimateAggregationChange={setClimateAggregation}
          batterySoc={batterySoc}
          loading={loading}
          onRefresh={() => void loadData(period, settings, anchor, customStart, customEnd)}
        />

        <footer id="adatkapcsolat"><span>Utolsó adatfrissítés: {formatTime(data.updatedAt)}</span><button onClick={() => setSettingsOpen(true)}>Adatkapcsolat beállítása →</button></footer>
      </main>
      {settingsOpen && <SettingsPanel key={`${settings.live}-${settings.endpoint}-${settings.refreshSeconds}`} settings={settings} onClose={() => setSettingsOpen(false)} onSave={saveSettings} />}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
