# Adatkapcsolat

A GitHub Pages statikus, nyilvános tárhely. Sungrow- és Govee API-kulcsot ezért nem szabad sem a forráskódba, sem a `config.js` fájlba írni. A mellékelt GitHub Actions munkafolyamat a titkos értékeket GitHub Secretsből olvassa, és csak a megjelenítéshez szükséges normalizált adatot teszi közzé.

## Beállítás

A `scripts/fetch-live-data.mjs` négy statikus adatfájlt készít: `dashboard-today.json`, `dashboard-7d.json`, `dashboard-30d.json` és `dashboard-year.json`. Sikeres élő lekéréskor a build ideiglenesen élő módra állítja a `config.js` fájlt. Ugyanez egy saját külső végponttal a felületen, a jobb felső menüből is beállítható.

A dashboard például így kéri le a napi adatot:

```text
GET ./data/dashboard-today.json
```

A `range` értéke `today`, `7d`, `30d` vagy `year`. A frontend az aktív napot, hetet, hónapot, évet vagy egyedi intervallumot dátum alapján szűri az `energyChart` idősorából.

## Govee mérési előzmények

A 15 percenként futó munkafolyamat minden Govee-mérést időbélyeggel hozzáfűz a `.data-history/govee-history.json` előzményhez. A fájlt a GitHub Actions gyorsítótára őrzi meg a futások között, a legutóbbi Pages-kiadásban található `data/govee-history.json` pedig tartalék visszaállítási forrás. Az előzmény legfeljebb 370 napot tart meg.

A napi grafikon az időbélyeges méréseket, a heti és havi grafikon a napi átlagokat, az éves grafikon pedig a havi átlagokat használja. Mivel a Govee API aktuális állapotot ad vissza, a történeti vonal a funkció bekapcsolása utáni mérésekből épül fel.

## Válaszformátum

```json
{
  "updatedAt": "2026-08-07T12:00:00.000Z",
  "solar": {
    "status": "online",
    "currentPowerKw": 4.82,
    "batteryTemperatureC": 26.4,
    "batteryVoltageV": 391.8,
    "todayKwh": 24.7,
    "monthKwh": 428,
    "lifetimeMwh": 18.6,
    "selfConsumptionPct": 73,
    "co2SavedKg": 11.3,
    "houseLoadKw": 2.16,
    "gridPowerKw": -2.66,
    "chart": [{ "label": "12:00", "value": 4.5 }],
    "energyChart": [{
      "label": "12:00",
      "timestamp": "2026-08-07T12:00:00.000Z",
      "pv": 4.5,
      "grid": -2.3,
      "battery": 0,
      "load": 2.2,
      "batterySoc": 84,
      "temperature": 23.4,
      "humidity": 48
    }]
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
    "chart": [{
      "label": "12:00",
      "timestamp": "2026-08-07T12:00:00.000Z",
      "temperature": 23.4,
      "humidity": 48
    }]
  }
}
```

Negatív `gridPowerKw` esetén a rendszer a hálózatba táplál, pozitív értéknél a hálózatból vételez. A `batteryTemperatureC`, `batteryVoltageV`, `battery`, `batterySoc`, `temperature` és `humidity` mezők opcionálisak; a frontend csak akkor jeleníti meg őket, ha érkezett hozzájuk adat.
