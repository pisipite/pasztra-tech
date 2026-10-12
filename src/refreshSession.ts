const storageKey = "pasztra-active-refresh-v1";

export type RefreshSession = {
  previousUpdatedAt: string;
  requestedAt: string;
  phase: "dispatching" | "waiting";
};

export function readRefreshSession(): RefreshSession | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "null") as RefreshSession | null;
    if (!parsed || !Number.isFinite(Date.parse(parsed.requestedAt)) || !Number.isFinite(Date.parse(parsed.previousUpdatedAt))) return null;
    if (parsed.phase !== "dispatching" && parsed.phase !== "waiting") return null;
    if (Date.now() - Date.parse(parsed.requestedAt) > 30 * 60_000) {
      localStorage.removeItem(storageKey);
      return null;
    }
    return parsed;
  } catch { return null; }
}

export function storeRefreshSession(session: RefreshSession | null) {
  try {
    if (session) localStorage.setItem(storageKey, JSON.stringify(session));
    else localStorage.removeItem(storageKey);
  } catch { /* The current tab can still finish the refresh without storage. */ }
}
