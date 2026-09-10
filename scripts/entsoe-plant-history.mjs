function mergeDayFragments(previous, fragment) {
  const hourlyMw = Array(24).fill(0);
  const hourlyCoverage = Array(24).fill(0);
  for (let hour = 0; hour < 24; hour += 1) {
    const oldCoverage = Number(previous?.hourlyCoverage?.[hour] ?? 0);
    const newCoverage = Number(fragment.hourlyCoverage?.[hour] ?? 0);
    if (newCoverage > 0) {
      hourlyMw[hour] = Number(fragment.hourlyMw?.[hour] ?? 0);
      hourlyCoverage[hour] = newCoverage;
    } else if (oldCoverage > 0) {
      hourlyMw[hour] = Number(previous.hourlyMw?.[hour] ?? 0);
      hourlyCoverage[hour] = oldCoverage;
    }
  }
  const observedHours = hourlyCoverage.reduce((sum, value) => sum + value, 0);
  const energyMwh = hourlyMw.reduce((sum, value, hour) => sum + value * hourlyCoverage[hour], 0);
  return {
    ...previous,
    ...fragment,
    energyMwh: Math.round(energyMwh * 10) / 10,
    averageMw: Math.round(energyMwh / Math.max(observedHours, 1) * 10) / 10,
    peakMw: Math.round(Math.max(0, ...hourlyMw) * 10) / 10,
    hourlyMw,
    hourlyCoverage,
    observedHours,
  };
}

export function mergePlantHistory(storedPlants, batches, historyFloor) {
  const plants = new Map((Array.isArray(storedPlants) ? storedPlants : []).map((plant) => [plant.id, {
    ...plant,
    days: Array.isArray(plant.days) ? plant.days.filter((day) => day?.date >= historyFloor) : [],
  }]));
  for (const batch of batches) {
    for (const plant of batch) {
      const current = plants.get(plant.id) ?? { ...plant, days: [] };
      current.name = plant.name;
      current.type = plant.type;
      current.latitude = plant.latitude;
      current.longitude = plant.longitude;
      current.capacityMw = plant.capacityMw;
      const days = new Map(current.days.filter((day) => day?.date >= historyFloor).map((day) => [day.date, day]));
      for (const fragment of plant.days.filter((day) => day?.date >= historyFloor)) {
        const previous = days.get(fragment.date);
        days.set(fragment.date, previous ? mergeDayFragments(previous, fragment) : fragment);
      }
      current.days = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
      plants.set(plant.id, current);
    }
  }
  return [...plants.values()]
    .map((plant) => ({ ...plant, days: plant.days.filter((day) => Number(day.observedHours ?? 0) >= 23) }))
    .filter((plant) => plant.days.length)
    .sort((a, b) => a.name.localeCompare(b.name, "hu"));
}
