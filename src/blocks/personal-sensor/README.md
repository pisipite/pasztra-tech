# Saját szenzor

- A készülék azonosítója és az archívum beállításai: `scripts/data-sources/personal-sensor-source.mjs`.
- A gyűjtő: `scripts/personal-sensor.mjs`; a Madavi nyilvános, chipazonosító szerinti CSV- és havi ZIP-fájljait olvassa. A Sensor.Community térképes API-azonosítója ettől eltérhet.
- A helyi Vite szerver induláskor és ötpercenként gyűjt; a blokk frissítésgombja külön is elindíthatja. A teljes adatfrissítő folyamat szintén meghívja a gyűjtőt.
- Az előzmény `.data-history/personal-sensor.json`, a böngészős pillanatkép `public/data/personal-sensor.json`; mindkettő generált adat. A megtartás legfeljebb 730 nap.
- A `Time` mező UTC; a megjelenítés bolgár idő. A BME280 nyomásértéke Pa-ról hPa-ra váltva, tengerszinti korrekció nélkül jelenik meg.
- Minden 10 perces idősávban az egyes mérőszámok legutóbbi valódi értéke és külön mérési időpontja marad meg. Hosszabb nézetben csak a meglévő mintákból készül átlag; az adathiány nem nulla.
- Másik chip beállításakor a korábbi chiphez tartozó gyorsítótárat nem keverjük az új mérésekhez.
- A PM-határértékek és forrásaik a `particulateReference.ts` fájlban vannak; az irányelv szerinti 2030-as váltás a mérési nap évét követi. A PM2,5 és PM10 napi becslése külön-külön, kizárólag lezárt bolgár naptári napból, legalább 75% 10 perces lefedettséggel készül. A PM2,5 napi összevetése WHO-ajánláshoz történik, nem jogszabályi határértékhez. A 23 és 25 órás napokat kezeli; a saját szenzorral végzett összevetés nem hatósági minősítés.
