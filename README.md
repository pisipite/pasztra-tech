# Napfény / Otthon

Reszponzív, GitHub Pagesre kész webes dashboard Sungrow napelem- és Govee thermo-hygrometer adatokhoz.

Az oldal címét a repository **Settings → Pages** felülete mutatja; a dokumentáció szándékosan nem hivatkozik rá közvetlenül.

## Helyi futtatás

```bash
pnpm install
pnpm dev
```

## GitHub Pages

A `.github/workflows/deploy-pages.yml` minden `main` ágra küldött változtatás után, valamint 20 percenként ütemezve elkészíti és publikálja az oldalt. A GitHub ütemezése és a futtatógépek elérhetősége miatt a tényleges frissítés késhet. A GitHub repository **Settings → Pages → Source** beállításánál válaszd a **GitHub Actions** lehetőséget.

Az adatgyűjtés, az összeállítás és a közzététel ugyanazon a futtatón történik. A szokásos frissítések megvárják az aktív futást; csak kódfrissítés vagy a kézi `force_refresh` helyreállítás szakítja meg azt. A mérési előzmények már a közzététel előtt a gyorsítótárba kerülnek, így egy későbbi közzétételi hiba nem akadályozza meg a mentésüket.

## Élő adatok

Az oldal alapból bemutató adatokkal indul. A GitHub Actions a GoSungrow segítségével lekéri az iSolarCloud-adatokat, a Govee Developer API-ból pedig az otthonklíma-adatokat. Az induláshoz szükséges beállítások: [docs/setup.md](docs/setup.md).

API-kulcsot vagy jelszót ne írj a repositoryba: ezeket kizárólag GitHub Actions Secretsként add meg.

Az oldal fejlécében lévő **Adatok frissítése** gomb manuálisan is elindíthatja a munkafolyamatot. Az első használat előtt az Adatkapcsolat panelen egy kizárólag ehhez a repositoryhoz tartozó, **Actions: Read and write** jogosultságú finomhangolt GitHub-tokent kell megadni. A token a repositoryba és a közzétett fájlokba nem kerül be; csak az adott böngésző helyi tárhelyén marad.
