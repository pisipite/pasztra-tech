const generationKeys = ["nuclear", "coal", "gas", "hydro", "solar", "wind", "other"];

const roundedTenth = (value) => Math.round(value * 10) / 10;

export function repairNuclearDropouts(points) {
  return points.map((point, index) => {
    if (Number(point?.nuclear) > 0 || index === 0 || index === points.length - 1) return point;
    const previous = points[index - 1];
    const next = points[index + 1];
    const previousTime = new Date(previous?.timestamp).getTime();
    const currentTime = new Date(point?.timestamp).getTime();
    const nextTime = new Date(next?.timestamp).getTime();
    const previousNuclear = Number(previous?.nuclear);
    const nextNuclear = Number(next?.nuclear);
    if (currentTime - previousTime !== 3_600_000 || nextTime - currentTime !== 3_600_000) return point;
    if (!(previousNuclear > 500) || !(nextNuclear > 500)) return point;

    const oldGeneration = generationKeys.reduce((sum, key) => sum + Math.max(0, Number(point[key]) || 0), 0);
    const renewableGeneration = oldGeneration * Math.max(0, Number(point.renewableSharePct) || 0) / 100;
    const nuclear = roundedTenth((previousNuclear + nextNuclear) / 2);
    const generation = oldGeneration + nuclear;
    return {
      ...point,
      nuclear,
      imports: roundedTenth(Math.max(0, (Number(point.load) || 0) - generation)),
      renewableSharePct: generation > 0 ? roundedTenth(renewableGeneration / generation * 100) : 0,
    };
  });
}
