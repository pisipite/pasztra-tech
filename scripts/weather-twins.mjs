import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isValidClimateValues } from "../shared/climateValidity.mjs";
import { DATA_SOURCE_ENDPOINTS } from "./data-sources/endpoints.mjs";
import { weatherTwinCities } from "./data-sources/weather-twin-cities.mjs";

const cacheMs = 30 * 60_000;
const observationMs = 45 * 60_000;

async function fetchCities(cities, fetchImpl) {
  const url = new URL(DATA_SOURCE_ENDPOINTS.openMeteo.forecastApi);
  url.searchParams.set("latitude", cities.map((city) => city[3]).join(","));
  url.searchParams.set("longitude", cities.map((city) => city[4]).join(","));
  url.searchParams.set("current", "temperature_2m,relative_humidity_2m");
  url.searchParams.set("timeformat", "unixtime");
  url.searchParams.set("forecast_days", "1");
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(8_000), headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Open-Meteo: HTTP ${response.status}`);
  const body = await response.json();
  const locations = Array.isArray(body) ? body : [body];
  if (locations.length !== cities.length) throw new Error("Az Open-Meteo válaszából helyszínek hiányoznak.");
  return locations.flatMap((location, index) => {
    const [city, country, locative] = cities[index];
    const { temperature_2m: temperatureC, relative_humidity_2m: humidityPct, time } = location?.current ?? {};
    return isValidClimateValues(temperatureC, humidityPct) && Number.isFinite(time)
      ? [{ city, country, locative, temperatureC, humidityPct, observedAt: time * 1000 }] : [];
  });
}

export async function getWeatherTwins(reference, now, { fetchImpl = fetch, cacheFile = resolve(".data-history/weather-city-conditions.json"), cities = weatherTwinCities } = {}) {
  const nowMs = now.getTime();
  const cache = await readFile(cacheFile, "utf8").then(JSON.parse).catch(() => null);
  const isFresh = ({ observedAt }) => observedAt <= nowMs && nowMs - observedAt <= observationMs;
  let observations = Array.isArray(cache?.observations) ? cache.observations.filter(isFresh) : [];
  if (!(cache?.checkedAt <= nowMs && nowMs - cache.checkedAt < cacheMs)) {
    const batches = [];
    for (let index = 0; index < cities.length; index += 60) batches.push(cities.slice(index, index + 60));
    const responses = await Promise.allSettled(batches.map((batch) => fetchCities(batch, fetchImpl)));
    const byCity = new Map(observations.map((item) => [`${item.city}/${item.country}`, item]));
    for (const response of responses) if (response.status === "fulfilled") {
      for (const item of response.value.filter(isFresh)) byCity.set(`${item.city}/${item.country}`, item);
    }
    observations = [...byCity.values()];
    await mkdir(dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, JSON.stringify({ checkedAt: nowMs, observations }), "utf8");
  }
  const distance = ({ temperatureC, humidityPct }) => Math.hypot((temperatureC - reference.temperatureC) / 2, (humidityPct - reference.humidityPct) / 8);
  return observations.sort((a, b) => distance(a) - distance(b)).slice(0, 6);
}
