import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { SettingsPanel } from "./components/SettingsPanel";
import {
  BulgariaEnergyMix,
  AirQuality,
  RegionalTransport,
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
import { dateTimeFormatter } from "./timeZone";
import { cancelWorkflowRun, dispatchDashboardRefresh, dispatchNewsTranslation, watchFreshDashboard, waitForNewsTranslation } from "./githubRefresh";
import { readRefreshSession, storeRefreshSession, type RefreshSession } from "./refreshSession";
import type { BulgariaEnergyMixData, DashboardData, DataConnection, EnergyNewsData, EnergyNewsItem, PeriodKey } from "./types";
import { usePeriodSelection } from "./usePeriodSelection";
import { useActiveSection } from "./useActiveSection";
import "./styles.css";
import "./theme.css";
import "./design-system.css";

const connectionStaleMs = 45 * 60 * 1000;
const recoveryAfterMs = 40 * 60 * 1000;
const recoveryCooldownMs = 50 * 60 * 1000;
const recoveryAttemptKey = "solar-home-auto-recovery-at";
const retainedTimestampFormatter = dateTimeFormatter({ year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
type ManualRefreshState = "idle" | "starting" | "waiting" | "success" | "error";
type ThemePreference = "system" | "light" | "dark";
const themeStorageKey = "pasztra-theme";

function initialThemePreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(themeStorageKey);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

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
  const [navigationOpen, setNavigationOpen] = useState(false);
  const activeSection = useActiveSection();
  const [error, setError] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const [refreshSession, setRefreshSession] = useState<RefreshSession | null>(readRefreshSession);
  const refreshSessionRef = useRef(refreshSession);
  const cancelledRefreshRequestsRef = useRef(new Set<string>());
  const [manualRefreshState, setManualRefreshState] = useState<ManualRefreshState>(refreshSession?.phase === "dispatching" ? "starting" : refreshSession ? "waiting" : "idle");
  const [manualRefreshMessage, setManualRefreshMessage] = useState(refreshSession ? "Korábbi frissítés ellenőrzése…" : "");
  const [translationStatus, setTranslationStatus] = useState<{ title: string; step: string; queued: number; cancel: () => void } | null>(null);
  const dispatchRef = useRef<ReturnType<typeof dispatchDashboardRefresh> | null>(null);
  const [themePreference, setThemePreference] = useState<ThemePreference>(initialThemePreference);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const darkMode = themePreference === "system" ? systemDark : themePreference === "dark";

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", syncSystemTheme);
    return () => media.removeEventListener("change", syncSystemTheme);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
    document.documentElement.style.colorScheme = darkMode ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", darkMode ? "#071b24" : "#063832");
    try { localStorage.setItem(themeStorageKey, themePreference); } catch { /* storage is optional */ }
  }, [themePreference, darkMode]);

  const loadData = useCallback(async (currentPeriod: PeriodKey, currentSettings: DashboardSettings, currentAnchor: Date, from?: string, to?: string) => {
    const currentRange = rangeForPeriod(currentPeriod, from, to);
    if (!currentSettings.live || !currentSettings.endpoint) {
      setData(makeDemoData(currentRange));
      setError("");
      return;
    }
    try {
      const dashboard = await fetchFreshJson<DashboardData>(dashboardUrl(currentSettings.endpoint, currentPeriod, currentAnchor, from, to));
      setData(withRepairedClimate(dashboard));
      setError("");
    } catch {
      setError("Az élő adatforrás most nem érhető el. Az utolsó ismert adatok láthatók.");
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

  useEffect(() => {
    if (!navigationOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNavigationOpen(false);
        document.querySelector<HTMLButtonElement>(".section-nav__toggle")?.focus();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [navigationOpen]);

  const climateSeries = useMemo(
    () => climatePointsForPeriod(climateHistory, climatePeriod, climateAnchor, climateCustomStart, climateCustomEnd, climatePeriod === "day" ? "average" : climateAggregation),
    [climateHistory, climatePeriod, climateAnchor, climateCustomStart, climateCustomEnd, climateAggregation],
  );
  const activeDevice = data.govee.devices.find((device) => isValidClimateValues(device.temperatureC, device.humidityPct));
  const source = data.source ?? (!settings.live || !settings.endpoint ? "demo" : "live");
  const solarConnected = connectionIsFresh(data.connections?.solar, source === "live" && data.solar.status === "online", data.updatedAt, clock);
  const climateConnected = connectionIsFresh(data.connections?.climate, source === "live" && Boolean(activeDevice), activeDevice?.updatedAt ?? data.updatedAt, clock);

  const saveSettings = (next: DashboardSettings) => {
    storeSettings(next);
    setSettings(next);
    setSettingsOpen(false);
  };

  const translateNewsItem = useCallback(async (item: EnergyNewsItem, options: { resume?: boolean; signal?: AbortSignal; onRunId?: (runId?: number) => void } = {}) => {
    if (!settings.githubToken) {
      setSettingsOpen(true);
      throw new Error("A fordításhoz add meg a GitHub frissítési tokent az Adatkapcsolat panelen.");
    }
    if (!settings.live || !settings.endpoint) {
      throw new Error("A fordítás csak az élő hírfolyamban érhető el.");
    }
    if (!options.resume) {
      const dispatched = await dispatchNewsTranslation(settings.githubToken, item.url);
      if (options.signal?.aborted) {
        if (dispatched.runId) await cancelWorkflowRun(settings.githubToken, dispatched.runId);
        return;
      }
      options.onRunId?.(dispatched.runId);
    }
    const next = await waitForNewsTranslation(dataFileUrl(settings.endpoint, DATA_FILES.energyNews), item.url, energyNews.translation?.updatedAt ?? energyNews.updatedAt, options.signal);
    if (options.signal?.aborted) return;
    setEnergyNews(next);
  }, [settings, energyNews.updatedAt, energyNews.translation?.updatedAt]);

  const cancelNewsRun = useCallback(async (runId: number) => {
    if (!settings.githubToken) throw new Error("A GitHub-token hiányzik; a távoli futás nem állítható le.");
    await cancelWorkflowRun(settings.githubToken, runId);
  }, [settings.githubToken]);

  const updateRefreshSession = useCallback((next: RefreshSession | null) => {
    refreshSessionRef.current = next;
    storeRefreshSession(next);
    setRefreshSession(next);
  }, []);

  const cancelManualRefresh = useCallback(() => {
    const active = refreshSessionRef.current;
    if (!active) return;
    cancelledRefreshRequestsRef.current.add(active.requestedAt);
    updateRefreshSession(null);
    setManualRefreshState("idle");
    try { localStorage.setItem(recoveryAttemptKey, String(Date.now())); } catch { /* automatic recovery remains best effort */ }
    if (!active.ownsRun || !active.runId) {
      setManualRefreshMessage(active.phase === "dispatching" ? "Visszavonás kérése…" : "A várakozás megszakadt; a közös vagy azonosítatlan GitHub-futás folytatódhat.");
      return;
    }
    setManualRefreshMessage("GitHub-futás leállítása…");
    void cancelWorkflowRun(settings.githubToken, active.runId).then(() => {
      if (!refreshSessionRef.current) setManualRefreshMessage("A GitHub-futás leállítását kértem.");
    }).catch((error) => {
      if (!refreshSessionRef.current) setManualRefreshMessage(error instanceof Error ? error.message : "A távoli futás leállítása nem sikerült.");
    });
  }, [settings.githubToken, updateRefreshSession]);

  const triggerManualRefresh = useCallback(() => {
    if (refreshSession) return;
    if (dispatchRef.current) {
      setManualRefreshState("idle");
      setManualRefreshMessage("Az előző indítás visszavonása folyamatban van; próbáld újra néhány másodperc múlva.");
      return;
    }
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
    setManualRefreshMessage("GitHub-frissítés indítása…");
    updateRefreshSession({ previousUpdatedAt: data.refreshedAt ?? data.updatedAt, requestedAt: new Date().toISOString(), phase: "dispatching" });
  }, [refreshSession, settings, data.updatedAt, data.refreshedAt, updateRefreshSession]);

  useEffect(() => {
    if (refreshSession?.phase !== "dispatching" || !settings.githubToken) return;
    if (dispatchRef.current) return;
    const dispatch = dispatchDashboardRefresh(settings.githubToken);
    dispatchRef.current = dispatch;
    void dispatch.then((dispatched) => {
      dispatchRef.current = null;
      if (cancelledRefreshRequestsRef.current.delete(refreshSession.requestedAt)) {
        if (dispatched.owned && dispatched.runId) {
          void cancelWorkflowRun(settings.githubToken, dispatched.runId).then(() => {
            if (!refreshSessionRef.current) setManualRefreshMessage("A GitHub-futás leállítását kértem.");
          }).catch((error) => {
            if (!refreshSessionRef.current) setManualRefreshMessage(error instanceof Error ? error.message : "A távoli futás leállítása nem sikerült.");
          });
        } else if (!refreshSessionRef.current) {
          setManualRefreshMessage("A várakozás megszakadt; a közös vagy azonosítatlan GitHub-futás folytatódhat.");
        }
        return;
      }
      if (refreshSessionRef.current?.requestedAt !== refreshSession.requestedAt) return;
      setManualRefreshState("waiting");
      setManualRefreshMessage("GitHub-futtatóra várakozás");
      updateRefreshSession({ ...refreshSession, phase: "waiting", runId: dispatched.runId, ownsRun: dispatched.owned });
    }).catch((refreshError) => {
      dispatchRef.current = null;
      if (cancelledRefreshRequestsRef.current.delete(refreshSession.requestedAt)) {
        if (!refreshSessionRef.current) setManualRefreshMessage("A frissítési kérés visszavonva.");
        return;
      }
      if (refreshSessionRef.current?.requestedAt !== refreshSession.requestedAt) return;
      updateRefreshSession(null);
      setManualRefreshState("error");
      setManualRefreshMessage(refreshError instanceof Error ? refreshError.message : "A frissítés nem sikerült.");
    });
  }, [refreshSession, settings.githubToken, updateRefreshSession]);

  useEffect(() => {
    if (refreshSession?.phase !== "waiting" || !settings.githubToken || !settings.endpoint) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const freshData = await watchFreshDashboard(settings.endpoint, refreshSession.previousUpdatedAt, settings.githubToken, (step) => {
          if (!controller.signal.aborted) setManualRefreshMessage(step);
        }, controller.signal);
        if (controller.signal.aborted) return;
        setData(withRepairedClimate(freshData));
        await Promise.all([
          loadData(period, settings, anchor, customStart, customEnd),
          loadClimateHistory(settings, climatePeriod, climateAnchor, climateCustomStart, climateCustomEnd),
          loadBulgariaMix(settings),
          loadEnergyNews(settings),
        ]);
        if (controller.signal.aborted) return;
        setClock(Date.now());
        updateRefreshSession(null);
        setManualRefreshState("success");
        setManualRefreshMessage(freshData.warnings?.length
          ? `Kész: frissítés részleges; ${freshData.warnings.map((warning) => warning.source).join(", ")} nem frissült.`
          : `Kész: az új adatok megérkeztek (${formatTime(freshData.refreshedAt ?? freshData.updatedAt)}).`);
        window.setTimeout(() => {
          setManualRefreshState((current) => current === "success" ? "idle" : current);
          setManualRefreshMessage((current) => current.startsWith("Kész:") ? "" : current);
        }, 8_000);
      } catch (refreshError) {
        if (controller.signal.aborted) return;
        updateRefreshSession(null);
        setManualRefreshState("error");
        setManualRefreshMessage(refreshError instanceof Error ? refreshError.message : "A frissítés nem sikerült.");
      }
    })();
    return () => controller.abort();
  }, [refreshSession, settings, period, anchor, customStart, customEnd, climatePeriod, climateAnchor, climateCustomStart, climateCustomEnd, loadData, loadClimateHistory, loadBulgariaMix, loadEnergyNews, updateRefreshSession]);

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

  const manualRefreshBusy = Boolean(refreshSession);
  const manualRefreshLabel = manualRefreshState === "starting"
    ? "Indítás…"
    : manualRefreshState === "waiting"
      ? "Frissítés…"
      : manualRefreshState === "success"
        ? "Frissítve"
        : "Adatok frissítése";

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">Ugrás a tartalomhoz</a>
      <header className="topbar" id="oldal-teteje">
        <a href="#main" className="brand" aria-label="Pasztra tech: Napfény kezdőlap">
          <span className="brand__mark"><i /></span>
          <span>Pasztra tech<em>:</em> Napfény</span>
        </a>
        <div className="topbar__actions">
          <div className="theme-switch" role="group" aria-label="Megjelenés">
            <button type="button" className={themePreference === "system" ? "is-active" : ""} aria-label="Rendszerbeállítás követése" aria-pressed={themePreference === "system"} title="A rendszer megjelenésének követése" onClick={() => setThemePreference("system")}><span aria-hidden="true">◐</span><span>Rendszer</span></button>
            <button type="button" className={themePreference === "light" ? "is-active" : ""} aria-label="Világos mód" aria-pressed={themePreference === "light"} title="Világos mód" onClick={() => setThemePreference("light")}><span aria-hidden="true">☀</span><span>Világos</span></button>
            <button type="button" className={themePreference === "dark" ? "is-active" : ""} aria-label="Sötét mód" aria-pressed={themePreference === "dark"} title="Sötét mód" onClick={() => setThemePreference("dark")}><span aria-hidden="true">☾</span><span>Sötét</span></button>
          </div>
          <div className="stream-indicators" aria-label="Adatfolyamok állapota">
            <span className={`stream-indicator ${solarConnected ? "is-online" : "is-offline"}`} title={`Napelem: ${solarConnected ? "kapcsolódva" : "nincs friss adat"}`}><i /><span><strong>Napelem</strong><small>{solarConnected ? "kapcsolat" : data.connections?.solar.stale ? "korábbi adat" : "nincs adat"}</small></span></span>
            <span className={`stream-indicator ${climateConnected ? "is-online" : "is-offline"}`} title={`Hőmérséklet: ${climateConnected ? "kapcsolódva" : "nincs friss adat"}`}><i /><span><strong>Hőmérséklet</strong><small>{climateConnected ? "kapcsolat" : data.connections?.climate.stale ? "korábbi adat" : "nincs adat"}</small></span></span>
          </div>
          <button className={`data-refresh-button is-${manualRefreshState}`} onClick={triggerManualRefresh} disabled={manualRefreshBusy} title="Az oldal összes adatának frissítése" aria-describedby={manualRefreshBusy ? "manual-refresh-status" : undefined}>
            <i aria-hidden="true">↻</i><span>{manualRefreshLabel}</span>
          </button>
          <button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="Adatkapcsolat beállításai">•••</button>
        </div>
      </header>

      <div className="sticky-navigation">
      <nav className={`section-nav${navigationOpen ? " is-open" : ""}`} id="section-menu" aria-label="Ugrás az oldal szakaszaihoz">
        <div className="section-nav__mobile-controls">
        <button className={`section-nav__toggle${navigationOpen ? " is-open" : ""}`} type="button" aria-label={navigationOpen ? "Menü bezárása" : "Menü megnyitása"} aria-expanded={navigationOpen} aria-controls="section-menu-links" onClick={() => setNavigationOpen((open) => !open)}>
          <span className="menu-toggle__icon" aria-hidden="true"><i /><i /><i /></span>
          <strong>Menü</strong>
        </button>
        <button className="section-nav__refresh" type="button" onClick={triggerManualRefresh} disabled={manualRefreshBusy} title="Az oldal összes adatának frissítése" aria-label={manualRefreshBusy ? "Adatfrissítés folyamatban" : "Adatok frissítése"}>↻</button>
        </div>
        <div className="section-nav__track" id="section-menu-links">
          {PAGE_BLOCKS.map((block) => <a href={`#${block.id}`} key={block.id} aria-current={activeSection === block.id ? "location" : undefined} onClick={() => setNavigationOpen(false)}>{block.navigationLabel}</a>)}
        </div>
      </nav>
      {(manualRefreshBusy || translationStatus) && <div className="activity-bar" id="manual-refresh-status" role="status" aria-live="polite">
        {manualRefreshBusy && <span className="activity-bar__item"><i aria-hidden="true" /> <strong>Adatfrissítés</strong><span>{manualRefreshMessage}</span><button type="button" onClick={cancelManualRefresh} aria-label="Adatfrissítés visszavonása">Visszavonás</button></span>}
        {translationStatus && <span className="activity-bar__item"><i aria-hidden="true" /> <strong>Fordítás</strong><span>{translationStatus.step}: {translationStatus.title}</span>{translationStatus.queued > 0 && <em>+{translationStatus.queued} sorban</em>}<button type="button" onClick={translationStatus.cancel} aria-label="Aktuális fordítás visszavonása">Visszavonás</button></span>}
      </div>}
      </div>

      <main id="main">
        <section className="intro" id="kezdolap">
          <img className="intro__photo" src={`${import.meta.env.BASE_URL}${darkMode ? "pasztra-poster-hero-night.png?v=2" : "pasztra-poster-hero.png"}`} alt={`A hegyoldali otthon ${darkMode ? "éjszakai" : "nappali"}, turisztikai plakát stílusú látképe`} />
          <div className="intro__shade" aria-hidden="true" />
          <span className="sun-charm sun-charm--hero" aria-hidden="true"><i /></span>
          <div className="intro__content">
            <p className="eyebrow">{formatHeadingDate()}</p>
            <h1 lang="bg">Привет!</h1>
          </div>
        </section>

        {error && <div className="notice" role="status">{error}</div>}
        {Boolean(data.warnings?.length) && <div className="notice" role="status">
          {data.warnings?.map((warning) => <div key={warning.source}>
            <strong>{warning.source}:</strong> {warning.message}
            {warning.updatedAt ? ` Utolsó adat: ${retainedTimestampFormatter.format(new Date(warning.updatedAt))}.` : ""}
          </div>)}
        </div>}
        {!manualRefreshBusy && manualRefreshMessage && <div className={`notice manual-refresh-notice is-${manualRefreshState}`} role="status">{manualRefreshMessage}</div>}

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

        <SolarForecast data={data} />
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
          loading={manualRefreshBusy}
          refreshLabel={manualRefreshLabel}
          onRefresh={triggerManualRefresh}
        />

        <ConsumptionPlanner data={data} />

        <SunHorizon />

        <AirQuality endpoint={settings.endpoint} enabled={settings.live} refreshSeconds={settings.refreshSeconds} />

        <RegionalTransport loading={manualRefreshBusy} refreshLabel={manualRefreshLabel} onRefresh={triggerManualRefresh} />

        <EnergyNews data={energyNews} onRequestTranslation={settings.githubToken && settings.live && settings.endpoint ? translateNewsItem : undefined} onCancelRun={cancelNewsRun} onTranslationStatusChange={setTranslationStatus} />

        <BulgariaEnergyMix data={bulgariaMix} householdFallback={data.solar.energyChart} />

        <footer id="adatkapcsolat"><span>Utolsó adatfrissítés: {formatTime(data.updatedAt)}</span><button onClick={() => setSettingsOpen(true)}>Adatkapcsolat beállítása →</button></footer>
      </main>
      {settingsOpen && <SettingsPanel key={`${settings.live}-${settings.endpoint}-${settings.refreshSeconds}`} settings={settings} onClose={() => setSettingsOpen(false)} onSave={saveSettings} />}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
