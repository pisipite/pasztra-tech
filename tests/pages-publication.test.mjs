import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { assemblePublication, preparePublication } from "../scripts/pages-publication.mjs";

const commit = "abc123";
const now = new Date("2026-10-16T09:00:00Z");
const noNetwork = () => { throw new Error("Unexpected network call"); };
async function write(root, file, value) {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), typeof value === "string" ? value : JSON.stringify(value));
}
async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), "pasztra-publication-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function snapshot(t) {
  const root = await workspace(t);
  await write(root, "dist/index.html", '<script src="assets/site.js"></script>');
  await write(root, "dist/assets/site.js", "window.fixture = true;");
  await write(root, "public/config.js", 'window.SOLAR_HOME_CONFIG = { mode: "live" };');
  await write(root, "public/data/dashboard-today.json", { source: "live", updatedAt: now.toISOString(), solar: { todayKwh: 102.2 } });
  await write(root, "public/data/dashboard-day-2025-06-01.json", { source: "live", updatedAt: "2025-06-01T09:00:00Z" });
  await write(root, "public/data/energy-news.json", { items: [{ titleHu: "Magyar cím" }], sources: [] });
  const manifest = await assemblePublication({ root, commit, now });
  return { root, manifest };
}

test("same commit refresh reuses the built shell and restores published history", async (t) => {
  const { root } = await snapshot(t);
  await write(root, "public/data/dashboard-today.json", { wrong: true });
  assert.deepEqual(await preparePublication({ root, commit, event: "schedule", fetcher: noNetwork }), { buildRequired: false });
  const restored = JSON.parse(await readFile(join(root, "public/data/dashboard-today.json")));
  assert.equal(restored.solar.todayKwh, 102.2);
  assert.match(await readFile(join(root, "public/config.js"), "utf8"), /mode: "live"/);
  await write(root, "public/data/dashboard-today.json", { source: "live", updatedAt: now.toISOString(), solar: { todayKwh: 103 } });
  await assemblePublication({ root, commit, now });
  assert.equal(await readFile(join(root, "dist/assets/site.js"), "utf8"), "window.fixture = true;");
  assert.equal(await readFile(join(root, "dist/index.html"), "utf8"), '<script src="assets/site.js"></script>');
  assert.equal(JSON.parse(await readFile(join(root, "dist/data/dashboard-today.json"))).solar.todayKwh, 103);
  assert.ok(JSON.parse(await readFile(join(root, "dist/publication.json"))).files.some((file) => file.path === "data/dashboard-day-2025-06-01.json"));
});

test("push and a changed commit both require a rebuild", async (t) => {
  const { root } = await snapshot(t);
  assert.equal((await preparePublication({ root, commit, event: "push", fetcher: noNetwork })).buildRequired, true);
  assert.equal((await preparePublication({ root, commit: "new", event: "workflow_dispatch", fetcher: noNetwork })).buildRequired, true);
});

test("missing or damaged JavaScript forces a build even with intact index.html", async (t) => {
  const { root } = await snapshot(t);
  await rm(join(root, "dist/assets/site.js"));
  assert.equal((await preparePublication({ root, commit, event: "schedule", fetcher: noNetwork })).buildRequired, true);
  await write(root, "dist/assets/site.js", "damaged");
  assert.equal((await preparePublication({ root, commit, event: "schedule", fetcher: noNetwork })).buildRequired, true);
});

test("cache eviction restores every manifest data file from Pages, including old archives", async (t) => {
  const published = await snapshot(t);
  const root = await workspace(t);
  const requested = [];
  const fetcher = async (url) => {
    const path = new URL(url).pathname.replace("/site/", "");
    requested.push(path);
    return new Response(await readFile(join(published.root, "dist", path)));
  };
  const result = await preparePublication({ root, commit, event: "schedule", baseUrl: "https://example.com/site/", fetcher, translation: true });
  assert.equal(result.buildRequired, true);
  assert.ok(requested.includes("data/dashboard-day-2025-06-01.json"));
  assert.equal(JSON.parse(await readFile(join(root, "public/data/energy-news.json"))).items[0].titleHu, "Magyar cím");
});

test("corrupt remote data stops publication without replacing any working data", async (t) => {
  const { manifest } = await snapshot(t);
  const root = await workspace(t);
  await write(root, "public/data/dashboard-today.json", { good: true });
  const fetcher = async (url) => Response.json(new URL(url).pathname.endsWith("publication.json") ? manifest : { wrong: true });
  await assert.rejects(preparePublication({ root, commit, baseUrl: "https://example.com/", fetcher }), /Hiányos közzétett/);
  assert.deepEqual(JSON.parse(await readFile(join(root, "public/data/dashboard-today.json"))), { good: true });
});

test("a missed cache save cannot roll back a newer published translation", async (t) => {
  const { root } = await snapshot(t);
  const published = await snapshot(t);
  await write(published.root, "public/data/energy-news.json", { items: [{ titleHu: "Újabb fordítás" }], sources: [] });
  await assemblePublication({ root: published.root, commit, now: new Date(now.getTime() + 60_000) });
  const fetcher = async (url) => new Response(await readFile(join(published.root, "dist", new URL(url).pathname)));
  assert.equal((await preparePublication({ root, commit, event: "schedule", baseUrl: "https://example.com/", fetcher })).buildRequired, false);
  assert.equal(JSON.parse(await readFile(join(root, "public/data/energy-news.json"))).items[0].titleHu, "Újabb fordítás");
});

test("invalid paths in a snapshot are rejected before copying", async (t) => {
  const { root, manifest } = await snapshot(t);
  manifest.files[0].path = "../outside.json";
  await write(root, "dist/publication.json", manifest);
  await assert.rejects(preparePublication({ root, commit, fetcher: noNetwork }), /Érvénytelen adatfájl/);
});

test("code-owned map files are never restored over newer repo data", async (t) => {
  const { root } = await snapshot(t);
  await write(root, "public/data/transport-oblasts.geojson", { updated: true });
  await write(root, "dist/data/transport-oblasts.geojson", { old: true });
  await assemblePublication({ root, commit, now });
  await preparePublication({ root, commit: "new", event: "push", fetcher: noNetwork });
  assert.deepEqual(JSON.parse(await readFile(join(root, "public/data/transport-oblasts.geojson"))), { updated: true });
});

test("migration from the previous workflow recovers its existing data and daily archives", async (t) => {
  const root = await workspace(t);
  const fetcher = async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith("dashboard-today.json")) return Response.json({ source: "live", updatedAt: now.toISOString() });
    if (path.endsWith("dashboard-day-2026-10-15.json")) return Response.json({ solar: { todayKwh: 10 } });
    return new Response(null, { status: 404 });
  };
  assert.equal((await preparePublication({ root, commit, event: "push", baseUrl: "https://example.com/", fetcher })).buildRequired, true);
  assert.equal(JSON.parse(await readFile(join(root, "public/data/dashboard-day-2026-10-15.json"))).solar.todayKwh, 10);
});

test("translation without a recoverable feed fails instead of publishing an empty site", async (t) => {
  const root = await workspace(t);
  await assert.rejects(preparePublication({ root, commit, translation: true, fetcher: noNetwork }), /nincs visszaállítható hírfolyam/);
});

test("workflow keeps collection/build conditional and caches only after deployment", async () => {
  const require = createRequire(import.meta.resolve("eslint"));
  const { load } = require("js-yaml");
  const workflow = load(await readFile(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8"));
  const steps = workflow.jobs.build.steps;
  const findRun = (text) => steps.find((step) => step.run?.includes(text));
  assert.equal(findRun("scripts/fetch-live-data.sh").if, "inputs.translate_news_url == ''");
  assert.equal(findRun("scripts/transport-collect.mjs").if, "inputs.translate_news_url == ''");
  assert.equal(findRun("scripts/translate-news.mjs").if, "inputs.translate_news_url != ''");
  assert.equal(findRun("vite.js build").if, "steps.publication.outputs.build_required == 'true'");
  assert.ok(steps.findIndex((step) => step.name === "Közzétett oldal mentése") > steps.findIndex((step) => step.id === "deployment"));
  const upload = steps.find((step) => step.uses?.startsWith("actions/upload-pages-artifact@"));
  const deploy = steps.find((step) => step.id === "deployment");
  assert.equal(upload.id, "pages-artifact");
  assert.equal(deploy.env.PAGES_ARTIFACT_ID, "${{ steps.pages-artifact.outputs.artifact_id }}");
  assert.equal(deploy.run, "node scripts/pages-deploy.mjs");
  assert.equal(deploy["continue-on-error"], undefined);
  assert.equal(steps.filter((step) => step.run?.includes("scripts/pages-deploy.mjs")).length, 1);
  assert.deepEqual(workflow.permissions, { contents: "read", pages: "write", "id-token": "write" });
});
