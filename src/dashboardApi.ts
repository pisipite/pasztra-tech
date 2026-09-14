import { dateInputValue, rangeForPeriod } from "./dateUtils";
import type { PeriodKey } from "./types";

export function dashboardUrl(endpoint: string, period: PeriodKey, anchor: Date, from?: string, to?: string) {
  const range = rangeForPeriod(period, from, to);
  const selectedDate = dateInputValue(anchor);
  const requestedRange = period === "day" && selectedDate !== dateInputValue(new Date()) ? `day-${selectedDate}` : range;
  const url = new URL(endpoint.replace("{range}", requestedRange), window.location.href);
  url.searchParams.set("range", range);
  url.searchParams.set("period", period);
  url.searchParams.set("date", selectedDate);
  if (period === "custom" && from && to) {
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);
  }
  return url;
}

export function dataFileUrl(endpoint: string, name: string) {
  const dashboard = new URL(endpoint.replace("{range}", "today"), window.location.href);
  return new URL(name, dashboard);
}

export async function fetchFreshJson<T>(url: URL): Promise<T> {
  url.searchParams.set("updated", String(Date.now()));
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<T>;
}
