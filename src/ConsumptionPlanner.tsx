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

type PlannerDevice = {
  id: string;
  name: string;
  shortName: string;
  energyKwh: number;
  durationMinutes: number;
  dayOffset: DayOffset;
  earliest: string;
  latest: string;
  enabled: boolean;
  custom?: boolean;
  sourceLabel?: string;
  sourceUrl?: string;
  sourceNote: string;
};

type PlannerSlot = {
  timestamp: number;
  expectedPowerKw: number;
  dayOffset: DayOffset;
};

type DeviceSchedule = {
  device: PlannerDevice;
  startIndex: number;
  slotCount: number;
  powerKw: number;
  gridKwh: number;
  solarSharePct: number;
  manual: boolean;
};

type DragState = {
  deviceId: string;
  pointerId: number;
  offsetMinutes: number;
};

type PlannerResult = {
  schedules: DeviceSchedule[];
  loads: number[];
  baselineGridKwh: number;
  plannedGridKwh: number;
  naiveGridKwh: number;
  savedGridKwh: number;
  solarSharePct: number;
  batterySocSeries: number[];
  batteryStartSocPct: number;
  batteryEndSocPct: number;
  batteryChargeKwh: number;
  batteryDischargeKwh: number;
};

type BatterySimulation = {
  gridKwh: number;
  exportKwh: number;
  chargeKwh: number;
  dischargeKwh: number;
  endSocPct: number;
  socSeries: number[];
};

const STORAGE_KEY = "pasztra-consumption-planner-v1";
const SLOT_HOURS = .25;
const DEFAULT_BATTERY_SETTINGS: BatterySettings = {
  capacityKwh: 9.6,
  reservePct: 10,
  maxPowerKw: 5,
  efficiencyPct: 95,
  idleLossPctPerDay: 1,
  fallbackSocPct: 80,
};

const sourceUrls = {
  boiler: "https://tesy.com/products/datasheet/557",
  convector: "https://www.technopolis.bg/bg/Konvektori/Konvektor-DIMPLEX-TOP-1500W/p/118680",
  cooker: "https://www.technopolis.bg/bg/Elektricheski-gotvarski-pechki/Gotvarska-pechka-SNAIGE-SN-4237HP-W/p/704365",
};

function flexibleDay(): DayOffset {
  return new Date().getHours() >= 16 ? 1 : 0;
}

function defaultDevices(): PlannerDevice[] {
  const dayOffset = flexibleDay();
  return [
    {
      id: "washing-machine",
      name: "Mosógép",
      shortName: "MG",
      energyKwh: .9,
      durationMinutes: 120,
      dayOffset,
      earliest: "09:00",
      latest: "18:00",
      enabled: true,
      sourceNote: "0,9 kWh/ciklus kiinduló becslés - a programtól függően módosítható.",
    },
    {
      id: "boiler",
      name: "TESY bojler",
      shortName: "BJ",
      energyKwh: 4.28,
      durationMinutes: 107,
      dayOffset,
      earliest: "09:00",
      latest: "19:00",
      enabled: true,
      sourceLabel: "TESY ModEco Cloud 80 adatlap",
      sourceUrl: sourceUrls.boiler,
      sourceNote: "82 l - 2,4 kW - teljes felfűtés 1 óra 47 perc.",
    },
    ...Array.from({ length: 3 }, (_, index): PlannerDevice => ({
      id: `convector-${index + 1}`,
      name: `Konvektor ${index + 1}`,
      shortName: `K${index + 1}`,
      energyKwh: 1.5,
      durationMinutes: 60,
      dayOffset,
      earliest: "07:00",
      latest: "22:00",
      enabled: true,
      sourceLabel: "DIMPLEX TOP 1500W",
      sourceUrl: sourceUrls.convector,
      sourceNote: "1,5 kW névleges teljesítmény - az alapbeállítás 1 óra teljes üzem.",
    })),
    {
      id: "cooker",
      name: "Főzőpult / kompakt sütő",
      shortName: "FP",
      energyKwh: .7,
      durationMinutes: 60,
      dayOffset,
      earliest: "11:00",
      latest: "14:30",
      enabled: true,
      sourceLabel: "SNAIGE SN-4237HP adatlap",
      sourceUrl: sourceUrls.cooker,
      sourceNote: "0,70 kWh szabványos sütőciklus - két elektromos főzőzóna.",
    },
  ];
}

function dateKey(value: Date | number) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function clockMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function formatClock(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" });
}

function formatDay(date: string | undefined, fallback: string) {
  if (!date) return fallback;
  return new Date(`${date}T12:00:00`).toLocaleDateString("hu-HU", { month: "short", day: "numeric", weekday: "short" });
}

function makeSlots(forecast: SolarForecast): PlannerSlot[] {
  const dates = forecast.days.slice(0, 3).map((day) => day.date);
  return forecast.days.slice(0, 3).flatMap((day, dayIndex) => day.points.flatMap((point, pointIndex) => {
    const start = new Date(point.timestamp).getTime();
    const nextPower = day.points[pointIndex + 1]?.expectedPowerKw ?? point.expectedPowerKw;
    return Array.from({ length: 4 }, (_, quarter): PlannerSlot => ({
      timestamp: start + quarter * 15 * 60_000,
      expectedPowerKw: point.expectedPowerKw + (nextPower - point.expectedPowerKw) * quarter / 4,
      dayOffset: dayIndex as DayOffset,
    }));
  })).filter((slot) => dates[slot.dayOffset] === dateKey(slot.timestamp));
}

function candidateStarts(device: PlannerDevice, slots: PlannerSlot[]) {
  const slotCount = Math.max(1, Math.ceil(device.durationMinutes / 15));
  const earliest = clockMinutes(device.earliest);
  const latest = clockMinutes(device.latest);
  return slots.flatMap((slot, index) => {
    if (slot.dayOffset !== device.dayOffset) return [];
    if (slot.timestamp < Date.now()) return [];
    const start = new Date(slot.timestamp);
    const minuteOfDay = start.getHours() * 60 + start.getMinutes();
    const endIndex = index + slotCount - 1;
    const endSlot = slots[endIndex];
    if (minuteOfDay < earliest || minuteOfDay + slotCount * 15 > latest || !endSlot || endSlot.dayOffset !== device.dayOffset) return [];
    return [index];
  });
}

function addDeviceLoad(loads: number[], startIndex: number, slotCount: number, powerKw: number) {
  for (let index = startIndex; index < startIndex + slotCount; index += 1) loads[index] += powerKw;
}

function simulateEnergy(slots: PlannerSlot[], loads: number[], baseLoadKw: number, battery: BatterySettings, startSocPct: number): BatterySimulation {
  const capacityKwh = Math.max(.1, battery.capacityKwh);
  const reserveKwh = capacityKwh * Math.max(0, Math.min(100, battery.reservePct)) / 100;
  const efficiency = Math.max(.5, Math.min(1, battery.efficiencyPct / 100));
  const maximumSlotEnergy = Math.max(0, battery.maxPowerKw) * SLOT_HOURS;
  const dailyRetention = Math.max(0, 1 - Math.max(0, battery.idleLossPctPerDay) / 100);
  const slotRetention = dailyRetention ** (SLOT_HOURS / 24);
  let storedKwh = capacityKwh * Math.max(0, Math.min(100, startSocPct)) / 100;
  let gridKwh = 0;
  let exportKwh = 0;
  let chargeKwh = 0;
  let dischargeKwh = 0;
  const socSeries: number[] = [];

  slots.forEach((slot, index) => {
    storedKwh *= slotRetention;
    const balanceKwh = (baseLoadKw + loads[index] - slot.expectedPowerKw) * SLOT_HOURS;
    if (balanceKwh > 0) {
      const availableToLoad = Math.max(0, storedKwh - reserveKwh) * efficiency;
      const delivered = Math.min(balanceKwh, maximumSlotEnergy, availableToLoad);
      storedKwh -= delivered / efficiency;
      dischargeKwh += delivered;
      gridKwh += balanceKwh - delivered;
    } else {
      const surplusKwh = -balanceKwh;
      const accepted = Math.min(surplusKwh, maximumSlotEnergy, Math.max(0, capacityKwh - storedKwh) / efficiency);
      storedKwh += accepted * efficiency;
      chargeKwh += accepted;
      exportKwh += surplusKwh - accepted;
    }
    socSeries.push(Math.max(0, Math.min(100, storedKwh / capacityKwh * 100)));
  });

  return { gridKwh, exportKwh, chargeKwh, dischargeKwh, endSocPct: socSeries.at(-1) ?? startSocPct, socSeries };
}

function chooseBestStart(device: PlannerDevice, slots: PlannerSlot[], loads: number[], baseLoadKw: number, battery: BatterySettings, startSocPct: number) {
  const slotCount = Math.max(1, Math.ceil(device.durationMinutes / 15));
  const powerKw = device.energyKwh / (slotCount * SLOT_HOURS);
  const candidates = candidateStarts(device, slots);
  const before = simulateEnergy(slots, loads, baseLoadKw, battery, startSocPct);
  return candidates.reduce<{ index: number; gridKwh: number } | undefined>((best, index) => {
    const candidateLoads = [...loads];
    addDeviceLoad(candidateLoads, index, slotCount, powerKw);
    const gridKwh = Math.max(0, simulateEnergy(slots, candidateLoads, baseLoadKw, battery, startSocPct).gridKwh - before.gridKwh);
    if (!best || gridKwh < best.gridKwh - .0001) return { index, gridKwh };
    return best;
  }, undefined);
}

function planDevices(devices: PlannerDevice[], slots: PlannerSlot[], baseLoadKw: number, manualStarts: Record<string, number>, battery: BatterySettings, startSocPct: number): PlannerResult {
  const loads = Array.from({ length: slots.length }, () => 0);
  const schedules: DeviceSchedule[] = [];
  const enabled = devices.filter((device) => device.enabled && device.energyKwh > 0 && device.durationMinutes > 0);

  const place = (device: PlannerDevice, startIndex: number, manual: boolean) => {
    const slotCount = Math.max(1, Math.ceil(device.durationMinutes / 15));
    const powerKw = device.energyKwh / (slotCount * SLOT_HOURS);
    const beforeGridKwh = simulateEnergy(slots, loads, baseLoadKw, battery, startSocPct).gridKwh;
    const candidateLoads = [...loads];
    addDeviceLoad(candidateLoads, startIndex, slotCount, powerKw);
    const gridKwh = Math.max(0, simulateEnergy(slots, candidateLoads, baseLoadKw, battery, startSocPct).gridKwh - beforeGridKwh);
    addDeviceLoad(loads, startIndex, slotCount, powerKw);
    schedules.push({ device, startIndex, slotCount, powerKw, gridKwh, solarSharePct: Math.max(0, 100 * (1 - gridKwh / device.energyKwh)), manual });
  };

  enabled.filter((device) => Number.isFinite(manualStarts[device.id])).forEach((device) => {
    const candidates = candidateStarts(device, slots);
    const manualIndex = slots.findIndex((slot) => slot.timestamp === manualStarts[device.id]);
    if (candidates.includes(manualIndex)) place(device, manualIndex, true);
  });

  enabled.filter((device) => !schedules.some((schedule) => schedule.device.id === device.id)).forEach((device) => {
    const best = chooseBestStart(device, slots, loads, baseLoadKw, battery, startSocPct);
    if (best) place(device, best.index, false);
  });

  const baselineLoads = Array.from({ length: slots.length }, () => 0);
  const baselineSimulation = simulateEnergy(slots, baselineLoads, baseLoadKw, battery, startSocPct);
  const plannedSimulation = simulateEnergy(slots, loads, baseLoadKw, battery, startSocPct);
  const naiveLoads = Array.from({ length: slots.length }, () => 0);
  enabled.forEach((device) => {
    const startIndex = candidateStarts(device, slots)[0];
    if (!Number.isFinite(startIndex)) return;
    const slotCount = Math.max(1, Math.ceil(device.durationMinutes / 15));
    addDeviceLoad(naiveLoads, startIndex, slotCount, device.energyKwh / (slotCount * SLOT_HOURS));
  });
  const naiveSimulation = simulateEnergy(slots, naiveLoads, baseLoadKw, battery, startSocPct);
  const totalEnergy = enabled.reduce((sum, device) => sum + device.energyKwh, 0);
  const incrementalGrid = Math.max(0, plannedSimulation.gridKwh - baselineSimulation.gridKwh);
  return {
    schedules,
    loads,
    baselineGridKwh: baselineSimulation.gridKwh,
    plannedGridKwh: plannedSimulation.gridKwh,
    naiveGridKwh: naiveSimulation.gridKwh,
    savedGridKwh: Math.max(0, naiveSimulation.gridKwh - plannedSimulation.gridKwh),
    solarSharePct: totalEnergy ? Math.max(0, 100 * (1 - incrementalGrid / totalEnergy)) : 0,
    batterySocSeries: plannedSimulation.socSeries,
    batteryStartSocPct: startSocPct,
    batteryEndSocPct: plannedSimulation.endSocPct,
    batteryChargeKwh: plannedSimulation.chargeKwh,
    batteryDischargeKwh: plannedSimulation.dischargeKwh,
  };
}

function loadStoredState() {
  const fallback = { devices: defaultDevices(), baseLoadKw: .25, manualStarts: {} as Record<string, number>, batterySettings: DEFAULT_BATTERY_SETTINGS };
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!stored || !Array.isArray(stored.devices)) return fallback;
    return {
      devices: stored.devices as PlannerDevice[],
      baseLoadKw: Number.isFinite(stored.baseLoadKw) ? stored.baseLoadKw : fallback.baseLoadKw,
      manualStarts: stored.manualStarts && typeof stored.manualStarts === "object" ? stored.manualStarts as Record<string, number> : {},
      batterySettings: stored.batterySettings && typeof stored.batterySettings === "object" ? { ...DEFAULT_BATTERY_SETTINGS, ...stored.batterySettings } as BatterySettings : fallback.batterySettings,
    };
  } catch {
    return fallback;
  }
}

function shareClass(value: number) {
  if (value >= 80) return "is-solar";
  if (value >= 40) return "is-mixed";
  return "is-grid";
}

export function ConsumptionPlanner({ data }: { data: DashboardData }) {
  const initial = useMemo(() => loadStoredState(), []);
  const [devices, setDevices] = useState(initial.devices);
  const [baseLoadKw, setBaseLoadKw] = useState(initial.baseLoadKw);
  const [manualStarts, setManualStarts] = useState(initial.manualStarts);
  const [batterySettings, setBatterySettings] = useState(initial.batterySettings);
  const [viewDay, setViewDay] = useState<DayOffset>(flexibleDay);
  const [expandedDevices, setExpandedDevices] = useState<Set<string>>(() => new Set());
  const [dragState, setDragState] = useState<DragState | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const forecast = data.forecast;
  const slots = useMemo(() => forecast ? makeSlots(forecast) : [], [forecast]);
  const latestSoc = [...(data.solar.energyChart ?? [])].reverse().find((point) => Number.isFinite(point.batterySoc))?.batterySoc;
  const startSocPct = Number.isFinite(latestSoc) ? Math.max(0, Math.min(100, latestSoc!)) : batterySettings.fallbackSocPct;
  const result = useMemo(() => planDevices(devices, slots, baseLoadKw, manualStarts, batterySettings, startSocPct), [baseLoadKw, batterySettings, devices, manualStarts, slots, startSocPct]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ devices, baseLoadKw, manualStarts, batterySettings }));
  }, [baseLoadKw, batterySettings, devices, manualStarts]);

  if (!forecast || forecast.days.length < 3 || !slots.length) {
    return <article className="planner-card card"><p className="eyebrow">Interaktív tervező</p><h2>Fogyasztástervező</h2><p className="planner-empty">A következő 72 órás termelési előrejelzéssel együtt válik elérhetővé.</p></article>;
  }

  const daySlots = slots.filter((slot) => slot.dayOffset === viewDay);
  const dayStartIndex = slots.findIndex((slot) => slot.dayOffset === viewDay);
  const daySchedules = result.schedules.filter((schedule) => schedule.device.dayOffset === viewDay);
  const daySocSeries = daySlots.map((_, index) => result.batterySocSeries[dayStartIndex + index] ?? result.batteryEndSocPct);
  const previousSoc = dayStartIndex > 0 ? result.batterySocSeries[dayStartIndex - 1] : result.batteryStartSocPct;
  const dayEndSoc = daySocSeries.at(-1) ?? previousSoc;
  const maximum = Math.max(5, ...daySlots.map((slot, index) => Math.max(slot.expectedPowerKw, baseLoadKw + result.loads[dayStartIndex + index])));
  const totalDeviceEnergy = devices.filter((device) => device.enabled).reduce((sum, device) => sum + device.energyKwh, 0);

  const updateDevice = (id: string, changes: Partial<PlannerDevice>, resetManual = true) => {
    setDevices((current) => current.map((device) => device.id === id ? { ...device, ...changes } : device));
    if (resetManual) setManualStarts((current) => { const next = { ...current }; delete next[id]; return next; });
  };

  const shiftSchedule = (schedule: DeviceSchedule, direction: -1 | 1) => {
    const candidates = candidateStarts(schedule.device, slots);
    const currentPosition = candidates.indexOf(schedule.startIndex);
    const nextIndex = candidates[currentPosition + direction];
    if (!Number.isFinite(nextIndex)) return;
    setManualStarts((current) => ({ ...current, [schedule.device.id]: slots[nextIndex].timestamp }));
  };

  const moveScheduleToPointer = (schedule: DeviceSchedule, clientX: number, offsetMinutes: number) => {
    const bounds = timelineRef.current?.getBoundingClientRect();
    if (!bounds?.width) return;
    const targetMinute = Math.max(0, Math.min(1440, (clientX - bounds.left) / bounds.width * 1440 - offsetMinutes));
    const candidates = candidateStarts(schedule.device, slots);
    const closest = candidates.reduce<number | undefined>((best, candidate) => {
      const date = new Date(slots[candidate].timestamp);
      const candidateMinute = date.getHours() * 60 + date.getMinutes();
      if (best === undefined) return candidate;
      const bestDate = new Date(slots[best].timestamp);
      const bestMinute = bestDate.getHours() * 60 + bestDate.getMinutes();
      return Math.abs(candidateMinute - targetMinute) < Math.abs(bestMinute - targetMinute) ? candidate : best;
    }, undefined);
    if (closest !== undefined) setManualStarts((current) => ({ ...current, [schedule.device.id]: slots[closest].timestamp }));
  };

  const toggleDeviceDetails = (id: string) => {
    setExpandedDevices((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addDevice = () => {
    const id = `custom-${Date.now()}`;
    setDevices((current) => [...current, {
      id,
      name: "Új fogyasztó",
      shortName: "+",
      energyKwh: 1,
      durationMinutes: 60,
      dayOffset: viewDay,
      earliest: "09:00",
      latest: "18:00",
      enabled: true,
      custom: true,
      sourceNote: "Saját becslés - add meg az egy használatra jutó energiát és időtartamot.",
    }]);
    setExpandedDevices((current) => new Set(current).add(id));
  };

  return (
    <article className="planner-card card">
      <header className="planner-head">
        <div>
          <p className="eyebrow">Interaktív tervező · 72 óra</p>
          <h2>Fogyasztástervező</h2>
          <p>Próbáld ki, mikor érdemes elindítani a fogyasztókat. A modell előbb a napenergiát, majd az akkumulátort, végül a hálózatot használja.</p>
        </div>
        <button className="planner-auto" onClick={() => setManualStarts({})}>Automatikus ütemezés</button>
      </header>

      <div className="planner-summary" aria-label="Tervezés összesítése">
        <div><span>Tervezett fogyasztás</span><strong>{totalDeviceEnergy.toFixed(1)} <small>kWh</small></strong></div>
        <div><span>PV / akku fedezet</span><strong>{result.solarSharePct.toFixed(0)}<small>%</small></strong></div>
        <div><span>Hálózati igény</span><strong>{Math.max(0, result.plannedGridKwh - result.baselineGridKwh).toFixed(1)} <small>kWh</small></strong></div>
        <div><span>Akku leadás</span><strong>{result.batteryDischargeKwh.toFixed(1)} <small>kWh</small></strong></div>
        <div><span>PV-ből akkutöltés</span><strong>{result.batteryChargeKwh.toFixed(1)} <small>kWh</small></strong></div>
        <div><span>Akku 72 óra végén</span><strong>{result.batteryEndSocPct.toFixed(0)}<small>%</small></strong></div>
      </div>

      <div className="planner-controls">
        <div className="planner-day-tabs" role="tablist" aria-label="Tervezési nap">
          {forecast.days.slice(0, 3).map((day, index) => <button key={day.date} role="tab" aria-selected={viewDay === index} className={viewDay === index ? "active" : ""} onClick={() => setViewDay(index as DayOffset)}>{formatDay(day.date, day.label)}</button>)}
        </div>
        <p className="planner-drag-hint" id="planner-drag-hint">Fogd meg a blokkokat, és húzd őket a kívánt időpontra.</p>
        <label className="planner-base-load">Háttérfogyasztás <span><input type="number" min="0" max="5" step="0.05" value={baseLoadKw} onChange={(event) => setBaseLoadKw(Math.max(0, Number(event.target.value)))} /> kW</span></label>
      </div>

      <section className="planner-timeline-wrap" aria-label={`${forecast.days[viewDay].label} fogyasztási idővonala`}>
        <div ref={timelineRef} className={`planner-timeline ${dragState ? "is-dragging" : ""}`} style={{ minHeight: `${Math.max(230, daySchedules.length * 34 + 88)}px` }}>
          <div className="planner-solar-profile" aria-hidden="true">
            {daySlots.map((slot, index) => <i key={slot.timestamp} style={{ left: `${index / daySlots.length * 100}%`, width: `${100 / daySlots.length + .1}%`, height: `${slot.expectedPowerKw / maximum * 100}%` }} />)}
          </div>
          <div className="planner-base-line" aria-hidden="true" style={{ bottom: `${baseLoadKw / maximum * 100}%` }}><span>háttér</span></div>
          <div className="planner-battery-profile" aria-hidden="true">
            <span className="planner-battery-day">AKKU {previousSoc.toFixed(0)} → {dayEndSoc.toFixed(0)}%</span>
            <span className="planner-battery-reserve" style={{ bottom: `${batterySettings.reservePct}%` }} />
            {daySocSeries.map((soc, index) => <i key={daySlots[index].timestamp} style={{ left: `${index / daySocSeries.length * 100}%`, bottom: `${soc}%` }} />)}
          </div>
          <div className="planner-schedule-lanes">
            {daySchedules.map((schedule, lane) => {
              const start = new Date(slots[schedule.startIndex].timestamp);
              const minute = start.getHours() * 60 + start.getMinutes();
              const dragging = dragState?.deviceId === schedule.device.id;
              return <button
                key={schedule.device.id}
                className={`planner-block ${shareClass(schedule.solarSharePct)} ${dragging ? "is-dragging" : ""}`}
                style={{ left: `${minute / 1440 * 100}%`, width: `${schedule.slotCount * 15 / 1440 * 100}%`, top: `${lane * 34 + 14}px` }}
                title={`${schedule.device.name}: ${formatClock(start.getTime())}, ${schedule.solarSharePct.toFixed(0)}% PV/akku fedezet`}
                aria-label={`${schedule.device.name}, ${formatClock(start.getTime())}. Húzd az idővonalon, vagy használd a bal és jobb nyilat 15 perces lépésekhez.`}
                aria-describedby="planner-drag-hint"
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  const bounds = event.currentTarget.getBoundingClientRect();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setDragState({
                    deviceId: schedule.device.id,
                    pointerId: event.pointerId,
                    offsetMinutes: Math.max(0, Math.min(schedule.slotCount * 15, (event.clientX - bounds.left) / Math.max(1, bounds.width) * schedule.slotCount * 15)),
                  });
                }}
                onPointerMove={(event) => {
                  if (dragState?.deviceId !== schedule.device.id || dragState.pointerId !== event.pointerId) return;
                  moveScheduleToPointer(schedule, event.clientX, dragState.offsetMinutes);
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
                    shiftSchedule(schedule, event.key === "ArrowLeft" ? -1 : 1);
                  }
                }}
              ><span className="planner-grip" aria-hidden="true">⋮⋮</span><span>{schedule.device.shortName}</span><b>{formatClock(start.getTime())}</b></button>;
            })}
          </div>
          <div className="planner-hours" aria-hidden="true">{[0, 4, 8, 12, 16, 20, 24].map((hour) => <span key={hour} style={{ left: `${hour / 24 * 100}%` }}>{String(hour).padStart(2, "0")}</span>)}</div>
        </div>
        <div className="planner-key"><span><i className="solar" />PV-előrejelzés</span><span><i className="battery" />akku töltöttség</span><span><i className="good" />főként helyi energia</span><span><i className="mixed" />vegyes</span><span><i className="grid" />hálózatigényes</span></div>
      </section>

      <details className="planner-battery-settings">
        <summary><span>Akkumulátor modell</span><b>{batterySettings.capacityKwh.toFixed(1)} kWh · {batterySettings.reservePct}% tartalék · {batterySettings.idleLossPctPerDay}%/nap veszteség</b></summary>
        <div className="planner-battery-fields">
          <label>Kapacitás<span><input type="number" min="0.1" max="100" step="0.1" value={batterySettings.capacityKwh} onChange={(event) => setBatterySettings((current) => ({ ...current, capacityKwh: Math.max(.1, Number(event.target.value)) }))} /> kWh</span></label>
          <label>Védett tartalék<span><input type="number" min="0" max="95" step="1" value={batterySettings.reservePct} onChange={(event) => setBatterySettings((current) => ({ ...current, reservePct: Math.max(0, Math.min(95, Number(event.target.value))) }))} /> %</span></label>
          <label>Max. töltés / leadás<span><input type="number" min="0" max="30" step="0.1" value={batterySettings.maxPowerKw} onChange={(event) => setBatterySettings((current) => ({ ...current, maxPowerKw: Math.max(0, Number(event.target.value)) }))} /> kW</span></label>
          <label>Hatásfok<span><input type="number" min="50" max="100" step="1" value={batterySettings.efficiencyPct} onChange={(event) => setBatterySettings((current) => ({ ...current, efficiencyPct: Math.max(50, Math.min(100, Number(event.target.value))) }))} /> %</span></label>
          <label>Üresjárati veszteség<span><input type="number" min="0" max="20" step="0.1" value={batterySettings.idleLossPctPerDay} onChange={(event) => setBatterySettings((current) => ({ ...current, idleLossPctPerDay: Math.max(0, Number(event.target.value)) }))} /> %/nap</span></label>
          <label>Tartalék kezdő SOC<span><input type="number" min="0" max="100" step="1" value={batterySettings.fallbackSocPct} onChange={(event) => setBatterySettings((current) => ({ ...current, fallbackSocPct: Math.max(0, Math.min(100, Number(event.target.value))) }))} /> %</span></label>
        </div>
        <p>A kezdő töltöttség: <strong>{startSocPct.toFixed(0)}%</strong> ({Number.isFinite(latestSoc) ? "élő Sungrow-adat" : "megadott tartalékérték"}). A napi veszteség fogyasztás nélkül is folyamatosan levonódik.</p>
      </details>

      <div className="planner-body">
        <section className="planner-devices" aria-label="Fogyasztók">
          {devices.map((device) => {
            const schedule = result.schedules.find((item) => item.device.id === device.id);
            const startTime = schedule ? slots[schedule.startIndex].timestamp : undefined;
            const endTime = schedule ? slots[schedule.startIndex + schedule.slotCount - 1].timestamp + 15 * 60_000 : undefined;
            const candidates = schedule ? candidateStarts(device, slots) : [];
            const candidatePosition = schedule ? candidates.indexOf(schedule.startIndex) : -1;
            const expanded = expandedDevices.has(device.id);
            return <div id={`planner-device-${device.id}`} className={`planner-device ${device.enabled ? "" : "is-disabled"} ${expanded ? "is-expanded" : ""}`} key={device.id}>
              <div className="planner-device-row">
                <label className="planner-toggle"><input type="checkbox" checked={device.enabled} onChange={(event) => updateDevice(device.id, { enabled: event.target.checked })} /><span /></label>
                <span className="planner-device-mark">{device.shortName}</span>
                <div className="planner-device-title"><strong>{device.name}</strong><span>{device.energyKwh.toFixed(1)} kWh · {device.durationMinutes} perc</span></div>
                <span className="planner-device-window"><b>{device.dayOffset === 0 ? "Ma" : device.dayOffset === 1 ? "Holnap" : "Holnapután"}</b>{device.earliest}–{device.latest}</span>
                {schedule && startTime && endTime ? <div className={`planner-device-time ${shareClass(schedule.solarSharePct)}`}><strong>{formatClock(startTime)}–{formatClock(endTime)}</strong><span>{schedule.solarSharePct.toFixed(0)}% PV/akku</span></div> : <span className="planner-warning">Nincs időablak</span>}
                {schedule && <div className="planner-step-buttons planner-step-buttons--compact"><button disabled={candidatePosition <= 0} onClick={() => shiftSchedule(schedule, -1)} aria-label={`${device.name} 15 perccel korábban`}>−15</button><button className={!schedule.manual ? "is-auto" : ""} onClick={() => setManualStarts((current) => { const next = { ...current }; delete next[device.id]; return next; })} aria-label={`${device.name} automatikus időzítése`}>A</button><button disabled={candidatePosition >= candidates.length - 1} onClick={() => shiftSchedule(schedule, 1)} aria-label={`${device.name} 15 perccel később`}>+15</button></div>}
                <button className="planner-edit" aria-expanded={expanded} aria-controls={`planner-details-${device.id}`} onClick={() => toggleDeviceDetails(device.id)}>{expanded ? "Bezárás" : "Szerkesztés"}<span aria-hidden="true">⌄</span></button>
              </div>
              {expanded && <div className="planner-device-details" id={`planner-details-${device.id}`}>
                <div className="planner-device-fields">
                  <label>Név<input className="planner-device-name" aria-label="Fogyasztó neve" value={device.name} onChange={(event) => updateDevice(device.id, { name: event.target.value }, false)} /></label>
                  <label>Energia / használat<span><input type="number" min="0.1" max="30" step="0.1" value={device.energyKwh} onChange={(event) => updateDevice(device.id, { energyKwh: Math.max(.1, Number(event.target.value)) })} /> kWh</span></label>
                  <label>Időtartam<span><input type="number" min="15" max="720" step="15" value={device.durationMinutes} onChange={(event) => updateDevice(device.id, { durationMinutes: Math.max(15, Number(event.target.value)) })} /> perc</span></label>
                  <label>Nap<select value={device.dayOffset} onChange={(event) => { const dayOffset = Number(event.target.value) as DayOffset; updateDevice(device.id, { dayOffset }); setViewDay(dayOffset); }}>{forecast.days.slice(0, 3).map((day, index) => <option key={day.date} value={index}>{formatDay(day.date, day.label)}</option>)}</select></label>
                  <label>Indítható<input type="time" step="900" value={device.earliest} onChange={(event) => updateDevice(device.id, { earliest: event.target.value })} /></label>
                  <label>Legkésőbb kész<input type="time" step="900" value={device.latest} onChange={(event) => updateDevice(device.id, { latest: event.target.value })} /></label>
                </div>
                <div className="planner-device-detail-foot"><p className="planner-device-note">{device.sourceNote} {device.sourceUrl && <a href={device.sourceUrl} target="_blank" rel="noreferrer">{device.sourceLabel} ↗</a>}</p>{device.custom && <button className="planner-remove" aria-label={`${device.name} törlése`} onClick={() => setDevices((current) => current.filter((item) => item.id !== device.id))}>Fogyasztó törlése</button>}</div>
              </div>}
            </div>;
          })}
          <button className="planner-add" onClick={addDevice}>+ Saját fogyasztó hozzáadása</button>
        </section>

        <aside className="planner-explanation">
          <p className="eyebrow">Mit jelent az eredmény?</p>
          <h3>Három napot és az akkut együtt tervezi.</h3>
          <p>A számítás 15 perces egységekben követi a PV-termelést, a fogyasztást és az akku töltöttségét. A PV-többlet feltölti az akkut; energiahiánynál az akku a hálózat előtt lép be.</p>
          <dl>
            <div><dt>Legkorábbi indításhoz képest</dt><dd>−{result.savedGridKwh.toFixed(1)} kWh</dd></div>
            <div><dt>Átlagos tervezett teljesítmény</dt><dd>{totalDeviceEnergy ? (totalDeviceEnergy / Math.max(.25, devices.filter((device) => device.enabled).reduce((sum, device) => sum + device.durationMinutes / 60, 0))).toFixed(1) : "0.0"} kW</dd></div>
            <div><dt>Alapfogyasztás 72 órára</dt><dd>{(baseLoadKw * 72).toFixed(1)} kWh</dd></div>
            <div><dt>Akku kezdő → záró SOC</dt><dd>{result.batteryStartSocPct.toFixed(0)} → {result.batteryEndSocPct.toFixed(0)}%</dd></div>
          </dl>
          <p className="planner-caveat">A ma felhasznált akkumulátoros energia csökkenti a holnapi induló töltöttséget, ezért azt a következő napok PV-termelésének újra fel kell töltenie. A hatásfok, a teljesítménykorlát és a fogyasztás nélküli töltöttségvesztés is része a becslésnek.</p>
          <button className="planner-reset" onClick={() => { setDevices(defaultDevices()); setBaseLoadKw(.25); setManualStarts({}); setBatterySettings(DEFAULT_BATTERY_SETTINGS); }}>Alapértékek visszaállítása</button>
        </aside>
      </div>
    </article>
  );
}
