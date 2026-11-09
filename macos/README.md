# Notities voor de Mac

Mac-app in Rust (AppKit via `objc2`), in de Tim app-stijl. Net als de Android-app toont hij de
website (notities.timvanbergen.nl); wat van de Mac zelf komt:

- de zwevende navigatie als echt macOS-glas (`NSGlassEffectView`), de menu's als native macOS-menu's
- een menubalk met sneltoetsen (⌘N nieuwe notitie, ⇧⌘N lijst, ⇧⌘D dagnotitie, ⌘F zoeken, ⌘1–3, ⌘R, ⌘+/⌘−)
- herinneringen als macOS-meldingen, delen via het deelmenu, exporteren naar een `.md`-bestand
- **spiekbriefje**: muis in de hoek rechtsonder van een scherm → een klein zwevend venster met altijd
  dezelfde notitie ("Spiekbriefje"). Ook als Notities dicht is: het hulpje NotitiesHoek (in Notities.app,
  start bij het inloggen) houdt de hoek in de gaten en start Notities dan stil. Aan/uit in het Notities-menu,
  of oproepen met ⌘J. Zet Apples eigen Snelle notitie in die hoek uit (Systeeminstellingen › Bureaublad en
  Dock › Actieve hoeken).
- inloggen gaat via de gewone sessie-cookie, die de app onthoudt

## Bouwen en installeren

```sh
./install.sh      # bouwt de app, zet hem in /Applications en start het hulpje voor de hoek
./bundle.sh       # alleen bouwen, naar target/
```

## Icoon

`icons/Notities/AppIcon.icon` is het icoon in lagen (Icon Composer-formaat), zodat het meedoet met de
heldere en getinte stijl van het Dock. `icons/make_layers.swift` haalt de lagen uit het platte icoon.
Een `Assets.car` maken kan alleen met Xcode; dat doet GitHub Actions (`.github/workflows/macos-iconen.yml`).
Het resultaat hoort in `icons/Notities/build/`.

## Testen

`TIMAPP_URL=https://localhost:8791/` wijst naar `wrangler dev --local-protocol https` (de sessie-cookie is
`Secure`, dus gewoon http werkt niet). Met `TIMAPP_STEPS` en `TIMAPP_SHOTS` voert de app stappen uit en
maakt afbeeldingen van het venster (zie `src/debug.rs`).

De code is dezelfde als die van de Agenda-Mac-app (in de agenda-repo); de bundel-id bepaalt welke app het is.
