import { useEffect, useMemo, useRef, useState } from "react";
import type { DashboardData, SolarForecast } from "./types";

type DayOffset = 0 | 1 | 2;

type BatterySettings = {
  capacityKwh: number;
  reservePct: number;
  maxPowerKw: number;
  efficiencyPct: number;
  idleLossPctPerDay: number;
  fallbackSocPct: number;
};

type TrialLoad = {
  energyKwh: number;
  durationMinutes: number;
  dayOffset: DayOffset;
};

type PlannerSlot = {
  timestamp: number;
  expectedPowerKw: number;
  dayOffset: DayOffset;
};

type Simulation = {
  socSeries: number[];
  testPvKwh: number;
  testBatteryKwh: number;
  testGridKwh: number;
  testStoredBatteryKwh: number;
};

type Plan = {
  startIndex: number;
  slotCount: number;
  powerKw: number;
  simulation: Simulation;
  baseline: Simulation;
  rechargeIndex?: number;
};

type DragState = {
  pointerId: number;
  offsetMinutes: number;
};

const STORAGE_KEY = "pasztra-consumption-trial-v2";
const SLOT_HOURS = .25;
const DEFAULT_BATTERY_SETTINGS: BatterySettings = {
  capacityKwh: 9.6,
  reservePct: 10,
  maxPowerKw: 5,
  efficiencyPct: 95,
  idleLossPctPerDay: 1,
  fallbackSocPct: 80,
};

function flexibleDay(): DayOffset {
  return new Date().getHours() >= 20 ? 1 : 0;
}

function defaultTrial(): TrialLoad {
  return { energyKwh: 3, durationMinutes: 120, dayOffset: flexibleDay() };
}

function dateKey(value: Date | number) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatClock(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" });
}

function formatDay(date: string | undefined, fallback: string) {
  if (!date) return fallback;
  return new Date(`${date}T12:00:00`).toLocaleDateString("hu-HU", { month: "short", day: "numeric", weekday: "short" });
}

function makeSlots(forecast: SolarForecast): PlannerSlot[] {
  const days = forecast.days.slice(0, 3);
  const dates = days.map((day) => day.date);
  return days.flatMap((day, dayIndex) => day.points.flatMap((point, pointIndex) => {
    const start = new Date(point.timestamp).getTime();
    const nextPower = day.points[pointIndex + 1]?.expectedPowerKw ?? point.expectedPowerKw;
    return Array.from({ length: 4 }, (_, quarter): PlannerSlot => ({
      timestamp: start + quarter * 15 * 60_000,
      expectedPowerKw: point.expectedPowerKw + (nextPower - point.expectedPowerKw) * quarter / 4,
      dayOffset: dayIndex as DayOffset,
    }));
  })).filter((slot) => dates[slot.dayOffset] === dateKey(slot.timestamp));
}

function candidateStarts(trial: TrialLoad, slots: PlannerSlot[]) {
  const slotCount = Math.max(1, Math.ceil(trial.durationMinutes / 15));
  return slots.flatMap((slot, index) => {
    if (slot.dayOffset !== trial.dayOffset || slot.timestamp < Date.now()) return [];
    const endSlot = slots[index + slotCount - 1];
    return endSlot?.dayOffset === trial.dayOffset ? [index] : [];
  });
}

function simulate(slots: PlannerSlot[], baseLoadKw: number, battery: BatterySettings, startSocPct: number, startIndex?: number, slotCount = 0, testPowerKw = 0): Simulation {
  const capacityKwh = Math.max(.1, battery.capacityKwh);
  const reserveKwh = capacityKwh * Math.max(0, Math.min(100, battery.reservePct)) / 100;
  const efficiency = Math.max(.5, Math.min(1, battery.efficiencyPct / 100));
  const maximumSlotEnergy = Math.max(0, battery.maxPowerKw) * SLOT_HOURS;
  const retention = Math.max(0, 1 - Math.max(0, battery.idleLossPctPerDay) / 100) ** (SLOT_HOURS / 24);
  let storedKwh = capacityKwh * Math.max(0, Math.min(100, startSocPct)) / 100;
  let testPvKwh = 0;
  let testBatteryKwh = 0;
  let testGridKwh = 0;
  let testStoredBatteryKwh = 0;
  const socSeries: number[] = [];

  slots.forEach((slot, index) => {
    storedKwh *= retention;
    const trialActive = startIndex !== undefined && index >= startIndex && index < startIndex + slotCount;
    const baseDemand = Math.max(0, baseLoadKw) * SLOT_HOURS;
    const testDemand = trialActive ? testPowerKw * SLOT_HOURS : 0;
    let pvAvailable = Math.max(0, slot.expectedPowerKw) * SLOT_HOURS;

    const pvForBase = Math.min(baseDemand, pvAvailable);
    pvAvailable -= pvForBase;
    const pvForTest = Math.min(testDemand, pvAvailable);
    pvAvailable -= pvForTest;
    testPvKwh += pvForTest;

    const baseShortfall = baseDemand - pvForBase;
    const testShortfall = testDemand - pvForTest;
    const availableFromBattery = Math.min(maximumSlotEnergy, Math.max(0, storedKwh - reserveKwh) * efficiency);
    const batteryForBase = Math.min(baseShortfall, availableFromBattery);
    const batteryForTest = Math.min(testShortfall, availableFromBattery - batteryForBase);
    const totalBatteryDelivery = batteryForBase + batteryForTest;
    storedKwh -= totalBatteryDelivery / efficiency;
    testBatteryKwh += batteryForTest;
    testStoredBatteryKwh += batteryForTest / efficiency;
    testGridKwh += testShortfall - batteryForTest;

    const acceptedPv = Math.min(pvAvailable, maximumSlotEnergy, Math.max(0, capacityKwh - storedKwh) / efficiency);
    storedKwh += acceptedPv * efficiency;
    socSeries.push(Math.max(0, Math.min(100, storedKwh / capacityKwh * 100)));
  });

  return { socSeries, testPvKwh, testBatteryKwh, testGridKwh, testStoredBatteryKwh };
}

function makePlan(trial: TrialLoad, slots: PlannerSlot[], baseLoadKw: number, battery: BatterySettings, startSocPct: number, manualStart?: number): Plan | undefined {
  const slotCount = Math.max(1, Math.ceil(trial.durationMinutes / 15));
  const powerKw = trial.energyKwh / (slotCount * SLOT_HOURS);
  const candidates = candidateStarts(trial, slots);
  if (!candidates.length) return undefined;
  const manualIndex = slots.findIndex((slot) => slot.timestamp === manualStart);
  const baseline = simulate(slots, baseLoadKw, battery, startSocPct);
  const evaluate = (startIndex: number) => simulate(slots, baseLoadKw, battery, startSocPct, startIndex, slotCount, powerKw);
  const startIndex = candidates.includes(manualIndex)
    ? manualIndex
    : candidates.reduce((best, candidate) => {
      const current = evaluate(candidate);
      const previous = evaluate(best);
      if (current.testGridKwh < previous.testGridKwh - .001) return candidate;
      if (Math.abs(current.testGridKwh - previous.testGridKwh) < .001 && current.testBatteryKwh < previous.testBatteryKwh - .001) return candidate;
      return best;
    });
  const simulation = evaluate(startIndex);
  const endIndex = startIndex + slotCount - 1;
  const rechargeIndex = simulation.testBatteryKwh > .01
    ? slots.findIndex((_, index) => index > endIndex && simulation.socSeries[index] >= baseline.socSeries[index] - .1)
    : undefined;
  return { startIndex, slotCount, powerKw, simulation, baseline, rechargeIndex: rechargeIndex !== -1 ? rechargeIndex : undefined };
}

function loadStoredState() {
  const fallback = { trial: defaultTrial(), manualStart: undefined as number | undefined, batterySettings: DEFAULT_BATTERY_SETTINGS, baseLoadKw: .25 };
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!stored || typeof stored !== "object") return fallback;
    return {
      trial: { ...fallback.trial, ...stored.trial } as TrialLoad,
      manualStart: Number.isFinite(stored.manualStart) ? Number(stored.manualStart) : undefined,
      batterySettings: { ...DEFAULT_BATTERY_SETTINGS, ...stored.batterySettings } as BatterySettings,
      baseLoadKw: Number.isFinite(stored.baseLoadKw) ? Number(stored.baseLoadKw) : fallback.baseLoadKw,
    };
  } catch {
    return fallback;
  }
}

function dominantSource(plan: Plan) {
  const values = [plan.simulation.testPvKwh, plan.simulation.testBatteryKwh, plan.simulation.testGridKwh];
  return values.indexOf(Math.max(...values)) === 0 ? "is-solar" : values.indexOf(Math.max(...values)) === 1 ? "is-battery" : "is-grid";
}

export function ConsumptionPlanner({ data }: { data: DashboardData }) {
  const initial = useMemo(() => loadStoredState(), []);
  const [trial, setTrial] = useState(initial.trial);
  const [manualStart, setManualStart] = useState<number | undefined>(initial.manualStart);
  const [batterySettings, setBatterySettings] = useState(initial.batterySettings);
  const [baseLoadKw, setBaseLoadKw] = useState(initial.baseLoadKw);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const forecast = data.forecast;
  const slots = useMemo(() => {
    if (!forecast) return [];
    const forecastSlots = makeSlots(forecast);
    if (!forecastSlots.length) return forecastSlots;
    if (!data.connections.solar.connected || !Number.isFinite(data.solar.currentPowerKw)) return forecastSlots;
    const now = Date.now();
    const closestIndex = forecastSlots.reduce((best, slot, index) => Math.abs(slot.timestamp - now) < Math.abs(forecastSlots[best].timestamp - now) ? index : best, 0);
    if (Math.abs(forecastSlots[closestIndex].timestamp - now) > 30 * 60_000) return forecastSlots;
    return forecastSlots.map((slot, index) => index === closestIndex ? { ...slot, expectedPowerKw: data.solar.currentPowerKw } : slot);
  }, [data.connections.solar.connected, data.solar.currentPowerKw, forecast]);
  const latestSoc = [...(data.solar.energyChart ?? [])].reverse().find((point) => Number.isFinite(point.batterySoc))?.batterySoc;
  const startSocPct = Number.isFinite(latestSoc) ? Math.max(0, Math.min(100, latestSoc!)) : batterySettings.fallbackSocPct;
  const plan = useMemo(() => makePlan(trial, slots, baseLoadKw, batterySettings, startSocPct, manualStart), [baseLoadKw, batterySettings, manualStart, slots, startSocPct, trial]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ trial, manualStart, batterySettings, baseLoadKw }));
  }, [baseLoadKw, batterySettings, manualStart, trial]);

  if (!forecast || forecast.days.length < 3 || !slots.length) {
    return <article className="planner-card card"><p className="eyebrow">Interaktív próba</p><h2>Fogyasztási próba</h2><p className="planner-empty">A következő 72 órás termelési előrejelzéssel együtt válik elérhetővé.</p></article>;
  }

  const daySlots = slots.filter((slot) => slot.dayOffset === trial.dayOffset);
  const dayStartIndex = slots.findIndex((slot) => slot.dayOffset === trial.dayOffset);
  const maximum = Math.max(5, plan?.powerKw ?? 0, ...daySlots.map((slot) => slot.expectedPowerKw));
  const start = plan ? slots[plan.startIndex] : undefined;
  const endTimestamp = plan ? slots[plan.startIndex + plan.slotCount - 1].timestamp + 15 * 60_000 : undefined;
  const socBeforeUse = plan ? (plan.simulation.socSeries[plan.startIndex - 1] ?? startSocPct) : startSocPct;
  const endSoc = plan ? plan.simulation.socSeries[plan.startIndex + plan.slotCount - 1] : startSocPct;
  const batteryDropPct = plan ? plan.simulation.testStoredBatteryKwh / Math.max(.1, batterySettings.capacityKwh) * 100 : 0;
  const sourceTotal = plan ? plan.simulation.testPvKwh + plan.simulation.testBatteryKwh + plan.simulation.testGridKwh : trial.energyKwh;
  const candidates = candidateStarts(trial, slots);

  const updateTrial = (changes: Partial<TrialLoad>) => {
    setTrial((current) => ({ ...current, ...changes }));
    setManualStart(undefined);
  };

  const moveToPointer = (clientX: number, offsetMinutes: number) => {
    const bounds = timelineRef.current?.getBoundingClientRect();
    if (!bounds?.width) return;
    const targetMinute = Math.max(0, Math.min(1440, (clientX - bounds.left) / bounds.width * 1440 - offsetMinutes));
    const closest = candidates.reduce<number | undefined>((best, candidate) => {
      const date = new Date(slots[candidate].timestamp);
      const minute = date.getHours() * 60 + date.getMinutes();
      if (best === undefined) return candidate;
      const bestDate = new Date(slots[best].timestamp);
      const bestMinute = bestDate.getHours() * 60 + bestDate.getMinutes();
      return Math.abs(minute - targetMinute) < Math.abs(bestMinute - targetMinute) ? candidate : best;
    }, undefined);
    if (closest !== undefined) setManualStart(slots[closest].timestamp);
  };

  const shiftStart = (direction: -1 | 1) => {
    if (!plan) return;
    const position = candidates.indexOf(plan.startIndex);
    const next = candidates[position + direction];
    if (next !== undefined) setManualStart(slots[next].timestamp);
  };

  const sourceRows = plan ? [
    { key: "pv", label: "Közvetlenül a napelemből", value: plan.simulation.testPvKwh },
    { key: "battery", label: "Az akkumulátorból", value: plan.simulation.testBatteryKwh },
    { key: "grid", label: "A hálózatból", value: plan.simulation.testGridKwh },
  ] : [];

  return (
    <article className="planner-card card planner-card--simple">
      <header className="planner-head">
        <div>
          <p className="eyebrow">Interaktív próba · 72 óra</p>
          <h2>Honnan jön majd az energia?</h2>
          <p>Add meg az energiaigényt és az időtartamot, majd húzd a fogyasztást a kívánt kezdési időpontra.</p>
        </div>
        <button className="planner-auto" onClick={() => setManualStart(undefined)}>Legjobb időpont keresése</button>
      </header>

      <div className="planner-simple-inputs">
        <label>Felhasznált energia<span><input type="number" min="0.1" max="100" step="0.1" value={trial.energyKwh} onChange={(event) => updateTrial({ energyKwh: Math.max(.1, Number(event.target.value)) })} /> kWh</span></label>
        <label>Használat időtartama<span><input type="number" min="0.25" max="24" step="0.25" value={trial.durationMinutes / 60} onChange={(event) => updateTrial({ durationMinutes: Math.max(15, Math.round(Number(event.target.value) * 4) * 15) })} /> óra</span></label>
        <label>Háttérfogyasztás<span><input type="number" min="0" max="5" step="0.05" value={baseLoadKw} onChange={(event) => { setBaseLoadKw(Math.max(0, Number(event.target.value))); setManualStart(undefined); }} /> kW</span></label>
        <div className="planner-day-tabs" role="tablist" aria-label="Tervezési nap">
          {forecast.days.slice(0, 3).map((day, index) => <button key={day.date} role="tab" aria-selected={trial.dayOffset === index} className={trial.dayOffset === index ? "active" : ""} onClick={() => updateTrial({ dayOffset: index as DayOffset })}>{formatDay(day.date, day.label)}</button>)}
        </div>
      </div>

      <section className="planner-timeline-wrap" aria-label={`${forecast.days[trial.dayOffset].label} fogyasztási idővonala`}>
        <div ref={timelineRef} className={`planner-timeline planner-timeline--simple ${dragState ? "is-dragging" : ""}`}>
          <div className="planner-solar-profile" aria-hidden="true">
            {daySlots.map((slot, index) => <i key={slot.timestamp} style={{ left: `${index / daySlots.length * 100}%`, width: `${100 / daySlots.length + .1}%`, height: `${slot.expectedPowerKw / maximum * 100}%` }} />)}
          </div>
          {plan && start && <>
            <div className="planner-battery-profile" aria-hidden="true">
              <span className="planner-battery-reserve" style={{ bottom: `${batterySettings.reservePct}%` }} />
              {daySlots.map((slot, index) => <i key={slot.timestamp} style={{ left: `${index / daySlots.length * 100}%`, bottom: `${plan.simulation.socSeries[dayStartIndex + index] ?? startSocPct}%` }} />)}
            </div>
            <button
              className={`planner-block planner-block--trial ${dominantSource(plan)} ${dragState ? "is-dragging" : ""}`}
              style={{ left: `${(start.timestamp === undefined ? 0 : (new Date(start.timestamp).getHours() * 60 + new Date(start.timestamp).getMinutes())) / 1440 * 100}%`, width: `${plan.slotCount * 15 / 1440 * 100}%` }}
              aria-label={`Fogyasztás kezdete ${formatClock(start.timestamp)}. Húzd az idővonalon, vagy használd a bal és jobb nyilat.`}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                const bounds = event.currentTarget.getBoundingClientRect();
                event.currentTarget.setPointerCapture(event.pointerId);
                setDragState({ pointerId: event.pointerId, offsetMinutes: Math.max(0, Math.min(trial.durationMinutes, (event.clientX - bounds.left) / Math.max(1, bounds.width) * trial.durationMinutes)) });
              }}
              onPointerMove={(event) => {
                if (dragState?.pointerId === event.pointerId) moveToPointer(event.clientX, dragState.offsetMinutes);
              }}
              onPointerUp={(event) => {
                if (dragState?.pointerId !== event.pointerId) return;
                event.currentTarget.releasePointerCapture(event.pointerId);
                setDragState(null);
              }}
              onPointerCancel={() => setDragState(null)}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  shiftStart(event.key === "ArrowLeft" ? -1 : 1);
                }
              }}
            ><span className="planner-grip" aria-hidden="true">⋮⋮</span><strong>{trial.energyKwh.toFixed(1)} kWh</strong><b>{formatClock(start.timestamp)}</b></button>
          </>}
          <div className="planner-hours" aria-hidden="true">{[0, 4, 8, 12, 16, 20, 24].map((hour) => <span key={hour} style={{ left: `${hour / 24 * 100}%` }}>{String(hour).padStart(2, "0")}</span>)}</div>
        </div>
        <div className="planner-key"><span><i className="solar" />PV: élő most, előrejelzés később</span><span><i className="battery" />akku töltöttség</span><span>Fogd meg a színes blokkot, és húzd 15 perces lépésekben.</span></div>
      </section>

      {plan && start && endTimestamp && <div className="planner-simple-result">
        <section className="planner-source-panel">
          <div className="planner-result-head"><div><p className="eyebrow">Forrásmegoszlás</p><h3>{formatClock(start.timestamp)}–{formatClock(endTimestamp)}</h3></div><strong>{plan.powerKw.toFixed(2)} <small>kW átlag</small></strong></div>
          <div className="planner-source-bar" aria-label="Az energia forrás szerinti megoszlása">
            {sourceRows.map((source) => <i key={source.key} className={source.key} style={{ width: `${sourceTotal ? source.value / sourceTotal * 100 : 0}%` }} />)}
          </div>
          <div className="planner-source-list">
            {sourceRows.map((source) => <div key={source.key} className={source.key}><span>{source.label}</span><strong>{source.value.toFixed(2)} <small>kWh</small></strong><em>{sourceTotal ? (source.value / sourceTotal * 100).toFixed(0) : 0}%</em></div>)}
          </div>
        </section>

        <section className="planner-battery-impact">
          <p className="eyebrow">Akkumulátorhatás</p>
          {plan.simulation.testBatteryKwh > .01 ? <>
            <h3>Várhatóan {batteryDropPct.toFixed(1)} százalékponttal csökken.</h3>
            <div className="planner-soc-change"><span>{socBeforeUse.toFixed(0)}%</span><i /><strong>{endSoc.toFixed(0)}%</strong></div>
            <dl>
              <div><dt>Az akkuból érkezik</dt><dd>{plan.simulation.testBatteryKwh.toFixed(2)} kWh</dd></div>
              <div><dt>Visszatöltés várható</dt><dd>{plan.rechargeIndex !== undefined ? `${formatDay(dateKey(slots[plan.rechargeIndex].timestamp), forecast.days[slots[plan.rechargeIndex].dayOffset].label)}, ${formatClock(slots[plan.rechargeIndex].timestamp)}` : "72 órán belül nem látszik"}</dd></div>
            </dl>
          </> : <>
            <h3>Ehhez az időponthoz várhatóan nem kell az akkumulátor.</h3>
            <p>A fogyasztást a közvetlen PV-termelés és szükség esetén a hálózat fedezi, ezért külön visszatöltés sem szükséges.</p>
          </>}
        </section>
      </div>}

      {!plan && <p className="planner-warning planner-no-slot">A kiválasztott napon már nincs elegendő idő a teljes használathoz. Válassz egy későbbi napot vagy rövidebb időtartamot.</p>}

      <details className="planner-battery-settings">
        <summary><span>Számítási beállítások</span><b>{batterySettings.capacityKwh.toFixed(1)} kWh akku · {batterySettings.reservePct}% tartalék · {batterySettings.idleLossPctPerDay}%/nap veszteség</b></summary>
        <div className="planner-battery-fields">
          <label>Akku kapacitása<span><input type="number" min="0.1" max="100" step="0.1" value={batterySettings.capacityKwh} onChange={(event) => setBatterySettings((current) => ({ ...current, capacityKwh: Math.max(.1, Number(event.target.value)) }))} /> kWh</span></label>
          <label>Védett tartalék<span><input type="number" min="0" max="95" step="1" value={batterySettings.reservePct} onChange={(event) => setBatterySettings((current) => ({ ...current, reservePct: Math.max(0, Math.min(95, Number(event.target.value))) }))} /> %</span></label>
          <label>Max. töltés / leadás<span><input type="number" min="0" max="30" step="0.1" value={batterySettings.maxPowerKw} onChange={(event) => setBatterySettings((current) => ({ ...current, maxPowerKw: Math.max(0, Number(event.target.value)) }))} /> kW</span></label>
          <label>Hatásfok<span><input type="number" min="50" max="100" step="1" value={batterySettings.efficiencyPct} onChange={(event) => setBatterySettings((current) => ({ ...current, efficiencyPct: Math.max(50, Math.min(100, Number(event.target.value))) }))} /> %</span></label>
          <label>Üresjárati veszteség<span><input type="number" min="0" max="20" step="0.1" value={batterySettings.idleLossPctPerDay} onChange={(event) => setBatterySettings((current) => ({ ...current, idleLossPctPerDay: Math.max(0, Number(event.target.value)) }))} /> %/nap</span></label>
          <label>Kezdő SOC élő adat nélkül<span><input type="number" min="0" max="100" step="1" value={batterySettings.fallbackSocPct} onChange={(event) => setBatterySettings((current) => ({ ...current, fallbackSocPct: Math.max(0, Math.min(100, Number(event.target.value))) }))} /> %</span></label>
        </div>
        <p>A kezdő töltöttség: <strong>{startSocPct.toFixed(0)}%</strong> ({Number.isFinite(latestSoc) ? "élő Sungrow-adat" : "megadott tartalékérték"}).</p>
      </details>
    </article>
  );
}
