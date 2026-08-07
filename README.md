# Napfény / Otthon

Reszponzív, GitHub Pagesre kész webes dashboard Sungrow napelem- és Govee thermo-hygrometer adatokhoz.

Tervezett publikus cím: <https://pisipite.github.io/pasztra-tech/>

## Helyi futtatás

```bash
pnpm install
pnpm dev
```

## GitHub Pages

A `.github/workflows/deploy-pages.yml` minden `main` ágra küldött változtatás után, valamint 15 percenként elkészíti és publikálja az oldalt. A GitHub repository **Settings → Pages → Source** beállításánál válaszd a **GitHub Actions** lehetőséget.

## Élő adatok

Az oldal alapból bemutató adatokkal indul. A GitHub Actions a GoSungrow segítségével lekéri az iSolarCloud-adatokat, a Govee Developer API-ból pedig az otthonklíma-adatokat. Az induláshoz szükséges beállítások: [docs/setup.md](docs/setup.md).

API-kulcsot vagy jelszót ne írj a repositoryba: ezeket kizárólag GitHub Actions Secretsként add meg.
