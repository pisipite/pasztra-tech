import { useState } from "react";
import { dateFromInput, dateInputValue, DAY_MS } from "./dateUtils";
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
      customStart: dateInputValue(new Date(now.getTime() - 6 * DAY_MS)),
      customEnd: dateInputValue(now),
    };
  });

  const selectPeriod = (period: PeriodKey) => setSelection((current) => ({ ...current, period, anchor: new Date() }));
  const setCustomRange = (customStart: string, customEnd: string) => setSelection((current) => ({ ...current, customStart, customEnd }));
  const step = (direction: -1 | 1, referenceAnchor?: Date) => setSelection((current) => {
    if (current.period === "custom") {
      const start = dateFromInput(current.customStart);
      const end = dateFromInput(current.customEnd);
      const span = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1);
      start.setDate(start.getDate() + direction * span);
      end.setDate(end.getDate() + direction * span);
      return { ...current, customStart: dateInputValue(start), customEnd: dateInputValue(end) };
    }
    const anchor = new Date(referenceAnchor ?? current.anchor);
    if (current.period === "day") anchor.setDate(anchor.getDate() + direction);
    if (current.period === "week") anchor.setDate(anchor.getDate() + direction * 7);
    if (current.period === "month") anchor.setMonth(anchor.getMonth() + direction);
    if (current.period === "year") anchor.setFullYear(anchor.getFullYear() + direction);
    return { ...current, anchor };
  });

  return { ...selection, selectPeriod, setCustomRange, step };
}
