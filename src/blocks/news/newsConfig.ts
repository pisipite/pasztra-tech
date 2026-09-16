import type { EnergyNewsCategory } from "../../types";

export type NewsView = "all" | "important";
export type CategoryFilter = "all" | EnergyNewsCategory;

export const INITIAL_NEWS_LIMIT = 8;
export const NEWS_LOAD_STEP = 6;

export const NEWS_VIEWS: { key: NewsView; label: string; description: string }[] = [
  {
    key: "all",
    label: "Összes",
    description: "Minden releváns energetikai cikk időrendben, a választott kategória és forrás szerint.",
  },
  {
    key: "important",
    label: "Neked fontos",
    description: "A bulgáriai hálózatot, háztartásokat, árakat, napelemeket, akkumulátorokat vagy áramszüneteket közvetlenül érintő hírek.",
  },
];

export const NEWS_CATEGORIES: { key: CategoryFilter; label: string; description: string }[] = [
  {
    key: "all",
    label: "Mind",
    description: "A napelemes, általános energetikai és megújuló témák együtt.",
  },
  {
    key: "solar",
    label: "Napelem",
    description: "Fotovoltaikus rendszerek, napelemparkok, háztartási panelek, támogatások és napelemes szabályozás.",
  },
  {
    key: "energy",
    label: "Energetika",
    description: "Villamosenergia-hálózat, piac és árak, szabályozás, erőművek, atom-, szén- és gázerőművi hírek.",
  },
  {
    key: "renewables",
    label: "Megújulók",
    description: "Szél- és vízenergia, energiatárolás, akkumulátorok, zöld átállás és más megújuló technológiák.",
  },
];

export const NEWS_CATEGORY_LABELS: Record<EnergyNewsCategory, string> = {
  solar: "Napelem",
  energy: "Energetika",
  renewables: "Megújulók",
};
