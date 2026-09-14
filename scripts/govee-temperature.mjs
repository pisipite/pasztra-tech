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
  let previousCelsius;
  return samples.map((sample) => {
    const value = sample.temperature;
    const converted = fahrenheitToCelsius(value);
    const looksLikeUnconvertedFahrenheit = Number.isFinite(previousCelsius)
      && value >= 45 && value <= 120
      && Math.abs(value - previousCelsius) > 20
      && Math.abs(converted - previousCelsius) <= 15;
    const temperature = looksLikeUnconvertedFahrenheit ? converted : value;
    if (Number.isFinite(temperature)) previousCelsius = temperature;
    return looksLikeUnconvertedFahrenheit ? { ...sample, temperature } : sample;
  });
}
