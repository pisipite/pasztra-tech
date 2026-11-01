export const APPLIANCE_PRESETS = [
  { id: "washer", label: "Mosógép", energyKwh: 0.5, durationMinutes: 120 },
  { id: "hotplate", label: "Rezsó", energyKwh: 1.5, durationMinutes: 30 },
  { id: "boiler", label: "Bojler", energyKwh: 2, durationMinutes: 180 },
] as const;

export type AppliancePresetId = (typeof APPLIANCE_PRESETS)[number]["id"];
export type ApplianceSelection = AppliancePresetId | "custom";

export function findAppliancePreset(id: unknown) {
  return APPLIANCE_PRESETS.find((preset) => preset.id === id);
}

export function restoreApplianceSelection(id: unknown, trial: { energyKwh: number; durationMinutes: number }): ApplianceSelection {
  const preset = findAppliancePreset(id);
  return preset && preset.energyKwh === trial.energyKwh && preset.durationMinutes === trial.durationMinutes ? preset.id : "custom";
}
