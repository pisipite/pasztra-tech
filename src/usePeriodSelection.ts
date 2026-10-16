import { useState } from "react";
import { dateFromInput, dateInputValue, DAY_MS } from "./dateUtils";
import { addCalendarDays, addCalendarMonths } from "./timeZone";
import type { PeriodKey } from "./types";

type Selection = {
  period: PeriodKey;
  anchor: Date;
  customStart: string;
  customEnd: string;
};

export function usePeriodSelection() {
  const [selection, setSelection] = useState<Selection>(() => {
    const now = new Date();
    return {
      period: "day",
      anchor: now,
      customStart: dateInputValue(addCalendarDays(now, -6)),
      customEnd: dateInputValue(now),
    };
  });

  const selectPeriod = (period: PeriodKey) => setSelection((current) => ({ ...current, period, anchor: new Date() }));
  const setCustomRange = (customStart: string, customEnd: string) => setSelection((current) => ({ ...current, customStart, customEnd }));
  const step = (direction: -1 | 1, referenceAnchor?: Date) => setSelection((current) => {
    if (current.period === "custom") {
      const start = dateFromInput(current.customStart);
      const end = dateFromInput(current.customEnd);
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return current;
      const span = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1);
      return { ...current, customStart: dateInputValue(addCalendarDays(start, direction * span)), customEnd: dateInputValue(addCalendarDays(end, direction * span)) };
    }
    const previous = referenceAnchor ?? current.anchor;
    const anchor = current.period === "month" || current.period === "year"
      ? addCalendarMonths(previous, direction * (current.period === "year" ? 12 : 1))
      : addCalendarDays(previous, direction * (current.period === "week" ? 7 : 1));
    return { ...current, anchor };
  });

  return { ...selection, selectPeriod, setCustomRange, step };
}
