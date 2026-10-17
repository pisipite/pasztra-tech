// The Pages snapshot is immutable until deployment succeeds. A cache is an
// optimization, not the only copy: its public data manifest can restore it.
import { createHash } from "node:crypto";
import { appendFile, copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { addCalendarDays, dateKey } from "../shared/timeZone.mjs";

const manifestName = "publication.json";
const schemaVersion = 1;
// Geographical boundaries and other repo-owned assets are NOT runtime data:
// restoring them over a code update would undo the user's changes.
const dataPathPattern = /^data\/(dashboard-(today|7d|30d|year|day-\d{4}-\d{2}-\d{2})|govee-history|bulgaria-energy-mix|energy-news|air-quality|transport-live)\.json$/;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function readJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function validateManifest(manifest) {
  if (manifest?.schemaVersion !== schemaVersion || !Array.isArray(manifest.files) || manifest.files.length > 10_000) throw new Error("Érvénytelen publikációs jegyzék.");
  const paths = new Set();
  for (const file of manifest.files) {
    if (!dataPathPattern.test(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256) || paths.has(file.path)) throw new Error("Érvénytelen adatfájl a publikációs jegyzékben.");
    paths.add(file.path);
  }
}

async function shellFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) files.push(...await shellFiles(resolve(directory, entry.name), `${path}/`));
    else if (entry.isFile() && path !== manifestName && path !== "config.js" && !dataPathPattern.test(path)) {
      files.push({ path, sha256: digest(await readFile(resolve(directory, entry.name))) });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function copyData(from, to, manifest) {
  validateManifest(manifest);
  // Validate the complete snapshot before overwriting any working data.
  const entries = await Promise.all(manifest.files.map(async (file) => {
    const bytes = await readFile(resolve(from, file.path));
    if (digest(bytes) !== file.sha256) throw new Error(`Sérült adatpillanatkép: ${file.path}`);
    JSON.parse(bytes.toString("utf8"));
    return { path: file.path, bytes };
  }));
  for (const entry of entries) {
    await mkdir(dirname(resolve(to, entry.path)), { recursive: true });
    await writeFile(resolve(to, entry.path), entry.bytes);
  }
}

async function publicJson(baseUrl, path, fetcher) {
  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  url.searchParams.set("snapshot", String(Date.now()));
  const response = await fetcher(url, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Előző közzététel nem érhető el (${response.status}, ${path}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  JSON.parse(bytes.toString("utf8"));
  return bytes;
}

async function restorePublishedData(baseUrl, publicDir, fetcher, manifestBytes = undefined) {
  if (manifestBytes === undefined) manifestBytes = await publicJson(baseUrl, manifestName, fetcher);
  if (manifestBytes) {
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    validateManifest(manifest);
    const entries = [];
    // Bounded parallel downloads. Mismatched snapshots stop publication rather
    // than replacing good historical data with an incomplete restore.
    for (let offset = 0; offset < manifest.files.length; offset += 6) {
      entries.push(...await Promise.all(manifest.files.slice(offset, offset + 6).map(async (file) => {
        const bytes = await publicJson(baseUrl, file.path, fetcher);
        if (!bytes || digest(bytes) !== file.sha256) throw new Error(`Hiányos közzétett pillanatkép: ${file.path}`);
        return { path: file.path, bytes };
      })));
    }
    for (const { path, bytes } of entries) {
      await mkdir(dirname(resolve(publicDir, path)), { recursive: true });
      await writeFile(resolve(publicDir, path), bytes);
    }
    return;
  }

  // One-time migration from the old workflow, which had no manifest. 404 means
  // a source was never published; other errors must not silently discard it.
  const names = ["dashboard-today", "dashboard-7d", "dashboard-30d", "dashboard-year", "govee-history", "bulgaria-energy-mix", "energy-news", "air-quality", "transport-live"];
  let latest;
  for (const name of names) {
    const bytes = await publicJson(baseUrl, `data/${name}.json`, fetcher);
    if (!bytes) continue;
    await mkdir(resolve(publicDir, "data"), { recursive: true });
    await writeFile(resolve(publicDir, `data/${name}.json`), bytes);
    if (name === "dashboard-today") latest = JSON.parse(bytes.toString("utf8")).updatedAt;
  }
  if (latest && Number.isFinite(Date.parse(latest))) {
    for (let offset = 0; offset < 62; offset += 6) {
      await Promise.all(Array.from({ length: Math.min(6, 62 - offset) }, async (_, index) => {
        const path = `data/dashboard-day-${dateKey(addCalendarDays(latest, -offset - index))}.json`;
        const bytes = await publicJson(baseUrl, path, fetcher);
        if (bytes) await writeFile(resolve(publicDir, path), bytes);
      }));
    }
  }
}

export async function preparePublication({ root = process.cwd(), commit = process.env.GITHUB_SHA, event = process.env.GITHUB_EVENT_NAME, baseUrl = process.env.PAGES_BASE_URL, translation = Boolean(process.env.NEWS_TRANSLATION_URL), fetcher = fetch } = {}) {
  const dist = resolve(root, "dist");
  const publicDir = resolve(root, "public");
  const manifest = await readJson(resolve(dist, manifestName));
  let reusable = false;
  if (manifest) {
    await copyData(dist, publicDir, manifest);
    try {
      const index = await readFile(resolve(dist, "index.html"));
      const shell = await shellFiles(dist);
      reusable = Boolean(commit && manifest.buildCommit === commit && digest(index) === manifest.indexSha256
        && JSON.stringify(shell) === JSON.stringify(manifest.shellFiles));
    } catch { /* Rebuild a missing shell, while retaining recovered data. */ }
    // Deployment may have succeeded just before cache saving was cancelled or
    // failed. Never roll a newer published translation/history back to an older
    // cache. Checking the tiny manifest is cheap; data downloads are exceptional.
    if (baseUrl) {
      const publishedBytes = await publicJson(baseUrl, manifestName, fetcher);
      if (publishedBytes) {
        const published = JSON.parse(publishedBytes.toString("utf8"));
        validateManifest(published);
        if (Date.parse(published.publishedAt) > Date.parse(manifest.publishedAt)) {
          await restorePublishedData(baseUrl, publicDir, fetcher, publishedBytes);
        }
      }
    }
  } else if (baseUrl) {
    await restorePublishedData(baseUrl, publicDir, fetcher);
  }
  const dashboard = await readJson(resolve(publicDir, "data/dashboard-today.json"));
  if (dashboard && dashboard.source !== "demo") {
    await writeFile(resolve(publicDir, "config.js"), 'window.SOLAR_HOME_CONFIG = { mode: "live", endpoint: "./data/dashboard-{range}.json", refreshSeconds: 300 };\n');
  }
  if (translation && !await readJson(resolve(publicDir, "data/energy-news.json"))) throw new Error("A fordításhoz nincs visszaállítható hírfolyam; előbb adatfrissítés szükséges.");
  const buildRequired = event === "push" || !reusable;
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `build_required=${buildRequired}\n`);
  console.log(buildRequired ? "Weboldal-build szükséges (kódváltozás vagy hiányzó gyorsítótár)." : "A kész weboldal újrahasználható; build kihagyva.");
  return { buildRequired };
}

export async function assemblePublication({ root = process.cwd(), commit = process.env.GITHUB_SHA, now = new Date() } = {}) {
  if (!commit) throw new Error("Hiányzó build-azonosító.");
  const dist = resolve(root, "dist");
  const source = resolve(root, "public");
  const files = [];
  for (const entry of await readdir(resolve(source, "data"), { withFileTypes: true })) {
    const path = `data/${entry.name}`;
    if (!entry.isFile() || !dataPathPattern.test(path)) continue;
    const bytes = await readFile(resolve(source, path));
    JSON.parse(bytes.toString("utf8"));
    await mkdir(resolve(dist, "data"), { recursive: true });
    await writeFile(resolve(dist, path), bytes);
    files.push({ path, sha256: digest(bytes) });
  }
  await copyFile(resolve(source, "config.js"), resolve(dist, "config.js"));
  const indexSha256 = digest(await readFile(resolve(dist, "index.html")));
  const manifest = { schemaVersion, buildCommit: commit, publishedAt: now.toISOString(), indexSha256, files, shellFiles: await shellFiles(dist) };
  await writeFile(resolve(dist, manifestName), `${JSON.stringify(manifest)}\n`);
  console.log(`Kész publikáció: ${files.length} adatfájl; weboldal-verzió: ${commit.slice(0, 8)}.`);
  return manifest;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const command = process.argv[2];
  if (command === "prepare") await preparePublication();
  else if (command === "assemble") await assemblePublication();
  else throw new Error("Használat: node scripts/pages-publication.mjs prepare|assemble");
}
