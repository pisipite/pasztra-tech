import { useEffect, useMemo, useState } from "react";
import type { DashboardData, SolarForecast } from "./types";

type DayOffset = 0 | 1;

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

type PlannerResult = {
  schedules: DeviceSchedule[];
  loads: number[];
  baselineGridKwh: number;
  plannedGridKwh: number;
  naiveGridKwh: number;
  savedGridKwh: number;
  solarSharePct: number;
};

const STORAGE_KEY = "pasztra-consumption-planner-v1";
const SLOT_HOURS = .25;

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
  const dates = forecast.days.slice(0, 2).map((day) => day.date);
  return forecast.days.slice(0, 2).flatMap((day, dayIndex) => day.points.flatMap((point, pointIndex) => {
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

function totalGridKwh(slots: PlannerSlot[], loads: number[], baseLoadKw: number) {
  return slots.reduce((total, slot, index) => total + Math.max(0, baseLoadKw + loads[index] - slot.expectedPowerKw) * SLOT_HOURS, 0);
}

function addDeviceLoad(loads: number[], startIndex: number, slotCount: number, powerKw: number) {
  for (let index = startIndex; index < startIndex + slotCount; index += 1) loads[index] += powerKw;
}

function placementGridKwh(slots: PlannerSlot[], loads: number[], startIndex: number, slotCount: number, powerKw: number, baseLoadKw: number) {
  let value = 0;
  for (let index = startIndex; index < startIndex + slotCount; index += 1) {
    const before = Math.max(0, baseLoadKw + loads[index] - slots[index].expectedPowerKw);
    const after = Math.max(0, baseLoadKw + loads[index] + powerKw - slots[index].expectedPowerKw);
    value += (after - before) * SLOT_HOURS;
  }
  return value;
}

function chooseBestStart(device: PlannerDevice, slots: PlannerSlot[], loads: number[], baseLoadKw: number) {
  const slotCount = Math.max(1, Math.ceil(device.durationMinutes / 15));
  const powerKw = device.energyKwh / (slotCount * SLOT_HOURS);
  const candidates = candidateStarts(device, slots);
  return candidates.reduce<{ index: number; gridKwh: number } | undefined>((best, index) => {
    const gridKwh = placementGridKwh(slots, loads, index, slotCount, powerKw, baseLoadKw);
    if (!best || gridKwh < best.gridKwh - .0001) return { index, gridKwh };
    return best;
  }, undefined);
}

function planDevices(devices: PlannerDevice[], slots: PlannerSlot[], baseLoadKw: number, manualStarts: Record<string, number>): PlannerResult {
  const loads = Array.from({ length: slots.length }, () => 0);
  const schedules: DeviceSchedule[] = [];
  const enabled = devices.filter((device) => device.enabled && device.energyKwh > 0 && device.durationMinutes > 0);

  const place = (device: PlannerDevice, startIndex: number, manual: boolean) => {
    const slotCount = Math.max(1, Math.ceil(device.durationMinutes / 15));
    const powerKw = device.energyKwh / (slotCount * SLOT_HOURS);
    const gridKwh = placementGridKwh(slots, loads, startIndex, slotCount, powerKw, baseLoadKw);
    addDeviceLoad(loads, startIndex, slotCount, powerKw);
    schedules.push({ device, startIndex, slotCount, powerKw, gridKwh, solarSharePct: Math.max(0, 100 * (1 - gridKwh / device.energyKwh)), manual });
  };

  enabled.filter((device) => Number.isFinite(manualStarts[device.id])).forEach((device) => {
    const candidates = candidateStarts(device, slots);
    const manualIndex = slots.findIndex((slot) => slot.timestamp === manualStarts[device.id]);
    if (candidates.includes(manualIndex)) place(device, manualIndex, true);
  });

  enabled.filter((device) => !schedules.some((schedule) => schedule.device.id === device.id)).forEach((device) => {
    const best = chooseBestStart(device, slots, loads, baseLoadKw);
    if (best) place(device, best.index, false);
  });

  const baselineLoads = Array.from({ length: slots.length }, () => 0);
  const baselineGridKwh = totalGridKwh(slots, baselineLoads, baseLoadKw);
  const plannedGridKwh = totalGridKwh(slots, loads, baseLoadKw);
  const naiveLoads = Array.from({ length: slots.length }, () => 0);
  enabled.forEach((device) => {
    const startIndex = candidateStarts(device, slots)[0];
    if (!Number.isFinite(startIndex)) return;
    const slotCount = Math.max(1, Math.ceil(device.durationMinutes / 15));
    addDeviceLoad(naiveLoads, startIndex, slotCount, device.energyKwh / (slotCount * SLOT_HOURS));
  });
  const naiveGridKwh = totalGridKwh(slots, naiveLoads, baseLoadKw);
  const totalEnergy = enabled.reduce((sum, device) => sum + device.energyKwh, 0);
  const incrementalGrid = Math.max(0, plannedGridKwh - baselineGridKwh);
  return {
    schedules,
    loads,
    baselineGridKwh,
    plannedGridKwh,
    naiveGridKwh,
    savedGridKwh: Math.max(0, naiveGridKwh - plannedGridKwh),
    solarSharePct: totalEnergy ? Math.max(0, 100 * (1 - incrementalGrid / totalEnergy)) : 0,
  };
}

function loadStoredState() {
  const fallback = { devices: defaultDevices(), baseLoadKw: .25, manualStarts: {} as Record<string, number> };
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!stored || !Array.isArray(stored.devices)) return fallback;
    return {
      devices: stored.devices as PlannerDevice[],
      baseLoadKw: Number.isFinite(stored.baseLoadKw) ? stored.baseLoadKw : fallback.baseLoadKw,
      manualStarts: stored.manualStarts && typeof stored.manualStarts === "object" ? stored.manualStarts as Record<string, number> : {},
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
  const [viewDay, setViewDay] = useState<DayOffset>(flexibleDay);
  const forecast = data.forecast;
  const slots = useMemo(() => forecast ? makeSlots(forecast) : [], [forecast]);
  const result = useMemo(() => planDevices(devices, slots, baseLoadKw, manualStarts), [baseLoadKw, devices, manualStarts, slots]);
  const latestSoc = [...(data.solar.energyChart ?? [])].reverse().find((point) => Number.isFinite(point.batterySoc))?.batterySoc;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ devices, baseLoadKw, manualStarts }));
  }, [baseLoadKw, devices, manualStarts]);

  if (!forecast || forecast.days.length < 2 || !slots.length) {
    return <article className="planner-card card"><p className="eyebrow">Interaktív tervező</p><h2>Fogyasztástervező</h2><p className="planner-empty">A következő 48 órás termelési előrejelzéssel együtt válik elérhetővé.</p></article>;
  }

  const daySlots = slots.filter((slot) => slot.dayOffset === viewDay);
  const dayStartIndex = slots.findIndex((slot) => slot.dayOffset === viewDay);
  const daySchedules = result.schedules.filter((schedule) => schedule.device.dayOffset === viewDay);
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
  };

  return (
    <article className="planner-card card">
      <header className="planner-head">
        <div>
          <p className="eyebrow">Interaktív tervező · 48 óra</p>
          <h2>Fogyasztástervező</h2>
          <p>Próbáld ki, mikor érdemes elindítani a fogyasztókat, hogy minél több energiát közvetlenül a napelem fedezzen.</p>
        </div>
        <button className="planner-auto" onClick={() => setManualStarts({})}>Automatikus ütemezés</button>
      </header>

      <div className="planner-summary" aria-label="Tervezés összesítése">
        <div><span>Tervezett fogyasztás</span><strong>{totalDeviceEnergy.toFixed(1)} <small>kWh</small></strong></div>
        <div><span>Várható napelemes rész</span><strong>{result.solarSharePct.toFixed(0)}<small>%</small></strong></div>
        <div><span>Hálózati igény</span><strong>{Math.max(0, result.plannedGridKwh - result.baselineGridKwh).toFixed(1)} <small>kWh</small></strong></div>
        <div><span>Vételezéscsökkenés</span><strong>{result.savedGridKwh.toFixed(1)} <small>kWh</small></strong></div>
        <div><span>Akku pillanatnyilag</span><strong>{Number.isFinite(latestSoc) ? latestSoc!.toFixed(0) : "—"}<small>%</small></strong></div>
      </div>

      <div className="planner-controls">
        <div className="planner-day-tabs" role="tablist" aria-label="Tervezési nap">
          {forecast.days.slice(0, 2).map((day, index) => <button key={day.date} role="tab" aria-selected={viewDay === index} className={viewDay === index ? "active" : ""} onClick={() => setViewDay(index as DayOffset)}>{formatDay(day.date, day.label)}</button>)}
        </div>
        <label className="planner-base-load">Háttérfogyasztás <span><input type="number" min="0" max="5" step="0.05" value={baseLoadKw} onChange={(event) => setBaseLoadKw(Math.max(0, Number(event.target.value)))} /> kW</span></label>
      </div>

      <section className="planner-timeline-wrap" aria-label={`${forecast.days[viewDay].label} fogyasztási idővonala`}>
        <div className="planner-timeline" style={{ minHeight: `${Math.max(230, daySchedules.length * 34 + 88)}px` }}>
          <div className="planner-solar-profile" aria-hidden="true">
            {daySlots.map((slot, index) => <i key={slot.timestamp} style={{ left: `${index / daySlots.length * 100}%`, width: `${100 / daySlots.length + .1}%`, height: `${slot.expectedPowerKw / maximum * 100}%` }} />)}
          </div>
          <div className="planner-base-line" aria-hidden="true" style={{ bottom: `${baseLoadKw / maximum * 100}%` }}><span>háttér</span></div>
          <div className="planner-schedule-lanes">
            {daySchedules.map((schedule, lane) => {
              const start = new Date(slots[schedule.startIndex].timestamp);
              const minute = start.getHours() * 60 + start.getMinutes();
              return <button key={schedule.device.id} className={`planner-block ${shareClass(schedule.solarSharePct)}`} style={{ left: `${minute / 1440 * 100}%`, width: `${schedule.slotCount * 15 / 1440 * 100}%`, top: `${lane * 34 + 14}px` }} title={`${schedule.device.name}: ${formatClock(start.getTime())}, ${schedule.solarSharePct.toFixed(0)}% napelem`} onClick={() => document.getElementById(`planner-device-${schedule.device.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}><span>{schedule.device.shortName}</span><b>{formatClock(start.getTime())}</b></button>;
            })}
          </div>
          <div className="planner-hours" aria-hidden="true">{[0, 4, 8, 12, 16, 20, 24].map((hour) => <span key={hour} style={{ left: `${hour / 24 * 100}%` }}>{String(hour).padStart(2, "0")}</span>)}</div>
        </div>
        <div className="planner-key"><span><i className="solar" />PV-előrejelzés</span><span><i className="good" />főként napenergia</span><span><i className="mixed" />vegyes</span><span><i className="grid" />hálózatigényes</span></div>
      </section>

      <div className="planner-body">
        <section className="planner-devices" aria-label="Fogyasztók">
          {devices.map((device) => {
            const schedule = result.schedules.find((item) => item.device.id === device.id);
            const startTime = schedule ? slots[schedule.startIndex].timestamp : undefined;
            const endTime = schedule ? slots[schedule.startIndex + schedule.slotCount - 1].timestamp + 15 * 60_000 : undefined;
            const candidates = schedule ? candidateStarts(device, slots) : [];
            const candidatePosition = schedule ? candidates.indexOf(schedule.startIndex) : -1;
            return <div id={`planner-device-${device.id}`} className={`planner-device ${device.enabled ? "" : "is-disabled"}`} key={device.id}>
              <div className="planner-device-head">
                <label className="planner-toggle"><input type="checkbox" checked={device.enabled} onChange={(event) => updateDevice(device.id, { enabled: event.target.checked })} /><span /></label>
                <span className="planner-device-mark">{device.shortName}</span>
                <input className="planner-device-name" aria-label="Fogyasztó neve" value={device.name} onChange={(event) => updateDevice(device.id, { name: event.target.value }, false)} />
                {device.custom && <button className="planner-remove" aria-label={`${device.name} törlése`} onClick={() => setDevices((current) => current.filter((item) => item.id !== device.id))}>×</button>}
              </div>
              <div className="planner-device-fields">
                <label>Energia / használat<span><input type="number" min="0.1" max="30" step="0.1" value={device.energyKwh} onChange={(event) => updateDevice(device.id, { energyKwh: Math.max(.1, Number(event.target.value)) })} /> kWh</span></label>
                <label>Időtartam<span><input type="number" min="15" max="720" step="15" value={device.durationMinutes} onChange={(event) => updateDevice(device.id, { durationMinutes: Math.max(15, Number(event.target.value)) })} /> perc</span></label>
                <label>Nap<select value={device.dayOffset} onChange={(event) => updateDevice(device.id, { dayOffset: Number(event.target.value) as DayOffset })}><option value="0">{formatDay(forecast.days[0].date, "Ma")}</option><option value="1">{formatDay(forecast.days[1].date, "Holnap")}</option></select></label>
                <label>Indítható<input type="time" step="900" value={device.earliest} onChange={(event) => updateDevice(device.id, { earliest: event.target.value })} /></label>
                <label>Legkésőbb kész<input type="time" step="900" value={device.latest} onChange={(event) => updateDevice(device.id, { latest: event.target.value })} /></label>
              </div>
              <p className="planner-device-note">{device.sourceNote} {device.sourceUrl && <a href={device.sourceUrl} target="_blank" rel="noreferrer">{device.sourceLabel} ↗</a>}</p>
              <div className="planner-recommendation">
                {schedule && startTime && endTime ? <>
                  <div><span>{schedule.manual ? "Beállított idő" : "Ajánlott idő"}</span><strong>{formatClock(startTime)}–{formatClock(endTime)}</strong><small>{schedule.solarSharePct.toFixed(0)}% várhatóan napelemből</small></div>
                  <div className="planner-step-buttons"><button disabled={candidatePosition <= 0} onClick={() => shiftSchedule(schedule, -1)} aria-label={`${device.name} 15 perccel korábban`}>−15</button><button className={!schedule.manual ? "is-auto" : ""} onClick={() => setManualStarts((current) => { const next = { ...current }; delete next[device.id]; return next; })}>Ajánlott</button><button disabled={candidatePosition >= candidates.length - 1} onClick={() => shiftSchedule(schedule, 1)} aria-label={`${device.name} 15 perccel később`}>+15</button></div>
                </> : <span className="planner-warning">Nincs elegendő hely a megadott időablakban.</span>}
              </div>
            </div>;
          })}
          <button className="planner-add" onClick={addDevice}>+ Saját fogyasztó hozzáadása</button>
        </section>

        <aside className="planner-explanation">
          <p className="eyebrow">Mit jelent az eredmény?</p>
          <h3>A napos órákat tölti fel először.</h3>
          <p>A számítás 15 perces egységekben keresi azt az időpontot, amikor a PV-előrejelzésből a háttérfogyasztás után a legtöbb energia marad.</p>
          <dl>
            <div><dt>Legkorábbi indításhoz képest</dt><dd>−{result.savedGridKwh.toFixed(1)} kWh</dd></div>
            <div><dt>Átlagos tervezett teljesítmény</dt><dd>{totalDeviceEnergy ? (totalDeviceEnergy / Math.max(.25, devices.filter((device) => device.enabled).reduce((sum, device) => sum + device.durationMinutes / 60, 0))).toFixed(1) : "0.0"} kW</dd></div>
            <div><dt>Alapfogyasztás 48 órára</dt><dd>{(baseLoadKw * 48).toFixed(1)} kWh</dd></div>
          </dl>
          <p className="planner-caveat">Az akkumulátort a tervező jelenleg biztonsági tartalékként kezeli: nem ígéri oda előre a tárolt energiát. A konvektorok termosztátja és a mosógépprogram miatt a tényleges fogyasztás eltérhet, ezért minden érték szerkeszthető.</p>
          <button className="planner-reset" onClick={() => { setDevices(defaultDevices()); setBaseLoadKw(.25); setManualStarts({}); }}>Alapértékek visszaállítása</button>
        </aside>
      </div>
    </article>
  );
}
