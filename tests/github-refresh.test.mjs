import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Exercise the frontend source without requiring a Node TypeScript loader.
const source = await readFile(new URL("../src/githubRefresh.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { cancelWorkflowRun, currentRefreshStep, dispatchDashboardRefresh, dispatchNewsTranslation, waitForNewsTranslation, watchFreshDashboard } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const workflowUrl = "https://api.github.com/repos/pisipite/pasztra-tech/actions/workflows/deploy-pages.yml";
const now = Date.parse("2026-10-05T12:00:00.000Z");
const recentRun = {
  head_branch: "main",
  status: "queued",
  created_at: "2026-10-05T11:55:00.000Z",
};

function mockRuns(t, runs) {
  t.mock.method(Date, "now", () => now);
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url: String(url), options });
    if (options.method === "POST") return new Response(null, { status: 204 });
    return Response.json({ workflow_runs: runs });
  });
  return requests;
}

function mockBrowser(t) {
  const previous = globalThis.window;
  globalThis.window = {
    location: { href: "https://example.com/dashboard/" },
    setTimeout(callback) { queueMicrotask(callback); return 1; },
    clearTimeout() {},
  };
  t.after(() => {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  });
}

for (const status of ["queued", "in_progress", "waiting", "pending", "requested"]) {
  test(`a közelmúltbeli main ${status} futást új dispatch nélkül megvárja`, async (t) => {
    const requests = mockRuns(t, [{ ...recentRun, status }]);
    const dispatched = await dispatchDashboardRefresh("test-token");
    assert.deepEqual(dispatched, { runId: undefined, owned: false });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, `${workflowUrl}/runs?branch=main&per_page=100`);
    assert.equal(requests[0].options.cache, "no-store");
    assert.equal(requests[0].options.headers.Authorization, "Bearer test-token");
    assert.equal(requests[0].options.headers["X-GitHub-Api-Version"], "2022-11-28");
    assert.ok(!requests[0].url.includes("test-token"));
  });
}

test("befejezett és más ágon futó futás mellett normál frissítést indít", async (t) => {
  const requests = mockRuns(t, [
    { ...recentRun, status: "completed", conclusion: "success", created_at: "2026-10-05T10:00:00.000Z" },
    { ...recentRun, head_branch: "feature/dashboard" },
  ]);
  await dispatchDashboardRefresh("test-token");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, `${workflowUrl}/dispatches`);
  assert.equal(requests[1].options.method, "POST");
  assert.equal(requests[1].options.headers.Authorization, "Bearer test-token");
  assert.equal(requests[1].options.headers["X-GitHub-Api-Version"], "2026-03-10");
  assert.deepEqual(JSON.parse(requests[1].options.body), { ref: "main" });
});

test("a saját frissítési futás azonosítója visszakerül a visszavonáshoz", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => String(url).endsWith("/dispatches")
    ? Response.json({ workflow_run_id: 735 }, { status: 200 })
    : Response.json({ workflow_runs: [] }));
  assert.deepEqual(await dispatchDashboardRefresh("test-token"), { runId: 735, owned: true });
});

test("a saját GitHub-futás visszavonása az azonosított futást célozza", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response(null, { status: 202 });
  });
  await cancelWorkflowRun("test-token", 735);
  assert.equal(requests[0].url, "https://api.github.com/repos/pisipite/pasztra-tech/actions/runs/735/cancel");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.headers.Authorization, "Bearer test-token");
  await assert.rejects(cancelWorkflowRun("test-token", -1), /Érvénytelen/);
  assert.equal(requests.length, 1);
});

test("jogosultsági hiba esetén a visszavonás érthető hibát jelez", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 403 }));
  await assert.rejects(cancelWorkflowRun("test-token", 735), /Actions írási jogosultság/);
});

test("30 perce beragadt aktív main futás helyett kifejezett helyreállítást kér", async (t) => {
  const requests = mockRuns(t, [{ ...recentRun, created_at: "2026-10-05T11:30:00.000Z" }]);
  await dispatchDashboardRefresh("test-token");
  assert.equal(requests.length, 2);
  assert.deepEqual(JSON.parse(requests[1].options.body), { ref: "main", inputs: { force_refresh: "true" } });
});

test("régi beragadt futás mellett az újabb aktív futást megvárja, nem kényszerít helyreállítást", async (t) => {
  const requests = mockRuns(t, [
    { ...recentRun, created_at: "2026-10-05T11:00:00.000Z" },
    { ...recentRun, status: "in_progress" },
  ]);
  await dispatchDashboardRefresh("test-token");
  assert.equal(requests.length, 1);
});

for (const status of ["queued", "waiting", "pending", "requested"]) {
  test(`régi beragadt futás helyreállítását az új ${status} kérés nem akadályozza meg`, async (t) => {
    const requests = mockRuns(t, [
      { ...recentRun, status },
      { ...recentRun, status: "in_progress", run_started_at: "2026-10-05T11:00:00.000Z" },
    ]);
    await dispatchDashboardRefresh("test-token");
    assert.equal(requests.length, 2);
    assert.deepEqual(JSON.parse(requests[1].options.body), { ref: "main", inputs: { force_refresh: "true" } });
  });
}

test("a 30 perces helyreállítási határ előtt nem szakít meg futást", async (t) => {
  const requests = mockRuns(t, [{ ...recentRun, created_at: "2026-10-05T11:30:00.001Z" }]);
  await dispatchDashboardRefresh("test-token");
  assert.equal(requests.length, 1);
});

test("üres futáslista mellett frissítést indít", async (t) => {
  const requests = mockRuns(t, []);
  await dispatchDashboardRefresh("test-token");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].options.method, "POST");
});

test("régen létrehozott, de most újraindított futást is megvár", async (t) => {
  const requests = mockRuns(t, [{
    ...recentRun,
    created_at: "2026-10-04T12:00:00.000Z",
    run_started_at: "2026-10-05T11:59:00.000Z",
  }]);
  await dispatchDashboardRefresh("test-token");
  assert.equal(requests.length, 1);
});

test("az aktív futás hiányzó időbélyege miatt nem indít másolatot", async (t) => {
  const requests = mockRuns(t, [{ ...recentRun, created_at: undefined }]);
  await dispatchDashboardRefresh("test-token");
  assert.equal(requests.length, 1);
});

for (const status of [401, 403, 500]) {
  test(`sikertelen futáslekérdezés (${status}) után nem küld új dispatch kérést`, async (t) => {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response(null, { status }));
    await assert.rejects(dispatchDashboardRefresh("test-token"), /GitHub/);
    assert.equal(fetchMock.mock.callCount(), 1);
  });
}

test("érvénytelen futáslista mellett nem indít új frissítést", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({ message: "invalid response" }));
  await assert.rejects(dispatchDashboardRefresh("test-token"), /érvényes futáslistát/);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("a külön kért cikkfordítást aktív dashboard-futás mellett sem nyeli el", async (t) => {
  const requests = mockRuns(t, [recentRun]);
  const articleUrl = "https://example.com/news?article=1";
  await dispatchNewsTranslation("test-token", articleUrl);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `${workflowUrl}/dispatches`);
  assert.equal(requests[0].options.method, "POST");
  assert.deepEqual(JSON.parse(requests[0].options.body), { ref: "main", inputs: { translate_news_url: articleUrl } });
});

test("a GitHub futási lépéseiből konkrét frissítési státuszt készít", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    requests.push(String(url));
    if (String(url).includes("/jobs?")) return Response.json({ jobs: [{ steps: [{ name: "Friss Sungrow és Govee adatok", status: "in_progress" }] }] });
    return Response.json({ workflow_runs: [{ id: 123, status: "in_progress", head_branch: "main" }] });
  });
  assert.match(await currentRefreshStep("test-token"), /Sungrow, Govee, ENTSO-E és hírek/);
  assert.equal(requests.length, 2);
});

test("újratöltés után a friss adatot figyeli, új GitHub-dispatch nélkül", async (t) => {
  mockBrowser(t);
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    urls.push(String(url));
    if (String(url).includes("api.github.com")) return Response.json({ workflow_runs: [] });
    return Response.json({ updatedAt: "2026-10-05T12:01:00.000Z" });
  });
  const result = await watchFreshDashboard("data/{range}.json", "2026-10-05T11:00:00.000Z", "test-token", () => {});
  assert.equal(result.updatedAt, "2026-10-05T12:01:00.000Z");
  assert.ok(urls.every((url) => !url.includes("/dispatches")));
});

test("másik cikk fordítási hibája nem szakítja meg az aktuális fordítás figyelését", async (t) => {
  mockBrowser(t);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    if (calls === 1) return Response.json({ updatedAt: "2026-10-05T12:01:00Z", items: [], translation: { status: "error", requestedUrl: "https://example.com/other", error: "Másik cikk hibája" } });
    return Response.json({ updatedAt: "2026-10-05T12:02:00Z", items: [{ url: "https://example.com/article", titleHu: "Cím", summaryHu: "Ajánló" }] });
  });
  const result = await waitForNewsTranslation(new URL("https://example.com/news.json"), "https://example.com/article", "2026-10-05T12:00:00Z");
  assert.equal(result.items[0].titleHu, "Cím");
  assert.equal(calls, 2);
});

test("a megszakított fordítás nem kér le újabb híradatot", async (t) => {
  mockBrowser(t);
  const controller = new AbortController();
  controller.abort();
  const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({ items: [] }));
  await assert.rejects(waitForNewsTranslation(new URL("https://example.com/news.json"), "https://example.com/article", "2026-10-05T12:00:00Z", controller.signal), /megszakadt/);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("a fordítás várakozása megszakításra azonnal feloldódik", async (t) => {
  const previous = globalThis.window;
  globalThis.window = { setTimeout, clearTimeout };
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  const controller = new AbortController();
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    queueMicrotask(() => controller.abort());
    return Response.json({ updatedAt: "2026-10-05T12:00:00Z", items: [] });
  });
  await assert.rejects(waitForNewsTranslation(new URL("https://example.com/news.json"), "https://example.com/article", "2026-10-05T12:00:00Z", controller.signal), /megszakadt/);
  assert.equal(fetchMock.mock.callCount(), 1);
});
