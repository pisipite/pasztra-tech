# Közlekedés blokk – első helyi változat

- `RegionalTransport.tsx`: Leaflet térkép, rétegek, adatfrissesség és forráslinkek.
- `transportData.ts`: publikus JSON-szerződés, forráslinkek és állapotjelzések.
- `transport.css`: poszterstílus, mobilnézet és sötét mód.
- `public/data/transport-oblasts.geojson`: egyszerűsített, valódi OSM megyehatárok.
- `public/data/transport-railways.geojson`: a BDZ hivatalos GTFS-alakzataiból szűrt vasútvonalak és állomások.
- `public/data/transport-live.json`: helyben generált OpenSky/BDZ-pillanatkép, ADSBDB járatútvonalak.
- `.data-history/transport-timetable.json`: naponta ellenőrzött BDZ-menetrendi gyorsítótár; az élő járatazonosítót az induló- és végállomáshoz kapcsolja.

Helyi futtatás két terminálban:

```sh
npm install
npm run transport:watch
```

```sh
npm run dev -- --host 127.0.0.1
```

Az adatgyűjtő ötpercenként kéri le az OpenSky pozíciókat (legfeljebb 25
négyzetfok, 1 kredit/lekérés) és a bolgár NAP hivatalos BDZ GTFS-RT
járműpozícióit. A böngésző percenként ellenőrzi a pillanatképet. Ha egy
forrás elérhetetlen, a korábbi pozíció csak „korábbi adat” jelzéssel marad.
Az indulási és érkezési repülőteret az ADSBDB járatszám alapján azonosítja;
ismeretlen járatnál ezt kifejezetten jelzi. A múltbeli útvonal csak a helyi
gyűjtő által mért pontokból épül, tehát új indítás után kezdetben rövid.
A szaggatott jövőbeli szakasz a célállomás felé, ennek hiányában az aktuális
irányba vetített becslés, nem hivatalos repülési terv.

A vasútvonalakat a bolgár NAP [BDZ-katalógusából](https://sipbg.gov.bg/bgnap/portal/bg/catalog/710c84db-9f73-46b2-9731-d0df793a6133)
letöltött GTFS Static `shapes.txt` alapján állítjuk elő. Csak azokat a
vonalakat ábrázoljuk, amelyeken a BDZ menetrendi állománya közlekedést jelöl;
ez nem a teljes fizikai pályahálózat. Újragenerálás: `npm run transport:railways`.
Az élő vonatpozíció ugyanennek a katalógusnak a nyilvános GTFS-RT
Vehicle Positions adatfolyamából jön. Közúti forgalmi feed még nincs bekötve.
A vonat „honnan → hová” felirata a hivatalos GTFS `stop_times.txt` első és
utolsó állomásából származik. Ha a menetrendben nem található a járatazonosító,
az oldal „Útvonal nem ismert” feliratot mutat, nem becsült állomásokat.

A megyehatárok egyszeri újragenerálása: `node scripts/transport-boundaries.mjs`.
Forrás: OpenStreetMap/Nominatim (ODbL). Ezt a parancsot nem szabad a látogatók
böngészőjében vagy gyakori automatikus feladatként futtatni.
Az alapcsempét OSM France szolgálja ki, látható OpenStreetMap/OSM France
forrásmegjelöléssel. A központi OSM-csempék a helyi előnézetben blokkolva voltak.

A GitHub Pages-re kerülő változathoz az adatgyűjtőt szerveroldali ütemezéssel
kell futtatni; a böngésző önmagában nem tudja frissíteni az OpenSky/BDZ adatokat.
