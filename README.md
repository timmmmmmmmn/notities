# Notities

Notities op je telefoon en je laptop: [notities.timvanbergen.nl](https://notities.timvanbergen.nl).

- Notities en checklists, vastpinnen, zoeken, archief en prullenbak (30 dagen)
- Labels, notitiekleuren, kaartjes- of lijstweergave, sorteren
- Opmaak (vet, koppen, opsommingen, afvinkvakjes, links) met een leesweergave
- Herinneringen: in de app als echte melding, op de website zolang die openstaat
- Eerdere versies van een notitie terugzetten, dagnotitie, alles exporteren als Markdown
- Notities delen met andere gebruikers (mag bewerken of alleen lezen); labels, kleur en vastpinnen houdt ieder voor zich
- In de app: PDF's openen met Notities ("Openen met"), inzoomen, en er een notitie van maken met de tekst erin
- Werkt offline: alles staat ook op het apparaat en synchroniseert vanzelf zodra je weer online bent
- Op twee apparaten tegelijk bewerkt? Dan blijven beide versies bewaard
- Accounts met goedkeuring: de eerste gebruiker wordt beheerder, nieuwe accounts keurt die goed in Instellingen
- Android-app met de website ingebouwd, een zwevende glazen navigatiebalk en glazen menu's (Android 13+),
  snelkoppelingen op het app-icoon, tekst delen naar Notities, en automatische updates op de achtergrond

## Opbouw

| Map | Wat |
| --- | --- |
| `src/` | Cloudflare Worker: de API (`/api/...`) |
| `migrations/` | D1-database (`notities-db`) |
| `public/` | De website (geen build-stap) |
| `android/` | De Android-app (WebView + glazen menu) |

## Ontwikkelen

```sh
npx wrangler d1 migrations apply DB --local
npx wrangler dev
```

Online zetten: `npx wrangler d1 migrations apply DB --remote` (bij een nieuwe migratie) en `npx wrangler deploy`.

## Android-app

Bij elke push die `android/` of `public/` raakt, bouwt GitHub Actions een ondertekende APK en zet die bij
[Releases](../../releases/latest). Download `Notities.apk` op je telefoon en installeer hem. Daarna downloadt de app nieuwe versies zelf en installeert ze zodra je de app wegzet.

Het glazen menu (`android/app/src/main/java/nl/timvanbergen/notities/glass`) is een port van
[rit3zh/expo-glass-custom-menu](https://github.com/rit3zh/expo-glass-custom-menu) (MIT, zie `LICENSE` in die map).

## Mac-app

`macos/` is Notities als Mac-app in Rust (AppKit), met glazen navigatie, native menu's en het
spiekbriefje in de hoek rechtsonder. Installeren: `macos/install.sh`. Zie `macos/README.md`.
