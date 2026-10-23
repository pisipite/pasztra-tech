# Pasztra — vizuális audit és megvalósítási útmutató

2026. október 22. • Helyi változat, publikálás nélkül.

## Kreatív irány

**Hegyoldali megfigyelőállomás, nem egymás alá ragasztott poszterek.**
A saját ház illusztrációja és a bolgár turisztikai plakátok színvilága megkülönböztethető, személyes alap. Ezt érdemes megtartani. A prémium érzetet itt nem további díszítés, hanem a nyugodt adatfelületek, az olvasható részletek és a következetes kezelőszervek adják.

A filmes hangulat a nyitókép feladata: nagy, zavartalan képfelület, finom sötétítés, kevés szöveg. A grafikonok feladata ezzel szemben a pontosság és összehasonlíthatóság. Nem kapnak parallaxist, belépő animációt vagy folyamatos dekoratív mozgást.

## Megfigyelési alap

- Az éles oldal asztali, sötét nyitóképernyője; a helyi verzió energia-, klíma- és hírblokkjának megjelenése világos/sötét témában, valamint mobilos nézetek.
- A blokkkomponensek, közös és blokkspecifikus stílusok áttekintése. Az alábbi kódalapú észrevételek nem jelentenek minden lehetséges adatállapotra kiterjedő vizuális tesztet.
- A helyi előnézet mintaadatokat használ. Az adatpontosság, az élő szolgáltatások elérhetősége és a fordítási munkafolyamat nem része ennek a módosításnak.

## Rangsorolt javítások

Hatás: 1 = apró finomítás, 5 = az összképet alapvetően meghatározza. P1 = első kör, P2 = következő kör. Az állapot csak az itt leírt konkrét változtatásra vonatkozik.

| Prioritás | Hatás | Probléma és következmény | Pontos megvalósítás | Állapot |
|---|---:|---|---|---|
| P1 | 5 | A 68 px-ig növő, csupa nagybetűs címek és erős keretek versenyeznek az adatokkal. Minden blokk egyforma hangerőn szól. | Fő blokkcím 29–44 px, mobilon 28–38 px; 1,12 sorköz. Kicker 11 px. A címen belül ne legyen újabb kiemelés. Egységes fejléc 24 px alsó térközzel. | Elkészült |
| P1 | 5 | Pontozott papír, ragasztószalagok, szabálytalan sarkok, többféle keret és eltolásos árnyék együtt kézműves sablonhatást keltenek. | A textúra maradjon az illusztrációban; adatkártyák egyszínűek. 1 px szegély, 12 px külső/9 px belső sarok, nagyon enyhe árnyék. A dekoratív ragasztószalag és mix-napkorong elhagyása. | Elkészült a fő blokkokon |
| P1 | 5 | A plakátbetű a menüben, hírben és apró vezérlőben is szerepel; a 9–11 px-es címkék nehezen olvashatók. | Oswald a blokkcímeknek, Manrope a kezelőfelületnek és hírcímeknek. Menüpont 12 px, vezérlő 12 px, hír 18–23 px/1,4; ajánló 14 px/1,7. Jelmagyarázat 12 px. | Elkészült a közös elemekben és hírekben |
| P1 | 4 | A blokkok eltérő margója és belső térköze hosszú, ritmustalan oldalt ad. | Tartalom max. 1440 px; kártyán belül 20–40 px; blokkok között 24–44 px. Mobilon az oldal szélein 16 px. Azonos fejléc- és dátumszűrő-logika. | Elkészült |
| P1 | 4 | A nyitóképet vastag dupla keret, hatalmas csupa nagybetűs köszöntés és azonnal következő figyelmeztetősáv töri meg. | Keret nélküli, 340–510 px magas képfelület. A köszöntés eredeti írásmódja: „Привет!”. Balról finom sötétítés, világos szöveg. A figyelmeztetés külön, nyugodt felületen, színes bal szegéllyel; a szöveg megmarad. | Elkészült |
| P1 | 4 | Az érintési célok és billentyűzetes fókuszok következetlenek. | Fő vezérlők 40 px minimum, mobilmenü és tetejére gomb 44 px. Kontrasztos 3 px fókuszgyűrű; első tabulátorral elérhető tartalomra ugrás. | Elkészült a közös vezérlőkön |
| P1 | 3 | A hosszú oldalon a navigáció nem jelzi, melyik szakaszt olvassuk. | Görgetés és átméretezés alapján aktív menüpont, `aria-current="location"`; mobilon Escape után fókusz a menügombra. Az ellenőrzés képkockánként legfeljebb egyszer fut, adatot nem kér le. | Elkészült, külön tesztekkel |
| P1 | 4 | Egyes sötét témás állapotfeliratok sötét szövegszínt örökölnek. | A hírek állapotfeliratainak és forrásállapotának közös, témához kötött szövegszín; 11–12 px méret. Ne pusztán egy színes pont közöljön állapotot. | Szín és méret javítva; meglévő szövegek megmaradtak |
| P2 | 4 | Mobilon a hosszú grafikonok egy része csak vízszintes görgetéssel olvasható. Ez most jobb, mint az olvashatatlan lekicsinyítés, de nem végleges megoldás. | Blokkonként külön mobilgrafikon: 4–6 időcímke, legalább 12 px tényleges feliratméret, érintéssel rögzíthető adatbuborék, billentyűzettel elérhető adatok. A chart-számítások változtatása nélkül, külön tesztekkel. | Következő kör; nem alakítottam át az adatszerkezetet |
| P2 | 4 | Sok szekcióból álló oldalon nem elég egy nyitókép: az „otthon → környék → ország” történet nem mindig érzékelhető. | Későbbi tartalmi körben egy kompakt, valós adatokból dolgozó napi összefoglaló; hiba esetén ne állítsa, hogy minden rendben. A meglévő blokkok sorrendjét most nem változtatjuk. | Javaslat, tartalmi jóváhagyást igényel |
| P2 | 3 | A hírek apró, összetett metaadatai és sűrű címsorai amatőr szerkesztési hatást adnak. | Egységes kártya, nincs elforgatás; nagyobb sorköz, jól elkülönülő forrás/dátum, olvasható fordítás- és megnyitásgomb. A kiemelt cikk maradjon hangsúlyos, ne minden kártya. | Elkészült |
| P2 | 3 | A különböző hoverek és mozgások nem képeznek rendszert; a tetejére gomb kényszerített sima görgetést indít. | Szín- és háttérátmenet 160 ms. Nincs kártyabillentés. Reduced-motion esetén minimális átmenet és azonnali visszagörgetés. Adatfrissülés ne animálja újra az egész oldalt. | Közös átmenetek és visszagörgetés elkészültek |
| P2 | 3 | Az eltérő világos/sötét paletteszemantika és hasonló energiaszínek megnehezíthetik a felismerést. | Következő körben a meglévő megújuló/nem megújuló színlogikával együtt felülvizsgálni; szín mellett vonalminta és felirat is különböztessen. Ne változzon a sorok jelentése téma váltásakor. | A szemantikus színrendszert most megőriztem |
| P2 | 3 | Nagy fő JavaScript-csomag és sok történeti CSS-felülírás növeli a karbantartás és betöltés költségét. | Következő kör: Leaflet/térkép betöltése csak szükség esetén; a közös vizuális szerződés beolvasztása rétegenként az eredeti stílusokba. Mérni előtte/utána; vak tömeges CSS-törlés kerülendő. | Dokumentált technikai tartozás |
| P2 | 2 | Kép- és fontbetöltés optimalizálható, de az illusztráció cseréje elveszítené az oldal karakterét. | Meglévő képekből később többméretű WebP/AVIF, PNG tartalék; mobilon tudatos képkivágás. Betűk saját kiszolgálása a licencek ellenőrzése után. Ne készüljön új generált kép csak a változtatás kedvéért. | Javaslat |

## Kód: hol mit kell módosítani?

- `src/design-system.css`: a közös vizuális szerződés. Az elején a nappali/éjszakai színek és méretek; utána az oldalkeret, a fejléc, a vezérlők, a másodlagos felületek, majd a mobil- és mozgásszabályok. Ezt a `main.tsx` a korábbi stílusok után importálja.
- `src/main.tsx`: új stílusimport, billentyűzetes tartalomra ugró link és aktív navigációjelzés. Az adatfrissítés, a fordítássor és a blokkok sorrendje változatlan.
- `src/useActiveSection.ts`, `src/activeSection.ts`: a látható szakasz meghatározása; a számítás tesztjei a `tests/active-section.test.mjs` fájlban.
- `src/components/BackToTop.tsx`: a felhasználó csökkentett mozgás beállításának tiszteletben tartása.
- `src/theme.css`: továbbra is a diagramok szemantikus színeinek forrása. A mostani fájl nem módosítja a sorok jelentését.
- `src/blocks/*`: a blokkok belső tartalma és működése változatlan. A közös megjelenést ne kezdjük újra blokkonként más számokkal felülírni.

Az új stílusfájl szándékos, központi átmeneti réteg, nem teljes CSS-refaktor. A régi stílusok eltávolítása külön, állapotonként ellenőrzött munka. Új függőség és új képfájl nem került a weboldalhoz.

## Elfogadási és ellenőrzési lista

- Azonos címméret, külső keret és térköz a kilenc fő blokkban.
- A sárga szekciómenü rögzített; a felső márkasor görgetéskor eltűnik.
- Világos/sötét/rendszer mód, eredeti nappali/éjszakai illusztráció megmarad.
- Szűrők, frissítés, fordítás, megszakítás, legendakapcsolók nem tűnnek el.
- Mobilon a teljes oldal nem lóg ki vízszintesen; a kifejezetten görgethető chart/térkép ettől eltérhet.
- Nincsenek új adatlekérések, átírt számítások vagy megváltozott időzónák.
- Ellenőrzés: build, lint, meglévő regressziós tesztek; böngészős szemrevételezés. Ez nem teljes WCAG-audit vagy minden lehetséges élő adatállapotot lefedő teszt.

### Ellenőrzési eredmény

- `npm run build`: sikeres. A meglévő méretfigyelmeztetés továbbra is jelzi az 500 kB feletti fő JavaScript-csomagot (most kb. 514 kB); ezt nem rejtettem el.
- `npm run lint`: sikeres.
- `node --test --test-concurrency=1 tests/*.test.mjs`: 136 sikeres teszt, 0 hiba.
- Böngésző: 1280 px széles asztali nézet, 390 és 360 px-es mobilnézet. Ellenőrzött nyitókép, energia-, klíma-, hír- és energiamix-felület; nappali/éjszakai téma, időszűrő és mobilmenü.
- Az aktív menüpont az Energiafolyam szakaszra görgetve helyesen megjelenik. Mobilon Escape bezárja a menüt és visszaadja a fókuszt a nyitógombnak. 360 és 390 px-nél nem volt teljes oldalas vízszintes túlcsordulás.
- Előnézeti kép: `outputs/design-review/energy-dark.jpg`. Ez mintaadatokat mutat, nem az élő adatok helyességének igazolása. Az `outputs/` nem kerül Gitbe.
- Élő adatfrissítést, fordítási feladatot vagy GitHub-publikálást a vizuális teszt nem indított.
