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
    .filter((plant) => plant.days.length)
    .sort((a, b) => a.name.localeCompare(b.name, "hu"));
}

const sofiaParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Sofia",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

export function reconcileNuclearPlant(plants, mixPoints) {
  const existingNuclear = plants.find((plant) => plant.id === "kozloduy");
  const availableDates = new Set(existingNuclear?.days?.map((day) => day.date) ?? []);
  if (!availableDates.size) return plants;
  const grouped = new Map();
  for (const point of mixPoints) {
    if (!Number.isFinite(point?.nuclear) || !(point.nuclear > 0)) continue;
    const parts = Object.fromEntries(sofiaParts.formatToParts(new Date(point.timestamp)).map((part) => [part.type, part.value]));
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    if (!availableDates.has(date)) continue;
    const hour = Number(parts.hour);
    const day = grouped.get(date) ?? { date, sums: Array(24).fill(0), counts: Array(24).fill(0) };
    day.sums[hour] += point.nuclear;
    day.counts[hour] += 1;
    grouped.set(date, day);
  }
  const days = [...grouped.values()].flatMap((day) => {
    const observedHours = day.counts.filter(Boolean).length;
    if (observedHours < 23) return [];
    const hourlyMw = day.sums.map((sum, hour) => day.counts[hour] ? Math.round(sum / day.counts[hour] * 10) / 10 : 0);
    const energyMwh = hourlyMw.reduce((sum, value) => sum + value, 0);
    return [{
      date: day.date,
      energyMwh: Math.round(energyMwh * 10) / 10,
      averageMw: Math.round(energyMwh / observedHours * 10) / 10,
      peakMw: Math.round(Math.max(...hourlyMw) * 10) / 10,
      hourlyMw,
      hourlyCoverage: day.counts.map((count) => count ? 1 : 0),
      observedHours,
    }];
  }).sort((a, b) => a.date.localeCompare(b.date));
  const nuclear = {
    ...existingNuclear,
    id: "kozloduy",
    name: "Kozloduj Atomerőmű",
    type: "nuclear",
    latitude: 43.746,
    longitude: 23.77,
    capacityMw: 2080,
    days,
  };
  return [...plants.filter((plant) => plant.id !== nuclear.id), ...(days.length ? [nuclear] : [existingNuclear])]
    .sort((a, b) => a.name.localeCompare(b.name, "hu"));
}
