// Green: confirmed renewable sources. Blue: other or mixed-origin supply.
// Storage and grid flows do not establish the underlying generation source.
export const ENERGY_SOURCE_COLORS = {
  hydro: "var(--series-hydro)",
  solar: "var(--series-solar)",
  wind: "var(--series-wind)",
  nuclear: "var(--series-nuclear)",
  coal: "var(--series-coal)",
  gas: "var(--series-gas)",
  other: "var(--series-other)",
  imports: "var(--series-imports)",
  grid: "var(--series-grid)",
  gridFeedIn: "var(--series-grid-feed-in)",
  battery: "var(--series-battery)",
  batteryCharge: "var(--series-battery-charge)",
} as const;
