export type ChartCoordinate = { x: number; y: number };

export function smoothPath(points: ChartCoordinate[]) {
  if (!points.length) return "";
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index];
    const midpoint = (previous.x + point.x) / 2;
    return `${path} C${midpoint},${previous.y} ${midpoint},${point.y} ${point.x},${point.y}`;
  }, `M${points[0].x},${points[0].y}`);
}

