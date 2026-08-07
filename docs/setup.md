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

A Govee API-kulcsot a Govee Home alkalmazásban lehet igényelni. A kulcsot soha ne írd fájlba vagy commitba.

## 3. Nem titkos változók

Az **Actions → Variables** részen add meg:

| Név | Kötelező | Érték |
| --- | --- | --- |
| `SUNGROW_PS_ID` | igen | Az iSolarCloud erőmű azonosítója |
| `SUNGROW_HOST` | ajánlott | Magyarországról: `https://gateway.isolarcloud.eu` |
| `GOVEE_DEVICE_ID` | nem | A Govee eszköz azonosítója; ha üres, az első hőmérőt választja |
| `GOVEE_DEVICE_SKU` | nem | Például `H5179`; eszközválasztáshoz használható |
| `GOVEE_ROOM_NAME` | nem | Például `Nappali` |
| `CO2_KG_PER_KWH` | nem | Becsült kg CO₂/kWh szorzó; alapérték: `0.233` |

A `SUNGROW_PS_ID` helyben a következő GoSungrow paranccsal kereshető meg:

```bash
GoSungrow show ps list
```

## 4. Első futtatás

Nyisd meg az **Actions → Deploy to GitHub Pages** munkafolyamatot, majd válaszd a **Run workflow** lehetőséget. Sikeres futás után az oldal címe:

<https://pisipite.github.io/pasztra-tech/>

## Hogyan működik?

Az automatizmus a GoSungrow `AppService.getPowerStationData` és `WebAppService.showPSView` végpontjaiból készíti el a napelemes adatokat. A Govee eszközök felderítéséhez a `/router/api/v1/user/devices`, az állapot lekéréséhez a `/router/api/v1/device/state` végpontot használja.

A GoSungrow az iSolarCloud nem hivatalos, közösségi kliensprogramja. Mivel az iSolarCloud felülete változhat, egy későbbi szolgáltatói módosítás után az adatlekérés igazítást igényelhet.
