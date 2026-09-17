# Élő adatok beállítása

Az oldal 15 percenként GitHub Actionsben frissíti a publikus adatfájlokat, majd újratelepíti a GitHub Pages oldalt. A felhasználónevek, jelszavak és API-kulcsok nem kerülnek bele a weboldalba vagy a build eredményébe.

## 1. GitHub Pages bekapcsolása

A `pisipite/pasztra-tech` repositoryban nyisd meg a **Settings → Pages** oldalt, és a **Source** mezőben válaszd a **GitHub Actions** lehetőséget.

## 2. Titkos értékek

A **Settings → Secrets and variables → Actions → Secrets** részen hozd létre ezeket:

| Név | Érték |
| --- | --- |
| `SUNGROW_USER` | iSolarCloud felhasználónév vagy e-mail |
| `SUNGROW_PASSWORD` | iSolarCloud jelszó |
| `GOVEE_API_KEY` | Govee Developer API-kulcs |
| `ENTSOE_SECURITY_TOKEN` | ENTSO-E Transparency Platform Web API Security Token |
| `SOLAR_LATITUDE` | A rendszer pontos földrajzi szélessége az időjárási előrejelzéshez |
| `SOLAR_LONGITUDE` | A rendszer pontos földrajzi hosszúsága az időjárási előrejelzéshez |
| `ERM_ZAPAD_ITN` | Nem kötelező: 12 jegyű ügyfélszám a személyre szabott tervezettáramszünet-figyeléshez |
| `ERM_ZAPAD_POD` | Nem kötelező: 16 jegyű mérési pont azonosító; ha ezt megadod, ezt használja az ITN helyett |
| `GEMINI_API_KEY` | Nem kötelező: Google AI Studio API-kulcs a bolgár hírcímek és ajánlók automatikus magyar fordításához |

A Govee API-kulcsot a Govee Home alkalmazásban lehet igényelni. A kulcsot soha ne írd fájlba vagy commitba.

Az ERM Zapad-azonosítók közül elég az egyiket megadni. Ezek sem kerülnek a publikus adatfájlba: az oldal csak akkor kap riasztási kártyát, ha a szolgáltató valóban tervezett kimaradást jelez.

A Gemini-kulcsot a **Google AI Studio → API Keys** oldalon készítsd el, és kizárólag GitHub Secretként add meg. Az ingyenes csomaghoz nem szükséges számlázási fiók. A fordítás csak akkor indul el, amikor valaki megnyomja egy hírdoboz **Magyarra** gombját; a böngésző ilyenkor a mentett GitHub frissítési tokennel célzott Actions-futást kér, de magát a Gemini-kulcsot soha nem kapja meg. A korábbi fordításokat a rendszer újrahasználja. Kulcs nélkül vagy átmeneti API-hiba esetén az eredeti bolgár szöveg marad látható.

## 3. Nem titkos változók

Az **Actions → Variables** részen add meg:

| Név | Kötelező | Érték |
| --- | --- | --- |
| `SUNGROW_PS_ID` | nem | Numerikus iSolarCloud erőmű-azonosító; egyetlen erőműnél automatikusan felismeri |
| `SUNGROW_HOST` | ajánlott | Magyarországról: `https://gateway.isolarcloud.eu` |
| `SUNGROW_APPKEY` | nem | iSolarCloud klienskulcs; ha üres, a jelenlegi közösségi kulcsot használja |
| `GOVEE_DEVICE_ID` | nem | A Govee eszköz azonosítója; ha üres, az első hőmérőt választja |
| `GOVEE_DEVICE_SKU` | nem | Például `H5179`; eszközválasztáshoz használható |
| `GOVEE_ROOM_NAME` | nem | Például `Nappali` |
| `CO2_KG_PER_KWH` | nem | Becsült kg CO₂/kWh szorzó; alapérték: `0.233` |
| `SOLAR_SYSTEM_KWP` | nem | Névleges rendszerteljesítmény; alapérték: `5` |
| `SOLAR_TILT_DEG` | nem | Paneldőlés fokban; jelenlegi fotóalapú becslés: `27` |
| `SOLAR_AZIMUTH_DEG` | nem | Open-Meteo azimut: `0` = dél, pozitív = nyugat; jelenlegi becslés: `12` |
| `SOLAR_PERFORMANCE_RATIO` | nem | Rendszerveszteségi szorzó; alapérték: `0.82` |

A `SUNGROW_PS_ID` helyben a következő GoSungrow paranccsal kereshető meg:

```bash
GoSungrow show ps list
```

## 4. Egykattintásos kézi frissítés

Az oldal fejlécében lévő **Adatok frissítése** gomb a GitHub Actions munkafolyamatot indítja el, megvárja az új adatfájl megjelenését, majd automatikusan újratölti a dashboardot.

Az első használat előtt:

1. A GitHub **Settings → Developer settings → Personal access tokens → Fine-grained tokens** oldalán hozz létre tokent.
2. Repositoryként csak a `pisipite/pasztra-tech` repót engedélyezd.
3. A **Repository permissions → Actions** jogosultság legyen **Read and write**; más írási jogosultság nem szükséges.
4. Az oldalon nyisd meg az **Adatkapcsolat** panelt, illeszd be a tokent, és mentsd el.

A token kizárólag az adott böngésző helyi tárhelyén marad. Nem kerül GitHub commitba, Actions-artifactba vagy a publikus weboldal fájljaiba. Közös vagy idegen eszközön ne mentsd el.

## 5. Első futtatás

Nyisd meg az **Actions → Deploy to GitHub Pages** munkafolyamatot, majd válaszd a **Run workflow** lehetőséget. Sikeres futás után az oldal címét a repository **Settings → Pages** felületén találod. A dokumentáció nem tartalmaz közvetlen hivatkozást, hogy csökkentse a nyilvános oldal felfedezhetőségét.

## Hogyan működik?

Az automatizmus a GoSungrow `AppService.getPowerStationData` és `WebAppService.showPSView` végpontjaiból készíti el a napelemes adatokat. A Govee eszközök felderítéséhez a `/router/api/v1/user/devices`, az állapot lekéréséhez a `/router/api/v1/device/state` végpontot használja. A bolgár országos termelési mix és terhelés elsődleges forrása az ENTSO-E Transparency Platform; a lekérő 2025. január 1-jétől órás előzményt épít, majd a későbbi futásokban csak az utolsó három napot frissíti.

A GoSungrow az iSolarCloud nem hivatalos, közösségi kliensprogramja. Mivel az iSolarCloud felülete változhat, egy későbbi szolgáltatói módosítás után az adatlekérés igazítást igényelhet.
