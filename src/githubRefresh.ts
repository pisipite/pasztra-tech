import type { DashboardData, EnergyNewsData } from "./types";

const dispatchUrl = "https://api.github.com/repos/pisipite/pasztra-tech/actions/workflows/deploy-pages.yml/dispatches";
const apiVersion = "2022-11-28";

export type RefreshProgress = "starting" | "waiting";

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function dispatchWorkflow(token: string, inputs?: Record<string, string>) {
  const response = await fetch(dispatchUrl, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": apiVersion,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "main", ...(inputs ? { inputs } : {}) }),
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

export async function dispatchDashboardRefresh(token: string) {
  return dispatchWorkflow(token);
}

export async function dispatchNewsTranslation(token: string, articleUrl: string) {
  return dispatchWorkflow(token, { translate_news_url: articleUrl });
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

function comparableArticleUrl(value: string) {
  return value.replace(/[?#].*$/, "").toLowerCase();
}

export async function waitForNewsTranslation(newsUrl: URL, articleUrl: string, previousUpdatedAt: string) {
  const requestedUrl = comparableArticleUrl(articleUrl);
  const previousTime = new Date(previousUpdatedAt).getTime();
  for (let attempt = 0; attempt < 48; attempt += 1) {
    newsUrl.searchParams.set("updated", String(Date.now()));
    const response = await fetch(newsUrl, { cache: "no-store" });
    if (response.ok) {
      const candidate = await response.json() as EnergyNewsData;
      const translated = candidate.items?.find((item) => comparableArticleUrl(item.url) === requestedUrl);
      if (translated?.titleHu && translated.summaryHu) return candidate;
      const candidateTime = new Date(candidate.updatedAt).getTime();
      if (Number.isFinite(candidateTime) && candidateTime > previousTime && candidate.translation?.status === "error") {
        throw new Error(candidate.translation.error ?? "A Gemini nem tudta lefordítani a cikket.");
      }
    }
    await wait(5_000);
  }
  throw new Error("A fordítás elindult, de még nem jelent meg. Néhány perc múlva próbáld újra.");
}
