# Notities

Notities op je telefoon en je laptop: [notities.timvanbergen.nl](https://notities.timvanbergen.nl).

- Notities en checklists, vastpinnen, zoeken, prullenbak (30 dagen)
- Werkt offline: alles staat ook op het apparaat en synchroniseert vanzelf zodra je weer online bent
- Op twee apparaten tegelijk bewerkt? Dan blijven beide versies bewaard
- Accounts met goedkeuring: de eerste gebruiker wordt beheerder, nieuwe accounts keurt die goed in Instellingen
- Android-app met de website ingebouwd en glazen menu's (Android 13+); werkt zichzelf bij via de releases hieronder

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
[Releases](../../releases/latest). Download `Notities.apk` op je telefoon en installeer hem; daarna meldt de app zelf nieuwe versies.

Het glazen menu (`android/app/src/main/java/nl/timvanbergen/notities/glass`) is een port van
[rit3zh/expo-glass-custom-menu](https://github.com/rit3zh/expo-glass-custom-menu) (MIT, zie `LICENSE` in die map).
