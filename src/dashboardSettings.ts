export type DashboardSettings = {
  live: boolean;
  endpoint: string;
  refreshSeconds: number;
  githubToken: string;
};

const storageKey = "solar-home-settings";

export function getInitialSettings(): DashboardSettings {
  const configured = window.SOLAR_HOME_CONFIG ?? {};
  const saved = localStorage.getItem(storageKey);
  let savedSettings: DashboardSettings | undefined;
  if (saved) {
    try {
      savedSettings = JSON.parse(saved) as DashboardSettings;
    } catch {
      // Fall back to the checked-in public configuration.
    }
  }
  if (configured.mode === "live" && configured.endpoint) {
    return {
      live: true,
      endpoint: configured.endpoint,
      refreshSeconds: savedSettings?.refreshSeconds ?? configured.refreshSeconds ?? 300,
      githubToken: savedSettings?.githubToken ?? "",
    };
  }
  if (savedSettings) return { ...savedSettings, githubToken: savedSettings.githubToken ?? "" };
  return {
    live: configured.mode === "live",
    endpoint: configured.endpoint ?? "",
    refreshSeconds: configured.refreshSeconds ?? 300,
    githubToken: "",
  };
}

export function storeSettings(settings: DashboardSettings) {
  localStorage.setItem(storageKey, JSON.stringify(settings));
}
