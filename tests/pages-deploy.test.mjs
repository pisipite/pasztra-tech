import assert from "node:assert/strict";
import test from "node:test";
import { deployPages } from "../scripts/pages-deploy.mjs";

const env = {
  PAGES_ARTIFACT_ID: "12521216184", GITHUB_REPOSITORY: "owner/site", GITHUB_SHA: "abc123",
  GITHUB_TOKEN: "github-secret", ACTIONS_ID_TOKEN_REQUEST_URL: "https://identity.test/token",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "identity-secret",
};
const identity = { value: "oidc-secret" };
const created = { id: "42", page_url: "https://owner.github.io/site/" };

// HTTP status is separate from the status field in Pages JSON responses.
function scenario(responses, extra = {}) {
  const calls = [];
  const logs = [];
  const options = {
    env, log: (text) => logs.push(text), sleep: async () => {},
    fetcher: async (url, options) => {
      calls.push({ url, ...options });
      assert.ok(responses.length, "Unexpected API call");
      const next = responses.shift();
      if (next instanceof Error) throw next;
      const { http = 200, body = {} } = next;
      return new Response(http === 204 ? null : JSON.stringify(body), { status: http });
    },
    ...extra,
  };
  return { options, calls, logs };
}
const start = [{ body: identity }, { body: created }];

test("deploys the exact uploaded artifact without any artifact-list lookup", async () => {
  const h = scenario([...start, { body: { status: "deployment_in_progress" } }, { body: { status: "succeed" } }]);
  assert.equal(await deployPages(h.options), created.page_url);
  assert.equal(h.calls.length, 4);
  assert.ok(h.calls.every((call) => !call.url.includes("artifacts")));
  assert.deepEqual(JSON.parse(h.calls[1].body), {
    artifact_id: Number(env.PAGES_ARTIFACT_ID), pages_build_version: env.GITHUB_SHA, oidc_token: identity.value,
  });
  assert.equal(h.calls[0].headers.Authorization, `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`);
  assert.equal(h.calls[1].headers.Authorization, `Bearer ${env.GITHUB_TOKEN}`);
  assert.equal(h.logs.filter((line) => line.includes(identity.value)).length, 1);
  assert.ok(h.logs.includes(`::add-mask::${identity.value}`));
  assert.ok(h.logs.every((line) => !line.includes(env.GITHUB_TOKEN)));
});

test("retries transient status checks, never deployment creation", async () => {
  const h = scenario([...start, { http: 503 }, { http: 404 }, { http: 429 }, { body: { status: "succeed" } }]);
  assert.equal(await deployPages(h.options), created.page_url);
  assert.equal(h.calls.filter((call) => call.method === "POST").length, 1);
});

test("a lost create response fails without risking a duplicate deployment", async () => {
  const h = scenario([{ body: identity }, new Error("network lost")]);
  await assert.rejects(deployPages(h.options), /hálózati/);
  assert.equal(h.calls.length, 2);
});

test("failed deployments are not reported as success or redeployed", async () => {
  const h = scenario([...start, { body: { status: "deployment_content_failed" } }]);
  await assert.rejects(deployPages(h.options), /deployment_content_failed/);
  assert.equal(h.calls.length, 3);
});

test("permission errors are not retried and pending publication is cancelled", async () => {
  const h = scenario([...start, { http: 403 }, { http: 204 }]);
  await assert.rejects(deployPages(h.options), /HTTP 403/);
  assert.ok(h.calls.at(-1).url.endsWith("/42/cancel"));
});

test("status retry budget is bounded and cancels pending publication", async () => {
  const h = scenario([...start, ...Array.from({ length: 10 }, () => ({ http: 503 })), { http: 204 }]);
  await assert.rejects(deployPages(h.options), /HTTP 503/);
  assert.equal(h.calls.length, 13);
  assert.ok(h.calls.at(-1).url.endsWith("/42/cancel"));
});

test("user cancellation cancels the Pages deployment with a fresh request signal", async () => {
  const controller = new AbortController();
  const h = scenario([...start, { http: 204 }], {
    signal: controller.signal, sleep: async () => controller.abort(),
  });
  await assert.rejects(deployPages(h.options), { name: "AbortError" });
  assert.ok(h.calls.at(-1).url.endsWith("/42/cancel"));
  assert.equal(h.calls.at(-1).signal.aborted, false);
});

test("missing artifact ID fails before any API calls", async () => {
  const h = scenario([], { env: { ...env, PAGES_ARTIFACT_ID: "" } });
  await assert.rejects(deployPages(h.options), /PAGES_ARTIFACT_ID/);
  assert.equal(h.calls.length, 0);
});

test("timeout cancels publication instead of leaving an endless polling loop", async () => {
  const h = scenario([...start, { http: 204 }], {
    timeoutMs: 1, sleep: () => new Promise((resolve) => setTimeout(resolve, 20)),
  });
  await assert.rejects(deployPages(h.options), { name: "TimeoutError" });
  assert.ok(h.calls.at(-1).url.endsWith("/42/cancel"));
});

test("creation permission error is final and never retried", async () => {
  const h = scenario([{ body: identity }, { http: 403 }]);
  await assert.rejects(deployPages(h.options), /HTTP 403/);
  assert.equal(h.calls.length, 2);
});

test("status URL ID fallback stays on the configured GitHub API host", async () => {
  const h = scenario([{ body: identity }, { body: {
    status_url: "https://api.github.com/repos/owner/site/pages/deployments/42", page_url: created.page_url,
  } }, { body: { status: "succeed" } }]);
  assert.equal(await deployPages(h.options), created.page_url);
  assert.equal(h.calls.at(-1).url, "https://api.github.com/repos/owner/site/pages/deployments/42");
});
