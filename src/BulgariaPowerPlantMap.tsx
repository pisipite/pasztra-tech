import { useMemo, useState } from "react";
import { periodLabel, timestampInPeriod } from "./dateUtils";
import { formatFixedNumber, formatNumber } from "./formatUtils";
import type { BulgariaPowerPlant, BulgariaPowerPlantType, PeriodKey } from "./types";

type Props = {
  plants: BulgariaPowerPlant[];
  period: PeriodKey;
  anchor: Date;
  customStart: string;
  customEnd: string;
  dataFrom?: string;
  dataUntil?: string;
};

type PlantSummary = Omit<BulgariaPowerPlant, "days"> & {
  energyMwh: number;
  averageMw: number;
  peakMw: number;
  hourlyMw: number[];
  dayCount: number;
};

const mapBounds = { minLongitude: 22.32, maxLongitude: 28.63, minLatitude: 41.22, maxLatitude: 44.23 };
const colors: Record<BulgariaPowerPlantType, string> = {
  nuclear: "#d16b35",
  coal: "#777057",
  gas: "#cf5743",
  hydro: "#3987a0",
  solar: "#e9aa20",
  wind: "#118a87",
  other: "#8b9851",
};
const labels: Record<BulgariaPowerPlantType, string> = {
  nuclear: "Nukleáris",
  coal: "Szén",
  gas: "Földgáz",
  hydro: "Vízenergia",
  solar: "Napenergia",
  wind: "Szélenergia",
  other: "Egyéb",
};

function plantDateTimestamp(date: string) {
  return new Date(`${date}T12:00:00+03:00`).toISOString();
}

function aggregatePlants(plants: BulgariaPowerPlant[], period: PeriodKey, anchor: Date, customStart: string, customEnd: string) {
  return plants.flatMap((plant): PlantSummary[] => {
    const days = plant.days.filter((day) => timestampInPeriod(plantDateTimestamp(day.date), period, anchor, customStart, customEnd));
    if (!days.length) return [];
    const hourlyMw = Array.from({ length: 24 }, (_, hour) => {
      const values = days.map((day) => day.hourlyMw?.[hour]).filter((value): value is number => Number.isFinite(value));
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    });
    return [{
      ...plant,
      energyMwh: days.reduce((sum, day) => sum + day.energyMwh, 0),
      averageMw: days.reduce((sum, day) => sum + day.averageMw, 0) / days.length,
      peakMw: Math.max(0, ...days.map((day) => day.peakMw)),
      hourlyMw,
      dayCount: days.length,
    }];
  });
}

function mapX(longitude: number) {
  return 38 + (longitude - mapBounds.minLongitude) / (mapBounds.maxLongitude - mapBounds.minLongitude) * 684;
}

function mapY(latitude: number) {
  return 32 + (mapBounds.maxLatitude - latitude) / (mapBounds.maxLatitude - mapBounds.minLatitude) * 376;
}

function formatEnergy(value: number) {
  if (value >= 1000) return `${formatNumber(value / 1000, 1)} GWh`;
  return `${formatNumber(value, 1)} MWh`;
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const width = 280;
  const height = 76;
  const maximum = Math.max(1, ...values);
  const points = values.map((value, index) => `${index / Math.max(values.length - 1, 1) * width},${height - value / maximum * (height - 10) - 5}`).join(" ");
  return <svg className="plant-map-sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="A kiválasztott erőmű napi termelési profilja"><line x1="0" x2={width} y1={height - 5} y2={height - 5} /><polyline points={points} style={{ stroke: color }} /></svg>;
}

export function BulgariaPowerPlantMap({ plants, period, anchor, customStart, customEnd, dataFrom, dataUntil }: Props) {
  const latestAnchor = useMemo(() => dataUntil ? new Date(`${dataUntil}T12:00:00+03:00`) : anchor, [dataUntil, anchor]);
  const selected = useMemo(() => aggregatePlants(plants, period, anchor, customStart, customEnd), [plants, period, anchor, customStart, customEnd]);
  const showingLatestAvailable = period === "day" && !selected.length && Boolean(dataUntil);
  const visiblePlants = useMemo(
    () => showingLatestAvailable ? aggregatePlants(plants, "day", latestAnchor, customStart, customEnd) : selected,
    [showingLatestAvailable, plants, latestAnchor, customStart, customEnd, selected],
  );
  const [selectedId, setSelectedId] = useState<string>();
  const active = visiblePlants.find((plant) => plant.id === selectedId) ?? visiblePlants[0];
  const maximumEnergy = Math.max(1, ...visiblePlants.map((plant) => plant.energyMwh));
  const shownPeriod = showingLatestAvailable ? periodLabel("day", latestAnchor, customStart, customEnd) : periodLabel(period, anchor, customStart, customEnd);
  const availableTypes = [...new Set(visiblePlants.map((plant) => plant.type))];

  return (
    <section className="plant-map-panel" aria-labelledby="plant-map-title">
      <div className="plant-map-panel__head">
        <div><p className="eyebrow">Erőművi bontás</p><h3 id="plant-map-title">Erőművek a térképen</h3></div>
        <div><strong>{shownPeriod}</strong><span>{showingLatestAvailable ? "A legfrissebb elérhető nap · D+5" : "A kiválasztott időszak"}</span></div>
      </div>
      {visiblePlants.length ? <>
        <div className="plant-map-layout">
          <div className="plant-map-stage">
            <svg viewBox="0 0 760 440" role="img" aria-label="Bulgária térképe; a körök területe az erőművek termelésével arányos">
              <path className="plant-map-country" d="M159 41 L136 80 L146 128 L194 180 L158 227 L143 272 L181 311 L188 378 L272 384 L341 351 L409 395 L496 380 L498 326 L571 292 L660 316 L643 257 L664 208 L684 139 L622 121 L551 70 L470 88 L427 126 L355 117 L287 84 L216 99 Z" />
              <path className="plant-map-relief" d="M169 252 C244 207 294 224 351 261 S473 298 564 246 M232 331 C300 302 356 315 430 348 M454 164 C518 139 574 153 640 188" />
              {visiblePlants.map((plant) => {
                const radius = 8 + Math.sqrt(plant.energyMwh / maximumEnergy) * 34;
                const x = mapX(plant.longitude);
                const y = mapY(plant.latitude);
                const isActive = active?.id === plant.id;
                return <g key={plant.id} className={`plant-map-marker${isActive ? " is-active" : ""}`} role="button" tabIndex={0} aria-label={`${plant.name}: ${formatEnergy(plant.energyMwh)}`} onClick={() => setSelectedId(plant.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(plant.id); } }}>
                  <circle className="plant-map-marker__halo" cx={x} cy={y} r={radius + 5} />
                  <circle className="plant-map-marker__body" cx={x} cy={y} r={radius} style={{ fill: colors[plant.type] }} />
                  <text x={x + radius + 8} y={y + 4}>{plant.name}</text>
                </g>;
              })}
              <text className="plant-map-caption" x="22" y="424">A kör területe az időszak termelésével arányos</text>
            </svg>
          </div>
          {active && <aside className="plant-map-detail" aria-live="polite">
            <p>{labels[active.type]}</p>
            <h4>{active.name}</h4>
            <strong>{formatEnergy(active.energyMwh)}</strong>
            <span>termelés az ábrázolt időszakban</span>
            <div className="plant-map-detail__profile"><b>{period === "day" || showingLatestAvailable ? "Óránkénti profil" : "Átlagos napi profil"}</b><Sparkline values={active.hourlyMw} color={colors[active.type]} /></div>
            <dl>
              <div><dt>Átlagos teljesítmény</dt><dd>{formatNumber(active.averageMw, 1)} MW</dd></div>
              <div><dt>Csúcsteljesítmény</dt><dd>{formatNumber(active.peakMw, 1)} MW</dd></div>
              {Number.isFinite(active.capacityMw) && <div><dt>Beépített kapacitás</dt><dd>{formatFixedNumber(active.capacityMw!, 0)} MW</dd></div>}
              <div><dt>Lefedett napok</dt><dd>{active.dayCount}</dd></div>
            </dl>
          </aside>}
        </div>
        <div className="plant-map-legend" aria-label="Erőműtípusok jelmagyarázata">{availableTypes.map((type) => <span key={type}><i style={{ background: colors[type] }} />{labels[type]}</span>)}</div>
      </> : <div className="plant-map-empty"><strong>Erre az időszakra még nincs erőművenkénti adat.</strong><span>Az ENTSO-E a legalább 100 MW-os termelőegységek adatait öt nappal később teszi közzé.</span></div>}
      <p className="plant-map-source">ENTSO-E · erőművenkénti nettó termelés · legalább 100 MW · D+5{dataFrom && dataUntil ? ` · elérhető: ${dataFrom}–${dataUntil}` : ""}</p>
    </section>
  );
}
