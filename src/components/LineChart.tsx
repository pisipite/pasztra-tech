import type { ChartPoint } from "../types";

type Props = {
  data: ChartPoint[];
  suffix: string;
  tone?: "solar" | "climate";
};

export function LineChart({ data, suffix, tone = "solar" }: Props) {
  if (!data.length) return <div className={`chart chart--${tone}`} aria-label="Nincs megjeleníthető adat" />;

  const maximum = Math.max(...data.map((item) => item.value), 1);
  const points = data.map((item, index) => ({
    x: data.length === 1 ? 50 : (index / (data.length - 1)) * 100,
    y: 88 - (item.value / maximum) * 72,
  }));
  const line = points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");

  return (
    <div className={`chart chart--${tone}`} aria-label={`Grafikon, maximum ${maximum.toFixed(1)} ${suffix}`}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img">
        <defs>
          <linearGradient id={`fill-${tone}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity=".28" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="chart__area" d={`${line} L100,92 L0,92 Z`} fill={`url(#fill-${tone})`} />
        <path className="chart__line" d={line} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="chart__labels">
        {data.map((item) => <span key={item.label}>{item.label}</span>)}
      </div>
    </div>
  );
}
