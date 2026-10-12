import type { DashboardData, EnergyNewsData } from "./types";

const workflowUrl = "https://api.github.com/repos/pisipite/pasztra-tech/actions/workflows/deploy-pages.yml";
const dispatchUrl = `${workflowUrl}/dispatches`;
const apiVersion = "2022-11-28";
const activeRunStatuses = new Set(["queued", "in_progress", "waiting", "pending", "requested"]);
const activeRunMaxAgeMs = 30 * 60_000;

type WorkflowRun = {
  id?: number;
  head_branch?: string;
  status?: string;
  created_at?: string;
  run_started_at?: string;
};

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

const stepLabels: Array<[string, string]> = [
  ["Friss Sungrow és Govee adatok", "Sungrow, Govee, ENTSO-E és hírek gyűjtése"],
  ["Mérési előzmények mentése", "Mérési előzmények mentése"],
  ["pnpm install", "Weboldal függőségeinek előkészítése"],
  ["pnpm build", "Ábrák és oldal összeállítása"],
  ["upload-pages-artifact", "Új oldal feltöltése"],
  ["Deploy", "Új oldal közzététele"],
];

export async function currentRefreshStep(token: string): Promise<string> {
  const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": apiVersion };
  const runsResponse = await fetch(`${workflowUrl}/runs?branch=main&per_page=10`, { headers, cache: "no-store" });
  if (!runsResponse.ok) throw new Error("A GitHub-futás állapota nem érhető el.");
  const runs = (await runsResponse.json() as { workflow_runs?: WorkflowRun[] }).workflow_runs ?? [];
  const active = runs.find((run) => run.status === "in_progress") ?? runs.find((run) => activeRunStatuses.has(run.status ?? ""));
  if (!active?.id) return "Közzétételre várakozás";
  if (active.status !== "in_progress") return "GitHub-futtatóra várakozás";
  const jobsResponse = await fetch(`https://api.github.com/repos/pisipite/pasztra-tech/actions/runs/${active.id}/jobs?per_page=10`, { headers, cache: "no-store" });
  if (!jobsResponse.ok) return "Adatgyűjtés folyamatban";
  const jobs = (await jobsResponse.json() as { jobs?: Array<{ steps?: Array<{ name?: string; status?: string }> }> }).jobs ?? [];
  const step = jobs.flatMap((job) => job.steps ?? []).find((item) => item.status === "in_progress");
  if (!step?.name) return "Adatgyűjtés folyamatban";
  return stepLabels.find(([name]) => step.name?.includes(name))?.[1] ?? "Előkészítés és közzététel";
}

export async function watchFreshDashboard(endpoint: string, previousUpdatedAt: string, token: string, onStep: (step: string) => void, signal?: AbortSignal) {
  const previousTime = new Date(previousUpdatedAt).getTime();
  const dashboardUrl = new URL(endpoint.replace("{range}", "today"), window.location.href);
  const startedAt = Date.now();
  let attempt = 0;
  while (!signal?.aborted && Date.now() - startedAt < 30 * 60_000) {
    if (attempt % 3 === 0) {
      try { onStep(await currentRefreshStep(token)); } catch { onStep("Új adatokra várakozás"); }
    }
    try {
      dashboardUrl.searchParams.set("updated", String(Date.now()));
      const response = await fetch(dashboardUrl, { cache: "no-store", signal });
      if (response.ok) {
        const candidate = await response.json() as DashboardData;
        const candidateTime = new Date(candidate.updatedAt).getTime();
        if (Number.isFinite(candidateTime) && candidateTime > previousTime) return candidate;
      }
    } catch { /* Temporary connection errors must not interrupt a running refresh. */ }
    attempt += 1;
    await wait(7_000);
  }
  if (signal?.aborted) throw new Error("A frissítés figyelése megszakadt.");
  throw new Error("Az új adatok 30 perc után sem jelentek meg. Ellenőrizd a GitHub Actions futást.");
}

function comparableArticleUrl(value: string) {
  return value.replace(/[?#].*$/, "").toLowerCase();
}

export async function waitForNewsTranslation(newsUrl: URL, articleUrl: string, previousUpdatedAt: string) {
  const requestedUrl = comparableArticleUrl(articleUrl);
  const previousTime = new Date(previousUpdatedAt).getTime();
  for (let attempt = 0; attempt < 300; attempt += 1) {
    newsUrl.searchParams.set("updated", String(Date.now()));
    let response: Response | undefined;
    try { response = await fetch(newsUrl, { cache: "no-store" }); } catch { /* retry transient connection errors */ }
    if (response?.ok) {
      const candidate = await response.json() as EnergyNewsData;
      const translated = candidate.items?.find((item) => comparableArticleUrl(item.url) === requestedUrl);
      if (translated?.titleHu && translated.summaryHu) return candidate;
      const candidateTime = new Date(candidate.updatedAt).getTime();
      if (Number.isFinite(candidateTime) && candidateTime > previousTime && candidate.translation?.status === "error" && candidate.translation.requestedUrl && comparableArticleUrl(candidate.translation.requestedUrl) === requestedUrl) {
        throw new Error(candidate.translation.error ?? "A Gemini nem tudta lefordítani a cikket.");
      }
    }
    await wait(5_000);
  }
  throw new Error("A fordítás 25 perc után sem jelent meg. Ellenőrizd a GitHub Actions futást.");
}
