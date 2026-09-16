# Oldalblokkok

Az oldal felhasználói szakaszai külön mappákban vannak. Egy blokk felületét,
helyi segédfüggvényeit és mintaadatait ugyanabban a mappában kell tartani.

| Anchor | Mappa | Tartalom |
| --- | --- | --- |
| `#energia` | `energy-flow/` | Termelés és felhasználás grafikon |
| `#energiamix` | `bulgaria-energy/` | Országos energiamix és erőműtérkép |
| `#hirek` | `news/` | Bolgár energiahírek, szűrők és kártyák |
| `#elojelzes` | `forecast/` | Napelemes termelési előrejelzés |
| `#fogyasztasi-proba` | `planner/` | Interaktív fogyasztástervező |
| `#napallas` | `sun-position/` | Napállás és horizont |
| `#napelem`, `#klima` | `home-climate/` | Napelem- és Govee-kártyák |

A navigáció és a karbantartói blokklista a `src/config/pageBlocks.ts` fájlban
található. A blokkok publikus exportjait a `src/blocks/index.ts` gyűjti össze.

Az adatforrás-végpontokat nem a komponensekben kell átírni. A szerveroldali
forrásjegyzék a `scripts/data-sources/` mappában, a böngésző által betöltött
publikus adatfájlok nevei a `src/config/dataFiles.ts` fájlban vannak. A
`src/config/pageBlocks.ts` az oldalsorrendet, a navigációt és a karbantartói
blokklistát írja le.
