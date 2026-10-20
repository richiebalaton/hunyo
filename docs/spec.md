# Hunyó (korábban Terep 30) – specifikáció

A Terep2 (Nagymáthé Dénes, 1994–96, DOS) inspirálta. Böngészőben fut (asztali és mobil).

## Döntések
- Név: Hunyó (2026-10-18, korábban Terep 30). Csak magyarul, angol alcím nélkül. Technikai helyeken ékezet nélkül: Hunyo. Logó: HUNY + sárga Ó. A kék táblán marad: "A TEREP2 INSPIRÁLTA · Nagymáthé Dénes · 1994–1996".
- Futtatás: egyetlen HTML fájl (Three.js beépítve), megosztás GitHub Pagesen: https://richiebalaton.github.io/hunyo/
- Online multiplayer: max 6 fő, WebRTC P2P a PeerJS-en (unpkg peerjs@1.5.4, nyilvános 0.peerjs.com jelzőszerver), 5 betűs szobakód, a házigazda választja a pályát, bármikor be/ki lehet lépni. Belső PEER_PREFIX maradt 'terep30-v1-'. Csak interneten működik.
- Játékmódok: szabad autózás, fogócska (online, 2–6 fő), bújócska (online).
- Helyi mód: 1–2 játékos, osztott képernyő.
- Látvány: modern low-poly, éjszakai hangulat (hold, csillagok, köd, színes fénytornyok, neon csíkok, lidércfények, halak a tavakban, Starlink-vonat és Falcon 9 indítás az égen).
- Fizika: tömegpont-rugó autó, helyi horpadások, totálkár 100%-nál.
- Irányítás: billentyűzet, egér (körbenézés), gamepad, mobilon érintő vezérlés (kar + gombok), fekvő tájolás, teljes képernyő.
- Pályák: 1 klasszikus + seedes generált; mindegyikben a nagy íves rámpa.
- Hang: halk, elektromos autós.

## Autó
- Rakéta: saját low-poly hiperautó (Lamborghini-hangulat), márkajelzés nélkül, repülő Roadster-képességekkel: szívás (~2G), 600 l hideggáz, boost, ugrás/lebegés, levegőben helyzetszabályzás. 6 szín (online játékosonként).

## Ütemterv
- v1–v2.0.0: kész.
- Ötlet későbbre: időfutam + szellemautó.
