import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/refreshSession.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { readRefreshSession, storeRefreshSession } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

function mockStorage(t) {
  const values = new Map();
  const old = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  t.after(() => { if (old === undefined) delete globalThis.localStorage; else globalThis.localStorage = old; });
  return values;
}

test("a futó frissítés újratöltés után is visszaállítható", (t) => {
  mockStorage(t);
  const session = { previousUpdatedAt: "2026-10-12T09:00:00Z", requestedAt: new Date().toISOString(), phase: "waiting" };
  storeRefreshSession(session);
  assert.deepEqual(readRefreshSession(), session);
  storeRefreshSession(null);
  assert.equal(readRefreshSession(), null);
});

test("a túl régi vagy hibás frissítési munkamenet nem blokkolja a gombot", (t) => {
  const values = mockStorage(t);
  storeRefreshSession({ previousUpdatedAt: "2026-10-12T09:00:00Z", requestedAt: "2026-10-01T09:00:00Z", phase: "waiting" });
  assert.equal(readRefreshSession(), null);
  assert.equal(values.size, 0);
  values.set("pasztra-active-refresh-v1", "not-json");
  assert.equal(readRefreshSession(), null);
});
