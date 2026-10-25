import { dateTimeFormatter } from "../timeZone";

const timestamp = dateTimeFormatter({ month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
export function DataFreshness({ collectedAt, observedAt, observationLabel = "Utolsó minta", showObservation = true, note }: {
  collectedAt?: string; observedAt?: string; observationLabel?: string; showObservation?: boolean; note?: string;
}) {
  const format = (value?: string) => value && Number.isFinite(Date.parse(value)) ? timestamp.format(new Date(value)) : "nem ismert";
  return <p className="data-freshness"><span>Lekérdezés: {format(collectedAt)}</span>{showObservation && <span>{observationLabel}: {format(observedAt)}</span>}{note && <span>{note}</span>}<span>bolgár idő</span></p>;
}
