// Green: confirmed renewable sources. Blue: other or mixed-origin supply.
// Storage and grid flows do not establish the underlying generation source.
export const ENERGY_SOURCE_COLORS = {
  hydro: "#246b43",
  solar: "#479e62",
  wind: "#8abb75",
  nuclear: "#285e8b",
  coal: "#173b5a",
  gas: "#4f88b4",
  other: "#78a7ca",
  imports: "#a3c2d9",
  grid: "#285e8b",
  gridFeedIn: "#78a7ca",
  battery: "#4f88b4",
  batteryCharge: "#a3c2d9",
} as const;
