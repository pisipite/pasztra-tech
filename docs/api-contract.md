# Adatkapcsolat

A GitHub Pages statikus, nyilvános tárhely. Sungrow- és Govee API-kulcsot ezért nem szabad sem a forráskódba, sem a `config.js` fájlba írni. A mellékelt GitHub Actions munkafolyamat a titkos értékeket GitHub Secretsből olvassa, és csak a megjelenítéshez szükséges normalizált adatot teszi közzé.

## Beállítás

A `scripts/fetch-live-data.mjs` elkészíti a négy dashboard-fájlt (`dashboard-today.json`, `dashboard-7d.json`, `dashboard-30d.json`, `dashboard-year.json`) és a különálló kiegészítő adatfájlokat, köztük az `energy-news.json` hírfolyamot. Sikeres élő lekéréskor a build ideiglenesen élő módra állítja a `config.js` fájlt. Ugyanez egy saját külső végponttal a felületen, a jobb felső menüből is beállítható.

A dashboard például így kéri le a napi adatot:

```text
GET ./data/dashboard-today.json
```

A `range` értéke `today`, `7d`, `30d` vagy `year`. A frontend az aktív napot, hetet, hónapot, évet vagy egyedi intervallumot dátum alapján szűri az `energyChart` idősorából.

## Sungrow teljesítmény és napi gyorsítótár

A `scripts/sungrow-power.mjs` a forrás által megadott mértékegységből alakít
kW-ra. Nincs értéknagyságon alapuló egységbecslés: 80 W mindig 0,08 kW,
80 kW viszont 80 kW marad. A PV/fogyasztás görbéknél a `getPowerStationData`
`p83033_unit` / `p83106_unit` mezője az irányadó.

A hálózati és akkumulátor-méréseket a `getDevicePointMinuteDataList` végpontból
kérjük, amely minden értékhez mértékegységet is ad. A korábbi
`queryMutiPointDataList` puszta számaihoz sem a napi maximum, sem az aktuális
eszköz kijelzési egysége nem biztonságos átváltási alap. Hiányzó/ismeretlen
teljesítményegységnél hibát jelzünk, nem találunk ki értéket.

A `.data-history/sungrow-days` napi gyorsítótár verziója `flowSchema: 3`.
A régi verziót a következő sikeres adatgyűjtés újrakéri az eredeti forrásból
(alapértelmezésben az utolsó 31 napot, így az október 19–20-i görbéket is).
A részletes mérés naponta kerül lekérésre, nem az éves, órás sorból készül.
A frissítés egyszeri visszatöltése több lekérést igényel; utána a már
újragenerált lezárt napok ismét használhatók a gyorsítótárból.
Sikertelen részletes lekérés nem rögzít véglegesen hiányos új napi gyorsítótárat.

Helyi ellenőrzés: `node --test tests/sungrow-power.test.mjs`.
Valós adatok újragyűjtéséhez a GoSungrow kliens és a meglévő Sungrow
hozzáférési beállítások szükségesek. A javítás GitHubra feltöltése önmagában
nem írja át a már publikált JSON-fájlokat: sikeres adatgyűjtés és közzététel is kell.

## Govee mérési előzmények

A 20 percenként ütemezett munkafolyamat minden Govee-mérést időbélyeggel hozzáfűz a `.data-history/govee-history.json` előzményhez. A fájlt a GitHub Actions gyorsítótára őrzi meg a futások között; mentése az összeállítás és közzététel előtt történik. A legutóbbi Pages-kiadásban található `data/govee-history.json` tartalék visszaállítási forrás. Az előzmény legfeljebb 370 napot tart meg.

A napi grafikon az időbélyeges méréseket, a heti és havi grafikon a napi átlagokat, az éves grafikon pedig a havi átlagokat használja. Mivel a Govee API aktuális állapotot ad vissza, a történeti vonal a funkció bekapcsolása utáni mérésekből épül fel.

## Válaszformátum

Az `updatedAt` és a `connections.*.updatedAt` a rendelkezésre álló adat idejét
jelöli. A `refreshedAt` az új adatgyűjtési kísérlet azonosítására szolgál akkor
is, ha egy vagy több adatforrás nem válaszolt. Ilyenkor a `warnings` lista
forrásnevet, üzenetet és az utolsó adat idejét tartalmazza; a megtartott
kapcsolat `connected: false, stale: true`. A mérési idősorokat nem nullázzuk le.
A cikkfordítás csak az `energy-news.json` fájlt módosítja, és saját
`translation.updatedAt` időbélyeget kap; nem változtatja a hírek gyűjtési idejét.

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
