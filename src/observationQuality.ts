// Shared chart rules: unknown and future observations are not zero readings.
export type TimedPoint = { timestamp?: string };

export function observationCutoff(collectedAt?: string, now = Date.now()) {
  const collected = Date.parse(collectedAt ?? "");
  return Number.isFinite(collected) ? Math.min(now, collected) : now;
}

export function observedPoints<T extends TimedPoint>(points: T[], collectedAt?: string, now = Date.now()) {
  const cutoff = observationCutoff(collectedAt, now);
  return points.filter((point) => point.timestamp && Number.isFinite(Date.parse(point.timestamp)) && Date.parse(point.timestamp) <= cutoff);
}

export function latestObservation<T extends TimedPoint>(points: T[], valid: (point: T) => boolean, now = Date.now()) {
  return observedPoints(points, undefined, now).filter(valid)
    .reduce<string | undefined>((latest, point) => !latest || Date.parse(point.timestamp!) > Date.parse(latest) ? point.timestamp : latest, undefined);
}

// Missing entries split paths; absent time slots split them too. Never bridge
// outages just because the provider omitted those rows from its response.
export function observationSegments<T extends TimedPoint>(points: T[], value: (point: T) => number | undefined, maxGapMs: number) {
  const segments: Array<Array<{ point: T; index: number; value: number }>> = [];
  let segment: typeof segments[number] = [];
  points.forEach((point, index) => {
    const amount = value(point);
    const time = Date.parse(point.timestamp ?? "");
    const previous = segment.at(-1);
    const gap = previous ? time - Date.parse(previous.point.timestamp ?? "") : 0;
    if (!Number.isFinite(amount) || !Number.isFinite(time) || gap > maxGapMs || gap < 0) {
      if (segment.length) segments.push(segment);
      segment = [];
    }
    if (Number.isFinite(amount) && Number.isFinite(time)) segment.push({ point, index, value: amount! });
  });
  if (segment.length) segments.push(segment);
  return segments;
}

export function recentSoc(points: Array<TimedPoint & { batterySoc?: number }>, now = Date.now()) {
  const measuredAt = latestObservation(points, (point) => Number.isFinite(point.batterySoc) && point.batterySoc! >= 0 && point.batterySoc! <= 100, now);
  if (!measuredAt || now - Date.parse(measuredAt) > 45 * 60_000) return undefined;
  return points.find((point) => point.timestamp === measuredAt && Number.isFinite(point.batterySoc));
}
