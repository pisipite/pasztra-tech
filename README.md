# Napfény / Otthon

Reszponzív, GitHub Pagesre kész webes dashboard Sungrow napelem- és Govee thermo-hygrometer adatokhoz.

Az oldal címét a repository **Settings → Pages** felülete mutatja; a dokumentáció szándékosan nem hivatkozik rá közvetlenül.

## Helyi futtatás

```bash
pnpm install
pnpm dev
```

## GitHub Pages

A `.github/workflows/deploy-pages.yml` minden `main` ágra küldött változtatás után teljes buildet készít. A 20 percenkénti és a kézi adatfrissítés a már elkészült oldalt használja, csak az adatfájlokat cseréli ki. A GitHub ütemezése és a futtatógépek elérhetősége miatt a tényleges frissítés késhet. A GitHub repository **Settings → Pages → Source** beállításánál válaszd a **GitHub Actions** lehetőséget.

Az adatgyűjtés, az összeállítás és a közzététel ugyanazon a futtatón történik. A szokásos frissítések megvárják az aktív futást; csak kódfrissítés vagy a kézi `force_refresh` helyreállítás szakítja meg azt. A mérési előzmények már a közzététel előtt a gyorsítótárba kerülnek, így egy későbbi közzétételi hiba nem akadályozza meg a mentésüket.

### Gyors frissítési útvonalak

- **Kódváltozás:** adatgyűjtés → TypeScript/Vite build → Pages-közzététel.
- **Adatfrissítés:** kész oldal visszaállítása → adatgyűjtés → JSON-fájlok cseréje → Pages-közzététel. Nincs TypeScript/Vite build; a függőségeket is újrahasználja.
- **Cikkfordítás:** kész oldal és hírfolyam visszaállítása → csak a kért cikk fordítása → Pages-közzététel. Nem kér le újra híreket, szenzorokat, időjárást vagy közlekedést; normál esetben függőséget sem telepít.

Az első futáskor, új kódverziónál vagy hiányzó/sérült weboldal-gyorsítótárnál teljes build szükséges. A `dist` pillanatképe **csak sikeres közzététel után** kerül gyorsítótárba. Az ellenőrzőösszeges `publication.json` jegyzék alapján a korábbi publikus adatok gyorsítótár nélkül is visszaállíthatók; hiányos visszaállításnál a folyamat nem publikál üres adatállományt. A repositoryban kezelt térképfájlokat a visszaállítás nem írja felül.

A Pages artifact feltöltése és a deploy továbbra is szükséges: ez nem külön adat-API. Emiatt a GitHub várakozási ideje nem szűnik meg, de a felesleges újraépítés és fordításkori teljes adatgyűjtés igen. Új szolgáltatás, secret vagy jogosultság nem szükséges.

A közzététel a feltöltési lépésből kapott `artifact_id` értékét közvetlenül használja a GitHub Pages API-ban. Nem keresi újra név alapján a csomagot: a GitHub átmenetileg üres listája így nem okoz `No artifacts named "github-pages"` hibát. Az OIDC-hitelesítés és a `github-pages` környezet védelme megmarad. Csak az állapotlekérdezés próbálkozik újra átmeneti hibánál; a közzététel indítását nem ismétli meg vakon. A 10 perces időkorlát vagy megszakítás a már azonosított függő közzétételt is megpróbálja leállítani. GitHub-szolgáltatáskiesést ez nem tud kiküszöbölni.

Kapcsolódó fájlok: `scripts/pages-publication.mjs` (visszaállítás és összeállítás), `scripts/pages-deploy.mjs` (azonosító-alapú Pages-közzététel), `scripts/translate-news.mjs` (célzott fordítás), `scripts/retained-data.mjs` (hibatűrő adatösszefésülés), `src/githubRefresh.ts` (böngészős követés). Ellenőrzés: `pnpm test`, `pnpm lint`, `pnpm build`.

## Élő adatok

Minden megjelenített dátum, időpont, időszűrő és naptári összesítés a bolgár
`Europe/Sofia` időzónát használja, automatikus téli–nyári időszámítással.
A közös megvalósítás a `shared/timeZone.mjs` fájlban található; a frontend
a `src/timeZone.ts` modulon keresztül használja. Új blokkban dátumformázáshoz
`dateTimeFormatter`, napi kulcshoz `dateKey`, naptári léptetéshez
`addCalendarDays` / `addCalendarMonths` használandó, nem a böngésző helyi
`Date.getHours()` / `setDate()` metódusai. A JSON-időbélyegek továbbra is
valós, időzónaeltolást tartalmazó időpontok (jellemzően UTC ISO-formátumban).

Az oldal alapból bemutató adatokkal indul. A GitHub Actions a GoSungrow segítségével lekéri az iSolarCloud-adatokat, a Govee Developer API-ból pedig az otthonklíma-adatokat. Az induláshoz szükséges beállítások: [docs/setup.md](docs/setup.md).

Élő adatgyűjtési hiba esetén az utolsó valódi adat marad meg az eredeti időbélyegével és figyelmeztetéssel; nem kerül a helyére mintaadat. Ha még nincs korábbi mérés, a görbe üres, az adatkapcsolat pedig inaktív. A frissítési kísérlet ideje (`refreshedAt`) külön mező, ezért egy részleges frissítés figyelése is befejeződik.

API-kulcsot vagy jelszót ne írj a repositoryba: ezeket kizárólag GitHub Actions Secretsként add meg.

Az oldal fejlécében lévő **Adatok frissítése** gomb manuálisan is elindíthatja a munkafolyamatot. Az első használat előtt az Adatkapcsolat panelen egy kizárólag ehhez a repositoryhoz tartozó, **Actions: Read and write** jogosultságú finomhangolt GitHub-tokent kell megadni. A token a repositoryba és a közzétett fájlokba nem kerül be; csak az adott böngésző helyi tárhelyén marad.
