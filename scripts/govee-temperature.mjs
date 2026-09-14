export function fahrenheitToCelsius(value) {
  return Math.round((value - 32) * 5 / 9 * 10) / 10;
}

export function normalizeGoveeTemperature(value, declaredUnit = "") {
  const unit = String(declaredUnit).toLowerCase();
  // This sensor reports Fahrenheit in device/state even below 60 °F.
  // A numeric threshold leaves cold readings mislabelled as Celsius.
  return unit.includes("celsius") && !unit.includes("fahrenheit")
    ? value
    : fahrenheitToCelsius(value);
}

export function repairClimateHistory(samples) {
  const repaired = [...samples];
  for (const direction of [1, -1]) {
    let referenceCelsius;
    const indexes = Array.from({ length: repaired.length }, (_, index) => direction === 1 ? index : repaired.length - index - 1);
    for (const index of indexes) {
      const sample = repaired[index];
      const value = sample.temperature;
      if (!Number.isFinite(value)) continue;
      const converted = fahrenheitToCelsius(value);
      const looksLikeUnconvertedFahrenheit = Number.isFinite(referenceCelsius)
        && value >= 45 && value <= 120
        && Math.abs(value - referenceCelsius) > 20
        && Math.abs(converted - referenceCelsius) <= 15;
      if (looksLikeUnconvertedFahrenheit) repaired[index] = { ...sample, temperature: converted };
      referenceCelsius = repaired[index].temperature;
    }
  }
  return repaired;
}
