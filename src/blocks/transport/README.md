# Közlekedés blokk

- `RegionalTransport.tsx`: Leaflet térkép, rétegek, adatfrissesség és forráslinkek.
- `transportData.ts`: publikus JSON-szerződés, forráslinkek és állapotjelzések.
- `transport.css`: poszterstílus, mobilnézet és sötét mód.
- `public/data/transport-oblasts.geojson`: egyszerűsített, valódi OSM megyehatárok.
- `public/data/transport-railways.geojson`: a BDZ hivatalos GTFS-alakzataiból szűrt vasútvonalak és állomások.
- `public/data/transport-live.json`: OpenSky/BDZ/TomTom/MVR-pillanatkép, ADSBDB járatútvonalak.
- `scripts/transport-roads.mjs`: TomTom-események és MVR-határjelentések feldolgozása.
- `scripts/transport-sources.mjs`: cserélhető végpontok, lekérési területek és határátkelők.
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
Az indulási és érkezési repülőteret az ADSBDB járatszám alapján azonosítja,
de csak akkor jeleníti meg, ha az útvonal összeegyeztethető a mért pozícióval
és haladási iránnyal. A nem igazolható járatot kifejezetten jelzi. A múltbeli útvonal csak a helyi
gyűjtő által mért pontokból épül, tehát új indítás után kezdetben rövid.
A szaggatott jövőbeli szakasz az aktuális haladási irányba vetített becslés;
irányadat hiányában csak igazolt célállomás esetén rajzolódik. Nem hivatalos repülési terv.

A vasútvonalakat a bolgár NAP [BDZ-katalógusából](https://sipbg.gov.bg/bgnap/portal/bg/catalog/710c84db-9f73-46b2-9731-d0df793a6133)
letöltött GTFS Static `shapes.txt` alapján állítjuk elő. Csak azokat a
vonalakat ábrázoljuk, amelyeken a BDZ menetrendi állománya közlekedést jelöl;
ez nem a teljes fizikai pályahálózat. Újragenerálás: `npm run transport:railways`.
Az élő vonatpozíció ugyanennek a katalógusnak a nyilvános GTFS-RT
Vehicle Positions adatfolyamából jön.
A vonat „honnan → hová” felirata a hivatalos GTFS `stop_times.txt` első és
utolsó állomásából származik. Ha a menetrendben nem található a járatazonosító,
az oldal „Útvonal nem ismert” feliratot mutat, nem becsült állomásokat.

Az öt környékbeli határátkelő státusza a [bolgár belügyminisztérium](https://www.mvr.bg/press/актуална-информация/актуална-информация/актуално)
legutóbbi szöveges jelentéséből származik. Ez általában határszintű minősítés,
nem átkelőnként mért várakozási idő; ezért a közlés dátumát is megmutatjuk.
Az adatgyűjtő legfeljebb óránként ellenőrzi a jelentést.

A torlódás, baleset, lezárás és útépítés a [TomTom Traffic Incident Details](https://docs.tomtom.com/traffic-api/documentation/tomtom-orbis-maps/v2/traffic-incidents/incident-details)
API-ból jöhet. Ehhez szerveroldali `TOMTOM_API_KEY` környezeti változó kell;
GitHubon az azonos nevű Actions secret. Kulcs nélkül a réteg nem mutat
eseményt és nem állítja azt, hogy az utak zavartalanok. A három lekérési
téglalap mind kisebb 10 000 km²-nél, a kapott eseményeket a két megyére
szűrjük. A kulcs nem kerül a publikált oldalba; két lekérés között legalább
10 perc telik el.

A megyehatárok egyszeri újragenerálása: `node scripts/transport-boundaries.mjs`.
Forrás: OpenStreetMap/Nominatim (ODbL). Ezt a parancsot nem szabad a látogatók
böngészőjében vagy gyakori automatikus feladatként futtatni.
Az alapcsempét OSM France szolgálja ki, látható OpenStreetMap/OSM France
forrásmegjelöléssel. A központi OSM-csempék a helyi előnézetben blokkolva voltak.

A GitHub Pages workflow a többi adatfrissítés után futtatja a közlekedési
gyűjtőt. A korábbi publikált pillanatképet visszaolvassa, hogy a repülőnyom
és a frissítési idő ne vesszen el két build között.

A blokk frissítőgombja a publikált oldalon a közös GitHub Actions-adatfrissítést
indítja. A helyi Vite-előnézetben közvetlenül az aktuális közlekedési forrásokat
kéri le a fejlesztői szerveren keresztül, GitHub-futás nélkül. A TomTom-kulcs
helyi próbához a `TOMTOM_API_KEY` környezeti változóban, publikáláshoz a
GitHub Actions azonos nevű secretjében legyen; ne kerüljön a böngészőbe vagy
a verziókezelt fájlokba.
