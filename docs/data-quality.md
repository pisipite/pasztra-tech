# Adathiány, időbélyegek és becslések

- A hiányzó numerikus adat nem nulla. A megjelenítés `Number.isFinite` ellenőrzést használ; a hiányzó hálózati vagy akkumulátoros sorból nem állít elő PV-forrásmegoszlást.
- A napi mért görbék legfeljebb a lekérdezés és a jelen időpont közül a korábbiig jelenhetnek meg. A jövőbeli megfigyelési helyek üresek. Az előrejelzés és a szimuláció ettől különbözik: ezek jelölt becslések.
- A görbéket mérési hézagnál megszakítjuk. Energia és tényleges PV: 15 perc; klíma: 30 perc; országos energiamix: a megadott mintaköz másfélszerese. A napi vízszintes tengely továbbra is a teljes bolgár naptári napot mutatja.
- A 0 °C és a negatív hőmérséklet érvényes. A régi 0 °C / 0% kimaradási mintapár nem kerül átlagba, minimumba vagy maximumba.
- A lekérdezési idő nem mérési idő. Ha a forrás nem közöl mérési időbélyeget, ezt feliratozzuk; a Govee jelenleg szenzorlekérdezési időt ad.
- A hivatalos napi/havi energiaszámlálók elsőbbséget élveznek. Teljesítményből csak szomszédos, ismert intervallumokat integrálunk; résznapot nem nyújtunk 24 órára. Hiányos becsült számláló kimarad.
- A tervező legfeljebb 45 perces, nem jövőbeli SOC-mintát használ. Ennek hiányában a beállított kezdőtöltöttséget feltételezésként írja ki. Az eredmény mellett szerepel az alapfogyasztás, kapacitás, tartalék, hatásfok és üresjárati veszteség is.

## Hol módosítható?

| Feladat | Fájl |
| --- | --- |
| Klímaminta érvényessége, gyűjtő és felület közös szabálya | `shared/climateValidity.mjs` |
| Megfigyelési időhatár, vonalszegmensek, SOC-frissesség | `src/observationQuality.ts` |
| Lekérdezési és mérési idő megjelenítése | `src/components/DataFreshness.tsx` |
| Házfogyasztás forrásbontásának ellenőrzése | `src/blocks/bulgaria-energy/householdSummary.ts` |
| Sungrow integrálás és cache-sémaverzió | `scripts/sungrow-power.mjs` |
| Regressziós tesztek | `tests/observation-quality.test.mjs`, `tests/time-zone.test.mjs` |

A 4-es Sungrow flow-séma újragyűjtésre jelöli a régi napi cache-t a normál adatgyűjtési folyamatban. A javítás nem talál ki utólag elveszett méréseket; a forrás által már számmá alakított hiányt csak forrásoldali minőségi jelzés alapján lehet biztosan azonosítani.
