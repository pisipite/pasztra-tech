import { useEffect, useMemo, useState } from "react";

const latitude = 42.12836849354413;
const longitude = 23.223018914073588;
const quarterHourMs = 15 * 60 * 1000;
const radians = Math.PI / 180;
const degrees = 180 / Math.PI;
const chart = { left: 44, right: 956, bottom: 276, azimuthMin: 70, azimuthMax: 290 };

type SolarPosition = {
  altitude: number;
  azimuth: number;
};

type HorizonPoint = {
  azimuth: number;
  elevation: number;
};

const horizonProfile: HorizonPoint[] = [
  { azimuth: 70, elevation: 13 },
  { azimuth: 92, elevation: 18 },
  { azimuth: 118, elevation: 25 },
  { azimuth: 146, elevation: 32 },
  { azimuth: 170, elevation: 35 },
  { azimuth: 190, elevation: 27 },
  { azimuth: 211, elevation: 18 },
  { azimuth: 232, elevation: 12 },
  { azimuth: 254, elevation: 10 },
  { azimuth: 274, elevation: 16 },
  { azimuth: 290, elevation: 22 },
];

function normalize(value: number) {
  return ((value % 360) + 360) % 360;
}

function solarPosition(at: Date): SolarPosition {
  const julianDay = at.getTime() / 86_400_000 + 2_440_587.5;
  const century = (julianDay - 2_451_545) / 36_525;
  const geometricLongitude = normalize(280.46646 + century * (36_000.76983 + century * 0.0003032));
  const geometricAnomaly = normalize(357.52911 + century * (35_999.05029 - 0.0001537 * century));
  const eccentricity = 0.016708634 - century * (0.000042037 + 0.0000001267 * century);
  const equationOfCenter =
    Math.sin(geometricAnomaly * radians) * (1.914602 - century * (0.004817 + 0.000014 * century)) +
    Math.sin(2 * geometricAnomaly * radians) * (0.019993 - 0.000101 * century) +
    Math.sin(3 * geometricAnomaly * radians) * 0.000289;
  const trueLongitude = geometricLongitude + equationOfCenter;
  const omega = 125.04 - 1934.136 * century;
  const apparentLongitude = trueLongitude - 0.00569 - 0.00478 * Math.sin(omega * radians);
  const meanObliquity = 23 + (26 + (21.448 - century * (46.815 + century * (0.00059 - century * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * Math.cos(omega * radians);
  const declination = Math.asin(Math.sin(obliquity * radians) * Math.sin(apparentLongitude * radians));
  const y = Math.tan((obliquity * radians) / 2) ** 2;
  const equationOfTime = 4 * degrees * (
    y * Math.sin(2 * geometricLongitude * radians) -
    2 * eccentricity * Math.sin(geometricAnomaly * radians) +
    4 * eccentricity * y * Math.sin(geometricAnomaly * radians) * Math.cos(2 * geometricLongitude * radians) -
    0.5 * y * y * Math.sin(4 * geometricLongitude * radians) -
    1.25 * eccentricity * eccentricity * Math.sin(2 * geometricAnomaly * radians)
  );
  const utcMinutes = at.getUTCHours() * 60 + at.getUTCMinutes() + at.getUTCSeconds() / 60;
  const solarMinutes = ((utcMinutes + equationOfTime + 4 * longitude) % 1440 + 1440) % 1440;
  const hourAngle = (solarMinutes / 4 < 0 ? solarMinutes / 4 + 180 : solarMinutes / 4 - 180) * radians;
  const lat = latitude * radians;
  const cosZenith = Math.min(1, Math.max(-1,
    Math.sin(lat) * Math.sin(declination) + Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle),
  ));
  const zenith = Math.acos(cosZenith);
  const altitude = 90 - zenith * degrees;
  const denominator = Math.cos(lat) * Math.sin(zenith);
  const azimuthBase = denominator === 0
    ? 0
    : Math.acos(Math.min(1, Math.max(-1, (Math.sin(lat) * Math.cos(zenith) - Math.sin(declination)) / denominator))) * degrees;
  const azimuth = hourAngle > 0 ? normalize(azimuthBase + 180) : normalize(540 - azimuthBase);

  return { altitude, azimuth };
}

function snapToQuarterHour(value = new Date()) {
  return new Date(Math.floor(value.getTime() / quarterHourMs) * quarterHourMs);
}

function xForAzimuth(azimuth: number) {
  const clamped = Math.min(chart.azimuthMax, Math.max(chart.azimuthMin, azimuth));
  return chart.left + (clamped - chart.azimuthMin) / (chart.azimuthMax - chart.azimuthMin) * (chart.right - chart.left);
}

function yForElevation(elevation: number) {
  return Math.min(318, chart.bottom - elevation * 3.12);
}

function horizonElevation(azimuth: number) {
  const clamped = Math.min(chart.azimuthMax, Math.max(chart.azimuthMin, azimuth));
  const nextIndex = horizonProfile.findIndex((point) => point.azimuth >= clamped);
  if (nextIndex <= 0) return horizonProfile[0].elevation;
  const before = horizonProfile[nextIndex - 1];
  const after = horizonProfile[nextIndex];
  const ratio = (clamped - before.azimuth) / (after.azimuth - before.azimuth);
  return before.elevation + (after.elevation - before.elevation) * ratio;
}

function formatClock(value: Date) {
  return new Intl.DateTimeFormat("hu-HU", {
    timeZone: "Europe/Sofia",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function azimuthLabel(value: number) {
  if (value < 112.5) return "K";
  if (value < 157.5) return "DK";
  if (value < 202.5) return "D";
  if (value < 247.5) return "DNy";
  return "Ny";
}

function SunGlyph({ x, y, hidden }: { x: number; y: number; hidden: boolean }) {
  return (
    <g className={`horizon-sun${hidden ? " is-hidden" : ""}`} transform={`translate(${x} ${y})`}>
      {Array.from({ length: 12 }, (_, index) => (
        <line key={index} x1="0" y1="-18" x2="0" y2="-27" transform={`rotate(${index * 30})`} />
      ))}
      <circle r="13" />
      <circle className="horizon-sun__core" r="7" />
    </g>
  );
}

export function SunHorizon() {
  const [now, setNow] = useState(snapToQuarterHour);

  useEffect(() => {
    let intervalId = 0;
    const delay = quarterHourMs - Date.now() % quarterHourMs + 50;
    const timeoutId = window.setTimeout(() => {
      setNow(snapToQuarterHour());
      intervalId = window.setInterval(() => setNow(snapToQuarterHour()), quarterHourMs);
    }, delay);
    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
    };
  }, []);

  const model = useMemo(() => {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const points = Array.from({ length: 97 }, (_, index) => {
      const time = new Date(start.getTime() + index * quarterHourMs);
      return { time, ...solarPosition(time) };
    });
    const current = solarPosition(now);
    const daylight = points.filter((point) => point.altitude >= -0.8);
    const pathPoints = points
      .filter((point) => point.azimuth >= chart.azimuthMin && point.azimuth <= chart.azimuthMax && point.altitude >= -6)
      .map((point) => `${xForAzimuth(point.azimuth).toFixed(1)},${yForElevation(point.altitude).toFixed(1)}`)
      .join(" ");
    return {
      current,
      daylight,
      pathPoints,
      x: xForAzimuth(current.azimuth),
      y: yForElevation(current.altitude),
      visible: current.altitude > horizonElevation(current.azimuth),
    };
  }, [now]);

  const sunrise = model.daylight[0]?.time;
  const sunset = model.daylight.at(-1)?.time;
  const status = model.current.altitude < 0
    ? "a horizont alatt"
    : model.visible ? "a hegy fölött" : "a hegy mögött";

  return (
    <section className="sun-horizon-card" id="napallas" aria-labelledby="sun-horizon-title" data-testid="sun-horizon">
      <header className="sun-horizon-head">
        <div>
          <p className="eyebrow">ÉGI IRÁNYTŰ</p>
          <h2 id="sun-horizon-title">Nap és horizont</h2>
          <p>A nap pillanatnyi helyzete a pasztrai hegyoldal vázlatos körvonala fölött.</p>
        </div>
        <span className={`sun-horizon-status${model.visible ? " is-visible" : ""}`}>
          <i aria-hidden="true" />{status}
        </span>
      </header>

      <div className="sun-horizon-readings" aria-label="A nap aktuális adatai">
        <div><span>Időpont</span><strong>{formatClock(now)}</strong><small>15 perces állás</small></div>
        <div><span>Irányszög</span><strong>{Math.round(model.current.azimuth)}°</strong><small>{azimuthLabel(model.current.azimuth)}</small></div>
        <div><span>Magasság</span><strong>{Math.round(model.current.altitude)}°</strong><small>a geometriai horizonttól</small></div>
        <div><span>Nappali ív</span><strong>{sunrise ? formatClock(sunrise) : "–"}–{sunset ? formatClock(sunset) : "–"}</strong><small>napkelte–napnyugta</small></div>
      </div>

      <div className="sun-horizon-scene">
        <svg viewBox="0 0 1000 344" role="img" aria-labelledby="sun-horizon-svg-title sun-horizon-svg-desc">
          <title id="sun-horizon-svg-title">A nap napi pályája a hegyoldal felett</title>
          <desc id="sun-horizon-svg-desc">A nap helyzete negyedóránként frissül. A hegyoldal körvonala a megadott Street View panoráma egyszerűsített rajza.</desc>
          <defs>
            <linearGradient id="horizon-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#d8e2d4" />
              <stop offset=".62" stopColor="#f1d8a8" />
              <stop offset="1" stopColor="#f3c87c" />
            </linearGradient>
            <linearGradient id="horizon-mountain" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#294b3d" />
              <stop offset="1" stopColor="#18382f" />
            </linearGradient>
            <filter id="sun-glow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <rect x="0" y="0" width="1000" height="344" rx="14" fill="url(#horizon-sky)" />
          <g className="horizon-compass" aria-hidden="true">
            {[90, 120, 150, 180, 210, 240, 270].map((azimuth) => (
              <line key={azimuth} x1={xForAzimuth(azimuth)} y1="28" x2={xForAzimuth(azimuth)} y2="282" />
            ))}
          </g>
          <polyline className="horizon-sun-path" points={model.pathPoints} />
          <line className="horizon-now-line" x1={model.x} y1={model.y + 28} x2={model.x} y2={yForElevation(horizonElevation(model.current.azimuth))} />
          <path className="horizon-mountain horizon-mountain--back" d="M0 220 L80 197 L170 172 L250 185 L340 218 L430 238 L530 229 L620 244 L720 223 L820 238 L910 205 L1000 197 L1000 344 L0 344 Z" />
          <path className="horizon-mountain" d={`M${chart.left} ${yForElevation(horizonProfile[0].elevation)} ${horizonProfile.slice(1).map((point) => `L${xForAzimuth(point.azimuth)} ${yForElevation(point.elevation)}`).join(" ")} L${chart.right} 344 L${chart.left} 344 Z`} />
          <path className="horizon-tree-line" d="M44 236 l12 -25 l5 16 l10 -34 l10 34 l13 -22 l7 31 M126 206 l12 -31 l6 18 l9 -39 l11 43 M202 180 l13 -35 l7 21 l10 -44 l11 51 M285 184 l11 -28 l6 15 l9 -37 l11 43 M792 225 l10 -28 l6 15 l8 -34 l10 39 M886 203 l13 -38 l7 22 l10 -45 l12 52" />
          <SunGlyph x={model.x} y={model.y} hidden={!model.visible} />
          <g className="horizon-labels" aria-hidden="true">
            <text x={xForAzimuth(90)} y="326">K · 90°</text>
            <text x={xForAzimuth(180)} y="326">D · 180°</text>
            <text x={xForAzimuth(270)} y="326">Ny · 270°</text>
          </g>
        </svg>
      </div>

      <div className="sun-horizon-foot">
        <span>A hegyprofil vázlatos becslés a megadott panoráma alapján.</span>
        <a href="https://maps.app.goo.gl/yDBw8xF1mJ76oC7F7" target="_blank" rel="noreferrer">Street View megnyitása ↗</a>
      </div>
    </section>
  );
}
