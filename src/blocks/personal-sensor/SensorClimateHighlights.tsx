import { useState } from "react";
import { dewPointC, freshSensorClimate } from "../../../shared/climateInsights.mjs";
import { formatNumber } from "../../formatUtils";
import type { PersonalSensorData } from "./types";

export function SensorClimateHighlights({ data, clock }: { data: PersonalSensorData | null; clock: number }) {
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState<"idle" | "active" | "dismissed">("idle");
  const showTwins = pinned || hover === "active";
  const closeTwins = () => { setPinned(false); setHover("dismissed"); };
  const climate = freshSensorClimate(data?.latest, clock);
  const dewPoint = climate ? dewPointC(climate.temperatureC, climate.humidityPct) : null;
  const twins = climate && Array.isArray(data?.weatherTwins)
    ? data.weatherTwins.filter(({ observedAt }) => observedAt <= clock && clock - observedAt <= 45 * 60_000).slice(0, 6)
    : [];

  return <div className="personal-sensor__highlights" aria-label="A friss mérésből számolt adatok">
    <details className="personal-sensor__highlight">
      <summary><span>Harmatpont</span> <small>becslés</small> <strong>{dewPoint === null ? "—" : `${formatNumber(dewPoint, 1)} °C`}</strong></summary>
      <div className="personal-sensor__highlight-content">
        <p>A hőmérséklet, amelyre lehűlve a levegő telítetté válik. A saját szenzor hőmérsékletéből és relatív páratartalmából becsüljük; a felületek hőmérséklete nélkül ez nem jelzi biztosan a páralecsapódást.</p>
        {dewPoint === null && <p>Most nincs friss, közel egyidejű hőmérséklet- és páramérés.</p>}
      </div>
    </details>
    {twins.length ? <div className="personal-sensor__highlight personal-sensor__twins"
      onPointerEnter={(event) => { if (event.pointerType === "mouse") setHover("active"); }}
      onPointerLeave={() => setHover("idle")}
      onBlur={(event) => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) closeTwins(); }}
      onKeyDown={(event) => { if (event.key === "Escape" && showTwins) { event.currentTarget.querySelector("button")?.focus(); closeTwins(); } }}>
      <button type="button" aria-expanded={showTwins} aria-controls="sensor-twin-cities" onClick={() => pinned ? closeTwins() : setPinned(true)}>Éppen mint <strong>{twins[0].locative}.</strong></button>
      <div id="sensor-twin-cities" className="personal-sensor__highlight-content" hidden={!showTwins}>
        <p>Hasonló hőmérséklet és páratartalom a saját szenzor méréseihez képest. Városi adatok: <a href="https://open-meteo.com/en/docs" target="_blank" rel="noreferrer">Open-Meteo</a> (modelladatok).</p>
        <ol>{twins.map((twin) => <li key={`${twin.city}-${twin.country}`}><b>{twin.city}</b><span>{twin.country} · {formatNumber(twin.temperatureC, 1)} °C · {formatNumber(twin.humidityPct, 0)}%</span></li>)}</ol>
      </div>
    </div> : <div className="personal-sensor__highlight personal-sensor__highlight--unavailable"><strong>Éppen mint</strong><small>{!data ? "Mérésre vár" : "Nincs friss összehasonlítható adat."}</small></div>}
  </div>;
}
