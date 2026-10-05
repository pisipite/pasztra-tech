import type { DashboardData, EnergyNewsData } from "./types";

const workflowUrl = "https://api.github.com/repos/pisipite/pasztra-tech/actions/workflows/deploy-pages.yml";
const dispatchUrl = `${workflowUrl}/dispatches`;
const apiVersion = "2022-11-28";
const activeRunStatuses = new Set(["queued", "in_progress", "waiting", "pending", "requested"]);
const activeRunMaxAgeMs = 30 * 60_000;

type WorkflowRun = {
  head_branch?: string;
  status?: string;
  created_at?: string;
  run_started_at?: string;
};

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
  // Reuse a recent main run, including one waiting for a runner or deployment.
  // Bound the lookup and let a new request recover runs stalled for 30 minutes.
  const response = await fetch(`${workflowUrl}/runs?branch=main&per_page=100`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": apiVersion,
    },
    cache: "no-store",
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("A GitHub-token érvénytelen, lejárt, vagy nincs Actions olvasási jogosultsága.");
  }
  if (!response.ok) {
    throw new Error("A GitHubon futó frissítések állapota nem ellenőrizhető. Új futás nem indult; ellenőrizd a GitHub Actions állapotát.");
  }

  const payload = await response.json() as { workflow_runs?: WorkflowRun[] };
  if (!Array.isArray(payload.workflow_runs)) {
    throw new Error("A GitHub nem adott érvényes futáslistát. Új frissítés nem indult.");
  }
  const now = Date.now();
  const activeRuns = payload.workflow_runs.filter((run) => run.head_branch === "main" && activeRunStatuses.has(run.status ?? ""));
  const isStalled = (run: WorkflowRun) => {
    const startedAt = new Date(run.run_started_at ?? run.created_at ?? "").getTime();
    // Missing timestamps are not evidence that an active run is safe to replace.
    return Number.isFinite(startedAt) && now - startedAt >= activeRunMaxAgeMs;
  };
  const hasStalledRun = activeRuns.some(isStalled);
  const hasRecentRunning = activeRuns.some((run) => run.status === "in_progress" && !isStalled(run));
  // Protect a recent running build, but fresh queued requests must not hide an
  // older blocker indefinitely (the schedule can keep creating pending runs).
  if (activeRuns.length > 0 && (!hasStalledRun || hasRecentRunning)) return;

  // The workflow only permits this explicit recovery request to replace a run.
  return dispatchWorkflow(token, hasStalledRun ? { force_refresh: "true" } : undefined);
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

  throw new Error("Az új adatok még nem jelentek meg. A GitHub-futás várakozhat vagy még dolgozhat; új frissítést ne indíts. Az oldal később automatikusan betölti az új adatokat. A futás állapota a GitHub Actions oldalon ellenőrizhető.");
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
