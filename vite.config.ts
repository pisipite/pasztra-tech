import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const runCollector = promisify(execFile);
const transportCollectorPath = fileURLToPath(new URL("./scripts/transport-collect.mjs", import.meta.url));
const personalSensorCollectorPath = fileURLToPath(new URL("./scripts/personal-sensor.mjs", import.meta.url));
let transportRefresh: Promise<unknown> | null = null;
let personalSensorRefresh: Promise<unknown> | null = null;
function collectPersonalSensor() {
  personalSensorRefresh ??= runCollector(process.execPath, [personalSensorCollectorPath], { timeout: 120_000, maxBuffer: 64 * 1024 })
    .finally(() => { personalSensorRefresh = null; });
  return personalSensorRefresh;
}

export default defineConfig({
  base: "./",
  plugins: [react(), {
    name: "local-transport-refresh",
    apply: "serve",
    configureServer(server) {
      const collect = () => void collectPersonalSensor().catch((error) => server.config.logger.warn(`[szenzor] ${error instanceof Error ? error.message : "Frissítési hiba"}`));
      collect();
      const sensorTimer = setInterval(collect, 5 * 60_000);
      server.httpServer?.once("close", () => clearInterval(sensorTimer));
      server.middlewares.use("/__personal-sensor/refresh", async (request, response) => {
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        if (request.method !== "POST") { response.statusCode = 405; response.end(JSON.stringify({ error: "Csak POST-kérés engedélyezett." })); return; }
        try {
          if (!request.headers.origin || new URL(request.headers.origin).host !== request.headers.host) throw new Error("Idegen eredet.");
          await collectPersonalSensor();
          response.end(JSON.stringify({ ok: true }));
        } catch (error) {
          server.config.logger.warn(`[szenzor] ${error instanceof Error ? error.message : "Frissítési hiba"}`);
          response.statusCode = 502;
          response.end(JSON.stringify({ error: "A helyi szenzorfrissítés nem sikerült." }));
        }
      });
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
