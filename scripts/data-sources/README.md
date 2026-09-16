# Külső adatforrások

Az URL-ek és a források metaadatai ebben a mappában vannak, külön a lekérő és
normalizáló kódtól.

- `endpoints.mjs`: ENTSO-E, Energy-Charts, Open-Meteo, Govee és Sungrow
  végpontok.
- `news-sources.mjs`: bolgár sajtó RSS-forrásai, honlapjai és faviconjai,
  valamint az ERM Zapad szolgáltatói oldal.
- A DeepL fordítási végpontjai az `endpoints.mjs` fájlban vannak; a fordító
  és annak publikus-hírfolyamos gyorsítótára a `news-translation.mjs` fájlban.

Forráscsere esetén először csak a megfelelő bejegyzést módosítsd. A kimeneti
JSON szerződését (`src/types.ts`) lehetőleg ne változtasd meg, így a felülethez
nem kell hozzányúlni. Új hírforráshoz stabil `id`, név, `feedUrl`, `homeUrl` és
`faviconUrl` szükséges. Ha az RSS túl rövid, opcionális `categoryUrl` is adható.

Az egyedi hitelesítő adatok továbbra is GitHub Secrets/Variables értékekből
érkeznek; ezek soha ne kerüljenek ebbe a mappába.
