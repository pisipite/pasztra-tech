import type { DashboardData } from "./types";

const dispatchUrl = "https://api.github.com/repos/pisipite/pasztra-tech/actions/workflows/deploy-pages.yml/dispatches";
const apiVersion = "2022-11-28";

export type RefreshProgress = "starting" | "waiting";

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export async function dispatchDashboardRefresh(token: string) {
  const response = await fetch(dispatchUrl, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": apiVersion,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "main" }),
  });

  if (response.status === 204) return;

  let message = "A GitHub nem fogadta el a frissítési kérést.";
  try {
    const payload = await response.json() as { message?: string };
    if (payload.message) message = payload.message;
  } catch {
    // Keep the readable fallback when GitHub returns no JSON body.
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error("A GitHub-token érvénytelen, lejárt, vagy nincs Actions írási jogosultsága.");
  }
  throw new Error(message);
}

export async function waitForFreshDashboard(endpoint: string, previousUpdatedAt: string, onProgress: (progress: RefreshProgress) => void) {
  const previousTime = new Date(previousUpdatedAt).getTime();
  const dashboardUrl = new URL(endpoint.replace("{range}", "today"), window.location.href);

  onProgress("waiting");
  for (let attempt = 0; attempt < 40; attempt += 1) {
    dashboardUrl.searchParams.set("updated", String(Date.now()));
    const response = await fetch(dashboardUrl, { cache: "no-store" });
    if (response.ok) {
      const candidate = await response.json() as DashboardData;
      const candidateTime = new Date(candidate.updatedAt).getTime();
      if (Number.isFinite(candidateTime) && candidateTime > previousTime) return candidate;
    }
    await wait(5_000);
  }

  throw new Error("A frissítés elindult, de az új adatok még nem jelentek meg. Néhány perc múlva próbáld újra.");
}
