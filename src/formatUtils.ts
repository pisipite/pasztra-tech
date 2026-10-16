import { dateTimeFormatter } from "./timeZone";

const timeFormatter = dateTimeFormatter({ hour: "2-digit", minute: "2-digit" });
const headingDateFormatter = dateTimeFormatter({ weekday: "long", month: "long", day: "numeric" });

export const formatTime = (value: string) => timeFormatter.format(new Date(value));
export const formatHeadingDate = (value = new Date()) => headingDateFormatter.format(value);

export function formatNumber(value: number, maximumFractionDigits = 2, minimumFractionDigits = 0) {
  return value.toLocaleString("hu-HU", { minimumFractionDigits, maximumFractionDigits });
}

export function formatFixedNumber(value: number, fractionDigits = 0) {
  return formatNumber(value, fractionDigits, fractionDigits);
}

