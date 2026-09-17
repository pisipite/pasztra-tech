// Replace external API endpoints here. The fetch/normalization code should not
// need to change when a compatible provider URL moves.
export const DATA_SOURCE_ENDPOINTS = Object.freeze({
  entsoe: {
    api: "https://web-api.tp.entsoe.eu/api",
    website: "https://transparency.entsoe.eu/",
  },
  energyCharts: {
    api: "https://api.energy-charts.info/v2/public_power",
    website: "https://www.energy-charts.info/charts/power/chart.htm?c=BG&l=en",
  },
  openMeteo: {
    forecastApi: "https://api.open-meteo.com/v1/forecast",
  },
  govee: {
    devicesApi: "https://openapi.api.govee.com/router/api/v1/user/devices",
    stateApi: "https://openapi.api.govee.com/router/api/v1/device/state",
  },
  sungrow: {
    defaultHost: "https://gateway.isolarcloud.eu",
  },
  gemini: {
    translationApi: "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
  },
});
