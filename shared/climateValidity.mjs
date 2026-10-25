// A freezing temperature is valid. The legacy (0 °C, 0% RH) outage sentinel
// is not. Reject absent/non-numeric values without coercing them to zero.
export function isValidClimateValues(temperature, humidity) {
  return typeof temperature === "number" && Number.isFinite(temperature)
    && typeof humidity === "number" && Number.isFinite(humidity)
    && humidity > 0 && humidity <= 100;
}
