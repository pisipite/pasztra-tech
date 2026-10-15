// Source endpoints are kept here so an upstream change has one edit point.
export const BGNAP_BASE = "https://sipbg.gov.bg/bgnap/portal/api/catalog";
export const BDZ_DATASET_ID = "710c84db-9f73-46b2-9731-d0df793a6133";
export const BDZ_STATIC_SUBSET_ID = "28055fe4-d0da-4471-a1b9-13c434e6d5d9";
export const BDZ_VEHICLES_SUBSET_ID = "cddd12ef-5ae8-46a6-9afc-faeaafbc552d";
export const BDZ_VEHICLES_URL = `${BGNAP_BASE}/subsets/${BDZ_VEHICLES_SUBSET_ID}/realtime-download`;
export const ADSBDB_BASE = "https://api.adsbdb.com/v0/callsign";
export const MVR_BORDER_INDEX = "https://www.mvr.bg/press/актуална-информация/актуална-информация/актуално";
export const TOMTOM_INCIDENT_URL = "https://api.tomtom.com/maps/orbis/traffic/incidents/details";

// Each TomTom bbox stays below the endpoint's 10,000 km² limit.
export const ROAD_INCIDENT_BOXES = [
  [22.34, 42.0, 23.55, 42.67],
  [22.84, 41.74, 24.14, 42.2],
  [22.84, 41.29, 24.14, 41.75],
];

// Crossing coordinates are mapped locations, not measured queue positions.
export const BORDER_CROSSINGS = [
  { id: "gyueshevo", name: "Gyueshevo – Deve Bair", country: "north-macedonia", latitude: 42.21914, longitude: 22.46055, search: "Гюешево" },
  { id: "stanke-lisichkovo", name: "Stanke Lisichkovo – Delchevo", country: "north-macedonia", latitude: 41.986945, longitude: 22.876539, search: "Станке Лисичково" },
  { id: "zlatarevo", name: "Zlatarevo – Novo Selo", country: "north-macedonia", latitude: 41.39696, longitude: 22.9689, search: "Златарево" },
  { id: "kulata", name: "Kulata – Promachonas", country: "greece", latitude: 41.37926, longitude: 23.36438, search: "Кулата" },
  { id: "ilinden", name: "Ilinden – Exochi", country: "greece", latitude: 41.43681, longitude: 23.82636, search: "Илинден" },
];
