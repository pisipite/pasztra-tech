import { useEffect, useMemo, useRef, useState } from "react";
import type { DashboardData, SolarForecast } from "../../types";
import { BackToTop } from "../../components/BackToTop";
import { formatFixedNumber, formatNumber } from "../../formatUtils";
import { addCalendarDays, dateKey, dateParts, dateTimeFormatter, dayTicks, parseLocalDateTime, startOfDay } from "../../timeZone";
import { recentSoc } from "../../observationQuality";

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
  totalGridKwh: number;
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
  mode: "move" | "resize";
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
  return dateParts(new Date()).hour >= 20 ? 1 : 0;
}

function defaultTrial(): TrialLoad {
  return { energyKwh: 3, durationMinutes: 120, dayOffset: flexibleDay() };
}

function formatClock(timestamp: number) {
  return dateTimeFormatter({ hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

function formatDay(date: string | undefined, fallback: string) {
  if (!date) return fallback;
  return dateTimeFormatter({ month: "short", day: "numeric", weekday: "short" }).format(parseLocalDateTime(date));
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
  let totalGridKwh = 0;
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
    totalGridKwh += baseShortfall - batteryForBase + testShortfall - batteryForTest;

    const acceptedPv = Math.min(pvAvailable, maximumSlotEnergy, Math.max(0, capacityKwh - storedKwh) / efficiency);
    storedKwh += acceptedPv * efficiency;
    socSeries.push(Math.max(0, Math.min(100, storedKwh / capacityKwh * 100)));
  });

  return { socSeries, testPvKwh, testBatteryKwh, testGridKwh, totalGridKwh, testStoredBatteryKwh };
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
      if (current.totalGridKwh < previous.totalGridKwh - .001) return candidate;
      if (Math.abs(current.totalGridKwh - previous.totalGridKwh) < .001 && current.testBatteryKwh < previous.testBatteryKwh - .001) return candidate;
      return best;
    });
  const simulation = evaluate(startIndex);
  const endIndex = startIndex + slotCount - 1;
  const rechargeIndex = simulation.socSeries.some((soc, index) => soc < baseline.socSeries[index] - .1)
    ? slots.findIndex((_, index) => index > endIndex && simulation.socSeries.slice(index).every((soc, offset) => soc >= baseline.socSeries[index + offset] - .1))
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
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const timelineRef = useRef<HTMLDivElement>(null);
  const forecast = data.forecast;
  const slots = useMemo(() => {
    if (!forecast) return [];
    const forecastSlots = makeSlots(forecast).filter((slot) => slot.timestamp >= Math.floor(clock / 900_000) * 900_000);
    if (!forecastSlots.length) return forecastSlots;
    if (!data.connections?.solar.connected || data.connections.solar.stale || !Number.isFinite(data.solar.currentPowerKw)) return forecastSlots;
    const now = new Date(data.updatedAt).getTime();
    const closestIndex = forecastSlots.reduce((best, slot, index) => Math.abs(slot.timestamp - now) < Math.abs(forecastSlots[best].timestamp - now) ? index : best, 0);
    if (Math.abs(forecastSlots[closestIndex].timestamp - now) > 30 * 60_000) return forecastSlots;
    return forecastSlots.map((slot, index) => index === closestIndex ? { ...slot, expectedPowerKw: data.solar.currentPowerKw } : slot);
  }, [clock, data.connections, data.solar.currentPowerKw, data.updatedAt, forecast]);
  const socObservation = data.connections?.solar.connected && !data.connections.solar.stale ? recentSoc(data.solar.energyChart ?? [], clock) : undefined;
  const latestSoc = socObservation?.batterySoc;
  const startSocPct = Number.isFinite(latestSoc) ? Math.max(0, Math.min(100, latestSoc!)) : batterySettings.fallbackSocPct;
  const plan = useMemo(() => makePlan(trial, slots, baseLoadKw, batterySettings, startSocPct, manualStart), [baseLoadKw, batterySettings, manualStart, slots, startSocPct, trial]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ trial, manualStart, batterySettings, baseLoadKw }));
  }, [baseLoadKw, batterySettings, manualStart, trial]);

  if (!forecast || forecast.days.length < 3 || !slots.length) {
    return <article className="planner-card card" id="fogyasztasi-proba"><header className="planner-head section-header"><div className="section-header__lead"><div className="section-kicker"><p className="eyebrow">Interaktív próba</p><BackToTop /></div><h2>Fogyasztási próba</h2><p className="planner-empty">A következő 72 órás termelési előrejelzéssel együtt válik elérhetővé.</p></div></header></article>;
  }

  const daySlots = slots.filter((slot) => slot.dayOffset === trial.dayOffset);
  const dayStart = startOfDay(parseLocalDateTime(forecast.days[trial.dayOffset].date));
  const dayMinutes = (addCalendarDays(dayStart, 1).getTime() - dayStart.getTime()) / 60_000;
  const elapsedMinutes = (timestamp: number) => (timestamp - dayStart.getTime()) / 60_000;
  const dayStartIndex = slots.findIndex((slot) => slot.dayOffset === trial.dayOffset);
  const batteryLinePoints = plan ? daySlots.map((slot, index) => {
    const x = elapsedMinutes(slot.timestamp) / dayMinutes * 100;
    const soc = plan.simulation.socSeries[dayStartIndex + index] ?? startSocPct;
    return `${x.toFixed(3)},${(100 - soc).toFixed(3)}`;
  }).join(" ") : "";
  const baselineLinePoints = plan ? daySlots.map((slot, index) => `${(elapsedMinutes(slot.timestamp) / dayMinutes * 100).toFixed(3)},${(100 - plan.baseline.socSeries[dayStartIndex + index]).toFixed(3)}`).join(" ") : "";
  const eveningIndex = slots.reduce((last, slot, index) => slot.dayOffset === trial.dayOffset ? index : last, -1);
  const eveningDrop = plan && eveningIndex >= 0 ? Math.max(0, plan.baseline.socSeries[eveningIndex] - plan.simulation.socSeries[eveningIndex]) : undefined;
  const additionalGrid = plan ? Math.max(0, plan.simulation.totalGridKwh - plan.baseline.totalGridKwh) : undefined;
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
    const targetMinute = Math.max(0, Math.min(dayMinutes, (clientX - bounds.left) / bounds.width * dayMinutes - offsetMinutes));
    const closest = candidates.reduce<number | undefined>((best, candidate) => {
      const minute = elapsedMinutes(slots[candidate].timestamp);
      if (best === undefined) return candidate;
      const bestMinute = elapsedMinutes(slots[best].timestamp);
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

  const resizeToPointer = (clientX: number) => {
    if (!start) return;
    const bounds = timelineRef.current?.getBoundingClientRect();
    if (!bounds?.width) return;
    const startMinute = elapsedMinutes(start.timestamp);
    const pointerMinute = Math.max(startMinute + 15, Math.min(dayMinutes, (clientX - bounds.left) / bounds.width * dayMinutes));
    const durationMinutes = Math.max(15, Math.round((pointerMinute - startMinute) / 15) * 15);
    setTrial((current) => current.durationMinutes === durationMinutes ? current : { ...current, durationMinutes });
  };

  const resizeBy = (minutes: number) => {
    if (!start) return;
    const startMinute = elapsedMinutes(start.timestamp);
    setTrial((current) => ({ ...current, durationMinutes: Math.max(15, Math.min(dayMinutes - startMinute, current.durationMinutes + minutes)) }));
  };

  const sourceRows = plan ? [
    { key: "pv", label: "Közvetlenül a napelemből", value: plan.simulation.testPvKwh },
    { key: "battery", label: "Az akkumulátorból", value: plan.simulation.testBatteryKwh },
    { key: "grid", label: "A hálózatból", value: plan.simulation.testGridKwh },
  ] : [];

  return (
    <article className="planner-card card planner-card--simple" id="fogyasztasi-proba">
      <header className="planner-head section-header">
        <div className="section-header__lead">
          <div className="section-kicker"><p className="eyebrow">Interaktív próba</p><BackToTop /></div>
          <h2>Honnan jön majd az energia?</h2>
          <p>Egyetlen próba-fogyasztás energiaigényét és időtartamát vizsgálhatod. A blokk mozgatható, a jobb széle pedig kihúzható.</p>
        </div>
        <button className="planner-auto section-header__tools" onClick={() => setManualStart(undefined)}>Legjobb időpont keresése</button>
      </header>

      <div className="planner-simple-inputs">
        <label className="planner-energy-input"><small>Ennyi energiát szeretnék felhasználni</small><span><input aria-label="Felhasznált energia kilowattórában" type="number" min="0.1" max="100" step="0.1" value={trial.energyKwh} onChange={(event) => updateTrial({ energyKwh: Math.max(.1, Number(event.target.value)) })} /><b>kWh</b></span></label>
        <label className="planner-duration-input">Időtartam<span><input type="number" min="0.25" max="24" step="0.25" value={trial.durationMinutes / 60} onChange={(event) => updateTrial({ durationMinutes: Math.max(15, Math.round(Number(event.target.value) * 4) * 15) })} /> óra</span><small>A blokk jobb szélével is állítható.</small></label>
        <div className="planner-day-tabs" role="tablist" aria-label="Tervezési nap">
          {forecast.days.slice(0, 3).map((day, index) => <button key={day.date} role="tab" aria-selected={trial.dayOffset === index} className={trial.dayOffset === index ? "active" : ""} onClick={() => updateTrial({ dayOffset: index as DayOffset })}>{formatDay(day.date, day.label)}</button>)}
        </div>
      </div>

      <section className="planner-timeline-wrap" aria-label={`${forecast.days[trial.dayOffset].label} fogyasztási idővonala`}>
        <div ref={timelineRef} className={`planner-timeline planner-timeline--simple ${dragState ? "is-dragging" : ""}`}>
          <div className="planner-solar-profile" aria-hidden="true">
            {daySlots.map((slot) => <i key={slot.timestamp} style={{ left: `${elapsedMinutes(slot.timestamp) / dayMinutes * 100}%`, width: `${15 / dayMinutes * 100 + .1}%`, height: `${slot.expectedPowerKw / maximum * 100}%` }} />)}
          </div>
          {plan && start && <>
            <div className="planner-battery-profile" aria-hidden="true">
              <span className="planner-battery-reserve" style={{ bottom: `${batterySettings.reservePct}%` }} />
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false"><polyline className="planner-baseline" points={baselineLinePoints} vectorEffect="non-scaling-stroke" /><polyline points={batteryLinePoints} vectorEffect="non-scaling-stroke" /></svg>
            </div>
            <div
              role="slider"
              tabIndex={0}
              aria-valuetext={`${formatClock(start.timestamp)} és ${formatClock(endTimestamp ?? start.timestamp)} között`}
              aria-valuemin={0}
              aria-valuemax={dayMinutes}
              aria-valuenow={elapsedMinutes(start.timestamp)}
              className={`planner-block planner-block--trial ${dominantSource(plan)} ${dragState ? "is-dragging" : ""}`}
              style={{ left: `${elapsedMinutes(start.timestamp) / dayMinutes * 100}%`, width: `${plan.slotCount * 15 / dayMinutes * 100}%` }}
              aria-label={`Fogyasztás kezdete ${formatClock(start.timestamp)}. Húzd az idővonalon, vagy használd a bal és jobb nyilat.`}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                const bounds = event.currentTarget.getBoundingClientRect();
                event.currentTarget.setPointerCapture(event.pointerId);
                setDragState({ pointerId: event.pointerId, mode: "move", offsetMinutes: Math.max(0, Math.min(trial.durationMinutes, (event.clientX - bounds.left) / Math.max(1, bounds.width) * trial.durationMinutes)) });
              }}
              onPointerMove={(event) => {
                if (dragState?.pointerId === event.pointerId && dragState.mode === "move") moveToPointer(event.clientX, dragState.offsetMinutes);
              }}
              onPointerUp={(event) => {
                if (dragState?.pointerId !== event.pointerId || dragState.mode !== "move") return;
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
            ><span className="planner-grip" aria-hidden="true">⋮⋮</span><strong>{formatFixedNumber(trial.energyKwh, 1)} kWh</strong><b>{formatClock(start.timestamp)}</b><span
              className="planner-resize-handle"
              role="slider"
              tabIndex={0}
              aria-label="A fogyasztás időtartamának módosítása"
              aria-valuemin={15}
              aria-valuemax={dayMinutes}
              aria-valuenow={trial.durationMinutes}
              aria-valuetext={`${formatFixedNumber(trial.durationMinutes / 60, 2)} óra`}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                setDragState({ pointerId: event.pointerId, mode: "resize", offsetMinutes: 0 });
              }}
              onPointerMove={(event) => {
                if (dragState?.pointerId === event.pointerId && dragState.mode === "resize") resizeToPointer(event.clientX);
              }}
              onPointerUp={(event) => {
                event.stopPropagation();
                if (dragState?.pointerId !== event.pointerId || dragState.mode !== "resize") return;
                event.currentTarget.releasePointerCapture(event.pointerId);
                setDragState(null);
              }}
              onPointerCancel={() => setDragState(null)}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  event.stopPropagation();
                  resizeBy(event.key === "ArrowLeft" ? -15 : 15);
                }
              }}
            ><i aria-hidden="true" /></span></div>
          </>}
          <div className="planner-hours" aria-hidden="true">{dayTicks(dayStart).map((tick) => <span key={tick.label} style={{ left: `${tick.ratio * 100}%` }}>{tick.label.slice(0, 2)}</span>)}</div>
        </div>
        <div className="planner-key"><span><i className="solar" />PV-becslés, friss mérés esetén azzal pontosítva</span><span><i className="battery" />akku próbával · folytonos</span><span><i className="battery baseline" />akku próba nélkül · szaggatott</span><span>A blokk közepe mozgat, a csíkos jobb széle az időtartamot állítja.</span></div>
      </section>

      {plan && start && endTimestamp && <div className="planner-simple-result">
        <div className="data-quality-note planner-assumptions">
          <strong>Becsült eredmény, nem mért fogyasztás.</strong>{" "}
          Kezdő töltöttség: {formatFixedNumber(startSocPct, 0)}% — {socObservation?.timestamp ? `Sungrow-minta: ${formatClock(Date.parse(socObservation.timestamp))}` : "feltételezett, a beállításokból; nincs friss akkumérés"}.{" "}
          Háttérfogyasztás: {formatFixedNumber(baseLoadKw, 2)} kW; akku: {formatFixedNumber(batterySettings.capacityKwh, 1)} kWh; tartalék: {formatNumber(batterySettings.reservePct)}%; hatásfok: {formatNumber(batterySettings.efficiencyPct)}%; üresjárati veszteség: {formatNumber(batterySettings.idleLossPctPerDay)}%/nap.{" "}
          A PV-termelés időjárási becslés, a töltöttség és a visszatöltési idő is ettől függ.
        </div>
        <div className="comparison-metrics">
          <div><span>Többlet-hálózat · teljes előrejelzési időtáv</span><strong>{formatFixedNumber(additionalGrid!, 2)} kWh</strong></div>
          <div><span>Nap végi töltöttségkülönbség</span><strong>{formatFixedNumber(eveningDrop!, 1)} százalékpont</strong><small>A kiválasztott nap végén, próba nélkülhöz képest.</small></div>
          <div><span>Visszatérés a próba nélküli akkupályához</span><strong>{plan.rechargeIndex !== undefined ? `${formatDay(dateKey(slots[plan.rechargeIndex].timestamp), forecast.days[slots[plan.rechargeIndex].dayOffset].label)} · ${formatClock(slots[plan.rechargeIndex].timestamp)}` : plan.simulation.socSeries.some((soc, i) => soc < plan.baseline.socSeries[i] - .1) ? "Az időtávon belül nem látszik" : "Nincs töltöttséghiány"}</strong></div>
        </div>
        <section className="planner-source-panel">
          <div className="planner-result-head"><div><p className="eyebrow">Forrásmegoszlás</p><h3>{formatClock(start.timestamp)}–{formatClock(endTimestamp)}</h3></div><strong>{formatFixedNumber(plan.powerKw, 2)} <small>kW átlag</small></strong></div>
          <div className="planner-source-bar" aria-label="Az energia forrás szerinti megoszlása">
            {sourceRows.map((source) => <i key={source.key} className={source.key} style={{ width: `${sourceTotal ? source.value / sourceTotal * 100 : 0}%` }} />)}
          </div>
          <div className="planner-source-list">
            {sourceRows.map((source) => <div key={source.key} className={source.key}><span>{source.label}</span><strong>{formatFixedNumber(source.value, 2)} <small>kWh</small></strong><em>{formatFixedNumber(sourceTotal ? source.value / sourceTotal * 100 : 0, 0)}%</em></div>)}
          </div>
        </section>

        <section className="planner-battery-impact">
          <p className="eyebrow">Akkumulátorhatás</p>
          {plan.simulation.testBatteryKwh > .01 ? <>
            <h3>Várhatóan {formatFixedNumber(batteryDropPct, 1)} százalékponttal csökken.</h3>
            <div className="planner-soc-change"><span>{formatFixedNumber(socBeforeUse, 0)}%</span><i /><strong>{formatFixedNumber(endSoc, 0)}%</strong></div>
            <dl>
              <div><dt>Az akkuból érkezik</dt><dd>{formatFixedNumber(plan.simulation.testBatteryKwh, 2)} kWh</dd></div>
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
        <summary><span>Számítási beállítások</span><b>{formatFixedNumber(batterySettings.capacityKwh, 1)} kWh akku · {formatNumber(batterySettings.reservePct, 1)}% tartalék · {formatNumber(batterySettings.idleLossPctPerDay, 1)}%/nap veszteség</b></summary>
        <div className="planner-battery-fields">
          <label>Háttérfogyasztás<span><input type="number" min="0" max="5" step="0.05" value={baseLoadKw} onChange={(event) => { setBaseLoadKw(Math.max(0, Number(event.target.value))); setManualStart(undefined); }} /> kW</span></label>
          <label>Akku kapacitása<span><input type="number" min="0.1" max="100" step="0.1" value={batterySettings.capacityKwh} onChange={(event) => setBatterySettings((current) => ({ ...current, capacityKwh: Math.max(.1, Number(event.target.value)) }))} /> kWh</span></label>
          <label>Védett tartalék<span><input type="number" min="0" max="95" step="1" value={batterySettings.reservePct} onChange={(event) => setBatterySettings((current) => ({ ...current, reservePct: Math.max(0, Math.min(95, Number(event.target.value))) }))} /> %</span></label>
          <label>Max. töltés / leadás<span><input type="number" min="0" max="30" step="0.1" value={batterySettings.maxPowerKw} onChange={(event) => setBatterySettings((current) => ({ ...current, maxPowerKw: Math.max(0, Number(event.target.value)) }))} /> kW</span></label>
          <label>Hatásfok<span><input type="number" min="50" max="100" step="1" value={batterySettings.efficiencyPct} onChange={(event) => setBatterySettings((current) => ({ ...current, efficiencyPct: Math.max(50, Math.min(100, Number(event.target.value))) }))} /> %</span></label>
          <label>Üresjárati veszteség<span><input type="number" min="0" max="20" step="0.1" value={batterySettings.idleLossPctPerDay} onChange={(event) => setBatterySettings((current) => ({ ...current, idleLossPctPerDay: Math.max(0, Number(event.target.value)) }))} /> %/nap</span></label>
          <label>Kezdő SOC élő adat nélkül<span><input type="number" min="0" max="100" step="1" value={batterySettings.fallbackSocPct} onChange={(event) => setBatterySettings((current) => ({ ...current, fallbackSocPct: Math.max(0, Math.min(100, Number(event.target.value))) }))} /> %</span></label>
        </div>
        <p>A kezdő töltöttség: <strong>{formatFixedNumber(startSocPct, 0)}%</strong> ({Number.isFinite(latestSoc) ? "élő Sungrow-adat" : "megadott tartalékérték"}).</p>
      </details>
    </article>
  );
}
