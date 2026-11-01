// Madavi exposes archives by the chip ID; Sensor.Community's map/API IDs
// are different and must not be inferred from this number.
export const PERSONAL_SENSOR_SOURCE = Object.freeze({
  chipId: "esp8266-13753058",
  name: "SDS011 + BME280",
  archiveBase: "https://api-rrd.madavi.de/",
  retentionDays: 730,
  bucketMinutes: 10,
  maxArchivesPerRun: 16,
});
