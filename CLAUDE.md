# Hunyó

Böngészős low-poly autós fizikajáték éjszakai pályán (a Terep2 inspirálta). Egyetlen HTML fájlként fut, a Three.js bele van építve. Online multiplayer PeerJS-en (WebRTC P2P): szabad játék, fogócska, bújócska; helyben 1–2 játékos osztott képernyőn.

- Játék: https://richiebalaton.github.io/hunyo/ (GitHub Pages a `main` ág gyökeréből, `index.html`)
- Repó: https://github.com/richiebalaton/hunyo
- Specifikáció és döntések: [docs/spec.md](docs/spec.md)
- Jelenlegi állapot és a következő fejlesztések listája: [docs/status.md](docs/status.md)

## Szerkezet

- `src/*.js` – a játék modulok. A build ebben a sorrendben fűzi össze őket egy `<script>`-be: physics, render, launch, net, lobby, tag (fogócska), hide (bújócska), game.
- `src/template.html` – HTML váz; `%VERSION%`, `%DATE%`, valamint a `<script>/*THREE*/</script>` és `<script>/*GAME*/</script>` helyőrzők.
- `src/favicon/` – favicon források; a beágyazott (data URI) változat a template `<head>`-jében van.
- `build.js` – build script; `index.html` – a build kimenete (commitolni kell, ezt szolgálja ki a Pages).
- `favicon.ico`, `.nojekyll`, `README.md` – a Pages gyökeréhez.

## Build

```
npm install      # three@0.158.0 (r158, a three.min.js-t használja)
npm run build    # = node build.js → index.html a gyökérben
```

A verziót és a dátumot a `build.js` tetején kell átírni (`VERSION`, `DATE`). Kiadás: build, majd az `index.html`-lel együtt commit és push a `main`-re.

## Konvenciók

- Név: Hunyó; technikai helyeken (fájlnév, azonosító) ékezet nélkül `Hunyo`/`hunyo`. A régi „Terep 30” nevet új helyen ne használd. Kivétel: a belső `PEER_PREFIX` (`'terep30-v1-'`) szándékosan maradt.
- A felület és a dokumentáció magyar nyelvű.
- A `src`-n kívüli helyi mappák (`itch/`, `github/`, `Hunyo.html`) nem részei a repónak.
