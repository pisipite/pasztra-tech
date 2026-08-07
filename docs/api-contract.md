# Adatkapcsolat

A GitHub Pages statikus, nyilvános tárhely. Sungrow- és Govee API-kulcsot ezért nem szabad sem a forráskódba, sem a `config.js` fájlba írni. A mellékelt GitHub Actions munkafolyamat a titkos értékeket GitHub Secretsből olvassa, és csak a megjelenítéshez szükséges normalizált adatot teszi közzé.

## Beállítás

A `scripts/fetch-live-data.mjs` három statikus adatfájlt készít: `dashboard-today.json`, `dashboard-7d.json` és `dashboard-30d.json`. Sikeres élő lekéréskor a build ideiglenesen élő módra állítja a `config.js` fájlt. Ugyanez egy saját külső végponttal a felületen, a jobb felső menüből is beállítható.

A dashboard a végpontot így hívja:

```text
GET ./data/dashboard-today.json
```

A `range` értéke `today`, `7d` vagy `30d`.

## Válaszformátum

```json
{
  "updatedAt": "2026-08-07T12:00:00.000Z",
  "solar": {
    "status": "online",
    "currentPowerKw": 4.82,
    "todayKwh": 24.7,
    "monthKwh": 428,
    "lifetimeMwh": 18.6,
    "selfConsumptionPct": 73,
    "co2SavedKg": 11.3,
    "houseLoadKw": 2.16,
    "gridPowerKw": -2.66,
    "chart": [{ "label": "12", "value": 4.5 }]
  },
  "govee": {
    "devices": [{
      "id": "living-room",
      "name": "Govee H5179",
      "room": "Nappali",
      "temperatureC": 23.4,
      "humidityPct": 48,
      "batteryPct": 86,
      "updatedAt": "2026-08-07T11:58:00.000Z"
    }],
    "chart": [{ "label": "12", "temperature": 23.4, "humidity": 48 }]
  }
}
```

Negatív `gridPowerKw` esetén a rendszer a hálózatba táplál, pozitív értéknél a hálózatból vételez.
