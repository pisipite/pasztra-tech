import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { SettingsPanel } from "./components/SettingsPanel";
import {
  BulgariaEnergyMix,
  ConsumptionPlanner,
  DashboardCards,
  EnergyAnalytics,
  EnergyNews,
  makeDemoBulgariaEnergyMix,
  makeDemoEnergyNews,
  SolarForecast,
  SunHorizon,
} from "./blocks";
import { climatePointsForPeriod, isValidClimateValues, type ClimateAggregation } from "./climateData";
import { PAGE_BLOCKS } from "./config/pageBlocks";
import { DATA_FILES } from "./config/dataFiles";
import { repairClimateHistory } from "../scripts/govee-temperature.mjs";
import { dashboardUrl, dataFileUrl, fetchFreshJson } from "./dashboardApi";
import { rangeForPeriod } from "./dateUtils";
import { getInitialSettings, storeSettings, type DashboardSettings } from "./dashboardSettings";
import { makeDemoData } from "./demoData";
import { formatHeadingDate, formatTime } from "./formatUtils";
import { dispatchDashboardRefresh, dispatchNewsTranslation, waitForFreshDashboard, waitForNewsTranslation } from "./githubRefresh";
import type { BulgariaEnergyMixData, DashboardData, DataConnection, EnergyNewsData, EnergyNewsItem, PeriodKey } from "./types";
import { usePeriodSelection } from "./usePeriodSelection";
import "./styles.css";

const connectionStaleMs = 45 * 60 * 1000;
const recoveryAfterMs = 40 * 60 * 1000;
const recoveryCooldownMs = 50 * 60 * 1000;
const recoveryAttemptKey = "solar-home-auto-recovery-at";
type ManualRefreshState = "idle" | "starting" | "waiting" | "success" | "error";

function withRepairedClimate(dashboard: DashboardData): DashboardData {
  return Array.isArray(dashboard.govee?.chart)
    ? { ...dashboard, govee: { ...dashboard.govee, chart: repairClimateHistory(dashboard.govee.chart) } }
    : dashboard;
}

function connectionIsFresh(connection: DataConnection | undefined, fallbackConnected: boolean, fallbackUpdatedAt: string, clock: number) {
  const connected = connection?.connected ?? fallbackConnected;
  const updatedAt = connection?.updatedAt ?? fallbackUpdatedAt;
  const age = clock - new Date(updatedAt).getTime();
  return connected && Number.isFinite(age) && age >= -5 * 60_000 && age <= connectionStaleMs;
}

function startPolling(load: () => void, refreshSeconds: number) {
  const seconds = Number.isFinite(refreshSeconds) ? Math.max(60, refreshSeconds) : 300;
  const initial = window.setTimeout(load, 0);
  const timer = window.setInterval(load, seconds * 1000);
  return () => {
    window.clearTimeout(initial);
    window.clearInterval(timer);
  };
}

function App() {
  const energySelection = usePeriodSelection();
  const { period, anchor, customStart, customEnd } = energySelection;
  const climateSelection = usePeriodSelection();
  const { period: climatePeriod, anchor: climateAnchor, customStart: climateCustomStart, customEnd: climateCustomEnd } = climateSelection;
  const [climateAggregation, setClimateAggregation] = useState<ClimateAggregation>("average");
  const [climateHistory, setClimateHistory] = useState(() => makeDemoData("today").govee.chart);
  const [climateLoading, setClimateLoading] = useState(false);
  const [settings, setSettings] = useState<DashboardSettings>(getInitialSettings);
  const [data, setData] = useState(() => makeDemoData("today"));
  const [bulgariaMix, setBulgariaMix] = useState(makeDemoBulgariaEnergyMix);
  const [energyNews, setEnergyNews] = useState(makeDemoEnergyNews);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const [manualRefreshState, setManualRefreshState] = useState<ManualRefreshState>("idle");
  const [manualRefreshMessage, setManualRefreshMessage] = useState("");

  const loadData = useCallback(async (currentPeriod: PeriodKey, currentSettings: DashboardSettings, currentAnchor: Date, from?: string, to?: string) => {
    const currentRange = rangeForPeriod(currentPeriod, from, to);
    if (!currentSettings.live || !currentSettings.endpoint) {
      setData(makeDemoData(currentRange));
      setError("");
      return;
    }
    setLoading(true);
    try {
      const dashboard = await fetchFreshJson<DashboardData>(dashboardUrl(currentSettings.endpoint, currentPeriod, currentAnchor, from, to));
      setData(withRepairedClimate(dashboard));
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
      const history = await fetchFreshJson<DashboardData["govee"]["chart"]>(dataFileUrl(currentSettings.endpoint, DATA_FILES.climateHistory));
      if (!Array.isArray(history)) throw new Error("Érvénytelen klímaelőzmény.");
      setClimateHistory(repairClimateHistory(history));
    } catch {
      try {
        const dashboard = await fetchFreshJson<DashboardData>(dashboardUrl(currentSettings.endpoint, currentPeriod, currentAnchor, from, to));
        if (Array.isArray(dashboard.govee?.chart)) setClimateHistory(repairClimateHistory(dashboard.govee.chart));
      } catch { /* keep the last known climate history */ }
    } finally {
      setClimateLoading(false);
    }
  }, []);

  const loadBulgariaMix = useCallback(async (currentSettings: DashboardSettings) => {
    if (!currentSettings.live || !currentSettings.endpoint) {
      setBulgariaMix(makeDemoBulgariaEnergyMix());
      return;
    }
    try {
      const next = await fetchFreshJson<BulgariaEnergyMixData>(dataFileUrl(currentSettings.endpoint, DATA_FILES.bulgariaEnergyMix));
      if (!Array.isArray(next.points)) throw new Error("Érvénytelen energiamix-adat.");
      setBulgariaMix(next);
    } catch {
      // Keep the last known national energy-mix data while the source is unavailable.
    }
  }, []);

  const loadEnergyNews = useCallback(async (currentSettings: DashboardSettings) => {
    if (!currentSettings.live || !currentSettings.endpoint) {
      setEnergyNews(makeDemoEnergyNews());
      return;
    }
    try {
      const next = await fetchFreshJson<EnergyNewsData>(dataFileUrl(currentSettings.endpoint, DATA_FILES.energyNews));
      if (!Array.isArray(next.items) || !Array.isArray(next.sources)) throw new Error("Érvénytelen híradat.");
      setEnergyNews(next);
    } catch {
      // Keep the last known news while one or more source feeds are unavailable.
    }
  }, []);

  useEffect(() => startPolling(() => void loadData(period, settings, anchor, customStart, customEnd), settings.refreshSeconds),
    [period, anchor, customStart, customEnd, settings, loadData]);

  useEffect(() => startPolling(() => void loadClimateHistory(settings, climatePeriod, climateAnchor, climateCustomStart, climateCustomEnd), settings.refreshSeconds),
    [climatePeriod, climateAnchor, climateCustomStart, climateCustomEnd, settings, loadClimateHistory]);

  useEffect(() => startPolling(() => void loadBulgariaMix(settings), settings.refreshSeconds),
    [settings, loadBulgariaMix]);

  useEffect(() => startPolling(() => void loadEnergyNews(settings), settings.refreshSeconds),
    [settings, loadEnergyNews]);

  useEffect(() => {
    const syncClock = () => setClock(Date.now());
    const timer = window.setInterval(syncClock, 60_000);
    document.addEventListener("visibilitychange", syncClock);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", syncClock);
    };
  }, []);

  const climateSeries = useMemo(
    () => climatePointsForPeriod(climateHistory, climatePeriod, climateAnchor, climateCustomStart, climateCustomEnd, climatePeriod === "day" ? "average" : climateAggregation),
    [climateHistory, climatePeriod, climateAnchor, climateCustomStart, climateCustomEnd, climateAggregation],
  );
  const batterySoc = useMemo(() => {
    const point = [...(data.solar.energyChart ?? [])].reverse().find((item) => Number.isFinite(item.batterySoc));
    return point?.batterySoc;
  }, [data.solar.energyChart]);
  const activeDevice = data.govee.devices.find((device) => isValidClimateValues(device.temperatureC, device.humidityPct));
  const source = data.source ?? (!settings.live || !settings.endpoint ? "demo" : "live");
  const solarConnected = connectionIsFresh(data.connections?.solar, source === "live" && data.solar.status === "online", data.updatedAt, clock);
  const climateConnected = connectionIsFresh(data.connections?.climate, source === "live" && Boolean(activeDevice), activeDevice?.updatedAt ?? data.updatedAt, clock);

  const saveSettings = (next: DashboardSettings) => {
    storeSettings(next);
    setSettings(next);
    setSettingsOpen(false);
  };

  const translateNewsItem = useCallback(async (item: EnergyNewsItem) => {
    if (!settings.githubToken) {
      setSettingsOpen(true);
      throw new Error("A fordításhoz add meg a GitHub frissítési tokent az Adatkapcsolat panelen.");
    }
    if (!settings.live || !settings.endpoint) {
      throw new Error("A fordítás csak az élő hírfolyamban érhető el.");
    }
    await dispatchNewsTranslation(settings.githubToken, item.url);
    const next = await waitForNewsTranslation(dataFileUrl(settings.endpoint, DATA_FILES.energyNews), item.url, energyNews.updatedAt);
    setEnergyNews(next);
  }, [settings, energyNews.updatedAt]);

  const triggerManualRefresh = useCallback(async () => {
    if (manualRefreshState === "starting" || manualRefreshState === "waiting") return;
    if (!settings.githubToken) {
      setManualRefreshState("error");
      setManualRefreshMessage("Az első használathoz add meg a finomhangolt GitHub frissítési tokent az Adatkapcsolat panelen.");
      setSettingsOpen(true);
      return;
    }
    if (!settings.live || !settings.endpoint) {
      setManualRefreshState("error");
      setManualRefreshMessage("A frissítéshez előbb kapcsold be az élő adatokat és állítsd be az adatvégpontot.");
      setSettingsOpen(true);
      return;
    }

    setManualRefreshState("starting");
    setManualRefreshMessage("A frissítési kérés elküldése a GitHubnak…");
    try {
      await dispatchDashboardRefresh(settings.githubToken);
      setManualRefreshState("waiting");
      setManualRefreshMessage("Az adatok gyűjtése és az oldal frissítése folyamatban van. Ez általában 1–2 perc.");
      const freshData = await waitForFreshDashboard(settings.endpoint, data.updatedAt, (progress) => setManualRefreshState(progress));
      setData(withRepairedClimate(freshData));
      await Promise.all([
        loadData(period, settings, anchor, customStart, customEnd),
        loadClimateHistory(settings, climatePeriod, climateAnchor, climateCustomStart, climateCustomEnd),
        loadBulgariaMix(settings),
        loadEnergyNews(settings),
      ]);
      setClock(Date.now());
      setManualRefreshState("success");
      setManualRefreshMessage(`Kész: az új adatok megérkeztek (${formatTime(freshData.updatedAt)}).`);
      window.setTimeout(() => {
        setManualRefreshState("idle");
        setManualRefreshMessage("");
      }, 8_000);
    } catch (refreshError) {
      setManualRefreshState("error");
      setManualRefreshMessage(refreshError instanceof Error ? refreshError.message : "A frissítés nem sikerült.");
    }
  }, [manualRefreshState, settings, data.updatedAt, period, anchor, customStart, customEnd, climatePeriod, climateAnchor, climateCustomStart, climateCustomEnd, loadData, loadClimateHistory, loadBulgariaMix, loadEnergyNews]);

  useEffect(() => {
    if (document.visibilityState !== "visible" || !settings.live || !settings.endpoint || !settings.githubToken) return;
    if (manualRefreshState === "starting" || manualRefreshState === "waiting") return;
    const dataAge = clock - new Date(data.updatedAt).getTime();
    if (!Number.isFinite(dataAge) || dataAge < recoveryAfterMs) return;
    const timer = window.setTimeout(() => {
      const lastAttempt = Number(localStorage.getItem(recoveryAttemptKey));
      if (lastAttempt > 0 && clock >= lastAttempt && clock - lastAttempt < recoveryCooldownMs) return;
      localStorage.setItem(recoveryAttemptKey, String(clock));
      void triggerManualRefresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [clock, data.updatedAt, settings.live, settings.endpoint, settings.githubToken, manualRefreshState, triggerManualRefresh]);

  const manualRefreshBusy = manualRefreshState === "starting" || manualRefreshState === "waiting";
  const manualRefreshLabel = manualRefreshState === "starting"
    ? "Indítás…"
    : manualRefreshState === "waiting"
      ? "Adatok gyűjtése…"
      : manualRefreshState === "success"
        ? "Frissítve"
        : "Adatok frissítése";

  return (
    <div className="app-shell">
      <header className="topbar" id="oldal-teteje">
        <a href="#main" className="brand" aria-label="Pasztra tech: Napfény kezdőlap">
          <span className="brand__mark"><i /></span>
          <span>Pasztra tech<em>:</em> Napfény</span>
        </a>
        <div className="topbar__actions">
          <div className="stream-indicators" aria-label="Adatfolyamok állapota">
            <span className={`stream-indicator ${solarConnected ? "is-online" : "is-offline"}`} title={`Napelem: ${solarConnected ? "kapcsolódva" : "nincs friss adat"}`}><i /><span><strong>Napelem</strong><small>{solarConnected ? "kapcsolat" : "nincs adat"}</small></span></span>
            <span className={`stream-indicator ${climateConnected ? "is-online" : "is-offline"}`} title={`Hőmérséklet: ${climateConnected ? "kapcsolódva" : "nincs friss adat"}`}><i /><span><strong>Hőmérséklet</strong><small>{climateConnected ? "kapcsolat" : "nincs adat"}</small></span></span>
          </div>
          <button className={`data-refresh-button is-${manualRefreshState}`} onClick={() => void triggerManualRefresh()} disabled={manualRefreshBusy} aria-describedby={manualRefreshMessage ? "manual-refresh-status" : undefined}>
            <i aria-hidden="true">↻</i><span>{manualRefreshLabel}</span>
          </button>
          <button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="Adatkapcsolat beállításai">•••</button>
        </div>
      </header>

      <nav className="section-nav" aria-label="Ugrás az oldal szakaszaihoz">
        <div className="section-nav__track">
          {PAGE_BLOCKS.map((block) => <a href={`#${block.id}`} key={block.id}>{block.navigationLabel}</a>)}
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
        {manualRefreshMessage && <div id="manual-refresh-status" className={`notice manual-refresh-notice is-${manualRefreshState}`} role="status">{manualRefreshBusy && <i aria-hidden="true" />}{manualRefreshMessage}</div>}

        <EnergyAnalytics
          data={data}
          period={period}
          anchor={anchor}
          customStart={customStart}
          customEnd={customEnd}
          onPeriodChange={energySelection.selectPeriod}
          onStep={energySelection.step}
          onCustomChange={energySelection.setCustomRange}
        />

        <BulgariaEnergyMix data={bulgariaMix} householdFallback={data.solar.energyChart} />

        <EnergyNews data={energyNews} onRequestTranslation={translateNewsItem} />

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
          onClimatePeriodChange={climateSelection.selectPeriod}
          onClimateStep={climateSelection.step}
          onClimateCustomChange={climateSelection.setCustomRange}
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
