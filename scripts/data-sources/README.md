# Külső adatforrások

Az URL-ek és a források metaadatai ebben a mappában vannak, külön a lekérő és
normalizáló kódtól.

- `endpoints.mjs`: ENTSO-E, Energy-Charts, Open-Meteo, Govee és Sungrow
  végpontok.
- `news-sources.mjs`: bolgár sajtó RSS-forrásai, honlapjai és faviconjai,
  valamint az ERM Zapad szolgáltatói oldal.
- `air-quality-sources.mjs`: a Rila környéki Sensor.Community kültéri PM2,5/PM10
  mérések és napi CSV-archívumuk. A gyűjtő 7 napot visszatölt, majd 370 napig
  őrzi a mintákat, 20 perces idősávonként egy tényleges mérés megtartásával.
  A mentés a közös `.data-history` gyorsítótárban él; helyreállítási forrása
  az `AIR_QUALITY_HISTORY_URL`. A publikus kimenet `air-quality.json`.
- A Google Gemini fordítási végpontja az `endpoints.mjs` fájlban van; a fordító
  és annak publikus-hírfolyamos gyorsítótára a `news-translation.mjs` fájlban.

Forráscsere esetén először csak a megfelelő bejegyzést módosítsd. A kimeneti
JSON szerződését (`src/types.ts`) lehetőleg ne változtasd meg, így a felülethez
nem kell hozzányúlni. Új hírforráshoz stabil `id`, név, `feedUrl`, `homeUrl` és
`faviconUrl` szükséges. Ha az RSS túl rövid, opcionális `categoryUrl` is adható.

Az egyedi hitelesítő adatok továbbra is GitHub Secrets/Variables értékekből
érkeznek; ezek soha ne kerüljenek ebbe a mappába.
