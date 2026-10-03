// Public, outdoor citizen-science measurements. P1 = PM10; P2 = PM2.5,
// both in µg/m³. Sensor coordinates can be intentionally approximate.
export const AIR_QUALITY_SOURCE = Object.freeze({
  name: "Sensor.Community",
  website: "https://sensor.community/",
  apiUrl: "https://data.sensor.community/airrohr/v1/filter/box=41.83,22.97,42.43,23.8",
  archiveUrl: "https://archive.sensor.community/",
  documentationUrl: "https://github.com/opendata-stuttgart/meta/wiki/APIs",
  retentionDays: 370,
  samplingIntervalMinutes: 20,
  initialArchiveDays: 7,
  bounds: { south: 41.83, north: 42.43, west: 22.97, east: 23.8 },
});

// These centers label the nearest settlement; they are not measuring sites.
export const AIR_QUALITY_TOWNS = Object.freeze([
  { id: "dupnitsa", name: "Dupnica", latitude: 42.265, longitude: 23.117 },
  { id: "blagoevgrad", name: "Blagoevgrad", latitude: 42.011, longitude: 23.098 },
  { id: "sapareva-banya", name: "Szapareva banja", latitude: 42.289, longitude: 23.263 },
  { id: "samokov", name: "Szamokov", latitude: 42.337, longitude: 23.553 },
  { id: "rila", name: "Rila", latitude: 42.134, longitude: 23.133 },
  { id: "borovets", name: "Borovec", latitude: 42.266, longitude: 23.607 },
  { id: "belitsa", name: "Belica", latitude: 41.954, longitude: 23.560 },
  { id: "razlog", name: "Razlog", latitude: 41.886, longitude: 23.467 },
  { id: "bansko", name: "Bansko", latitude: 41.836, longitude: 23.489 },
  { id: "dolna-banya", name: "Dolna banja", latitude: 42.310, longitude: 23.764 },
  { id: "pchelin", name: "Pcselin", latitude: 42.384, longitude: 23.782 },
  { id: "shiroki-dol", name: "Siroki dol", latitude: 42.425, longitude: 23.522 },
]);
