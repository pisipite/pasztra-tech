// The page is composed from independent feature blocks. Keep cross-block imports
// routed through this file so moving or replacing a block stays a local change.
export { BulgariaEnergyMix } from "./bulgaria-energy/BulgariaEnergyMix";
export { makeDemoBulgariaEnergyMix } from "./bulgaria-energy/energyMixData";
export { EnergyAnalytics } from "./energy-flow/EnergyAnalytics";
export { SolarForecast } from "./forecast/SolarForecast";
export { DashboardCards } from "./home-climate/DashboardCards";
export { EnergyNews } from "./news/EnergyNews";
export { makeDemoEnergyNews } from "./news/newsData";
export { ConsumptionPlanner } from "./planner/ConsumptionPlanner";
export { SunHorizon } from "./sun-position/SunHorizon";
