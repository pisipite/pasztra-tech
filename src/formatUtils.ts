const timeFormatter = new Intl.DateTimeFormat("hu-HU", { hour: "2-digit", minute: "2-digit" });
const headingDateFormatter = new Intl.DateTimeFormat("hu-HU", { weekday: "long", month: "long", day: "numeric" });

export const formatTime = (value: string) => timeFormatter.format(new Date(value));
export const formatHeadingDate = (value = new Date()) => headingDateFormatter.format(value);

