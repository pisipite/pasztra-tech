export type DashboardSettings = {
  live: boolean;
  endpoint: string;
  refreshSeconds: number;
};

const storageKey = "solar-home-settings";

export function getInitialSettings(): DashboardSettings {
  const configured = window.SOLAR_HOME_CONFIG ?? {};
  const saved = localStorage.getItem(storageKey);
  if (saved) {
    try {
      return JSON.parse(saved) as DashboardSettings;
    } catch {
      // Fall back to the checked-in public configuration.
    }
  }
  return {
    live: configured.mode === "live",
    endpoint: configured.endpoint ?? "",
    refreshSeconds: configured.refreshSeconds ?? 300,
  };
}

export function storeSettings(settings: DashboardSettings) {
  localStorage.setItem(storageKey, JSON.stringify(settings));
}

