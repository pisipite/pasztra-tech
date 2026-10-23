// Deploy the exact artifact returned by upload-pages-artifact. Do not discover it
// via the eventually consistent artifact-name listing used by deploy-pages v4.
// API contract: actions/deploy-pages/src/internal/api-client.js.
import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const terminalFailures = new Set([
  "deployment_failed", "deployment_perms_error", "deployment_content_failed",
  "deployment_cancelled", "deployment_lost",
]);

export async function deployPages({
  env = process.env, fetcher = fetch, log = console.log,
  sleep = (ms, signal) => delay(ms, undefined, { signal }),
  signal, timeoutMs = 600_000,
} = {}) {
  for (const key of ["PAGES_ARTIFACT_ID", "GITHUB_REPOSITORY", "GITHUB_SHA", "GITHUB_TOKEN",
    "ACTIONS_ID_TOKEN_REQUEST_URL", "ACTIONS_ID_TOKEN_REQUEST_TOKEN"]) {
    if (!env[key]) throw new Error(`Hiányzó deploy beállítás: ${key}`);
  }
  const artifactId = Number(env.PAGES_ARTIFACT_ID);
  if (!/^\d+$/.test(env.PAGES_ARTIFACT_ID) || !Number.isSafeInteger(artifactId) || artifactId <= 0) throw new Error("Érvénytelen Pages csomagazonosító.");
  if (!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY)) throw new Error("Érvénytelen repository.");

  const deadline = AbortSignal.timeout(timeoutMs);
  const active = signal ? AbortSignal.any([deadline, signal]) : deadline;
  const base = `${env.GITHUB_API_URL || "https://api.github.com"}/repos/${env.GITHUB_REPOSITORY}/pages/deployments`;
  let deploymentId;
  let settled = false;

  async function request(url, { token = env.GITHUB_TOKEN, body, requestSignal = active } = {}) {
    let response;
    try {
      response = await fetcher(url, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
          "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.any([requestSignal, AbortSignal.timeout(30_000)]),
        redirect: "error",
      });
    } catch {
      // Never log request bodies or raw exceptions containing credentials.
      throw new Error("GitHub hálózati hiba vagy időtúllépés.");
    }
    if (!response.ok) {
      const error = new Error(`GitHub Pages API: HTTP ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    if (response.status === 204) return {};
    return response.json();
  }

  try {
    const identity = await request(env.ACTIONS_ID_TOKEN_REQUEST_URL, { token: env.ACTIONS_ID_TOKEN_REQUEST_TOKEN });
    if (!identity.value) throw new Error("Nem érkezett GitHub OIDC azonosító.");
    log(`::add-mask::${identity.value}`);
    log(`Pages közzététel: ${env.PAGES_ARTIFACT_ID} azonosítójú feltöltött csomag.`);
    // Never retry this POST: a lost response does not imply creation failed.
    const created = await request(base, { body: {
      artifact_id: artifactId,
      pages_build_version: env.GITHUB_SHA,
      oidc_token: identity.value,
    } });
    deploymentId = created.id || created.status_url?.split("/").pop();
    if (!deploymentId) throw new Error("A GitHub nem adott vissza deployment-azonosítót.");
    const statusUrl = `${base}/${encodeURIComponent(deploymentId)}`;
    let errors = 0;
    let previousStatus;
    while (true) {
      await sleep(Math.min(5000 * (errors + 1), 30_000), active);
      active.throwIfAborted();
      let result;
      try {
        result = await request(statusUrl);
        errors = 0;
      } catch (error) {
        // Only read-only status checks may be retried, never permission errors.
        if (active.aborted || (error.status && error.status !== 404 && error.status !== 429 && error.status < 500) || ++errors >= 10) throw error;
        log(`A közzététel állapotának lekérése átmenetileg sikertelen (${errors}/10).`);
        continue;
      }
      if (result.status !== previousStatus) {
        log(`Pages állapot: ${result.status}`);
        previousStatus = result.status;
      }
      if (result.status === "succeed") {
        settled = true;
        const pageUrl = new URL(created.page_url);
        if (pageUrl.protocol !== "https:") throw new Error("Érvénytelen közzétett oldal URL.");
        return pageUrl.href;
      }
      if (terminalFailures.has(result.status)) {
        settled = true;
        throw new Error(`A GitHub Pages közzététel sikertelen: ${result.status}`);
      }
    }
  } finally {
    if (deploymentId && !settled) {
      try {
        // Separate timeout: the main signal is already aborted on cancellation.
        await request(`${base}/${encodeURIComponent(deploymentId)}/cancel`, {
          body: {}, requestSignal: AbortSignal.timeout(5000),
        });
        log("A függőben levő Pages közzétételt megszakítottuk.");
      } catch {
        log("::warning::A Pages közzététel megszakítását a GitHub nem igazolta vissza; ellenőrizd a futás állapotát.");
      }
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  try {
    const pageUrl = await deployPages({ signal: controller.signal });
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `page_url=${pageUrl}\n`);
    console.log(`Sikeres közzététel: ${pageUrl}`);
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
  }
}
