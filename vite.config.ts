import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const runCollector = promisify(execFile);
const transportCollectorPath = fileURLToPath(new URL("./scripts/transport-collect.mjs", import.meta.url));
let transportRefresh: Promise<unknown> | null = null;

export default defineConfig({
  base: "./",
  plugins: [react(), {
    name: "local-transport-refresh",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__transport/refresh", async (request, response) => {
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.end(JSON.stringify({ error: "Csak POST-kérés engedélyezett." }));
          return;
        }
        try {
          if (!request.headers.origin || new URL(request.headers.origin).host !== request.headers.host) {
            response.statusCode = 403;
            response.end(JSON.stringify({ error: "Csak a helyi oldal indíthat frissítést." }));
            return;
          }
        } catch {
          response.statusCode = 403;
          response.end(JSON.stringify({ error: "Érvénytelen kérés." }));
          return;
        }
        transportRefresh ??= runCollector(process.execPath, [transportCollectorPath], { timeout: 90_000, maxBuffer: 64 * 1024 })
          .finally(() => { transportRefresh = null; });
        try {
          await transportRefresh;
          response.end(JSON.stringify({ ok: true }));
        } catch (error) {
          server.config.logger.error(`[transport] Helyi frissítés sikertelen: ${error instanceof Error ? error.message : String(error)}`);
          response.statusCode = 502;
          response.end(JSON.stringify({ error: "A közlekedési adatgyűjtés nem sikerült." }));
        }
      });
    },
  }],
  build: {
    target: "es2020",
  },
});
