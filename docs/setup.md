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
| `SOLAR_LATITUDE` | A rendszer pontos földrajzi szélessége az időjárási előrejelzéshez |
| `SOLAR_LONGITUDE` | A rendszer pontos földrajzi hosszúsága az időjárási előrejelzéshez |

A Govee API-kulcsot a Govee Home alkalmazásban lehet igényelni. A kulcsot soha ne írd fájlba vagy commitba.

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

## 4. Első futtatás

Nyisd meg az **Actions → Deploy to GitHub Pages** munkafolyamatot, majd válaszd a **Run workflow** lehetőséget. Sikeres futás után az oldal címét a repository **Settings → Pages** felületén találod. A dokumentáció nem tartalmaz közvetlen hivatkozást, hogy csökkentse a nyilvános oldal felfedezhetőségét.

## Hogyan működik?

Az automatizmus a GoSungrow `AppService.getPowerStationData` és `WebAppService.showPSView` végpontjaiból készíti el a napelemes adatokat. A Govee eszközök felderítéséhez a `/router/api/v1/user/devices`, az állapot lekéréséhez a `/router/api/v1/device/state` végpontot használja.

A GoSungrow az iSolarCloud nem hivatalos, közösségi kliensprogramja. Mivel az iSolarCloud felülete változhat, egy későbbi szolgáltatói módosítás után az adatlekérés igazítást igényelhet.
