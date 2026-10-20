# Hunyó – állapot (v2.0.0, 2026-10-18)

- v1.8.0 Fogócska (tag.js), v1.8.1 sérülés-hangolás (DAMAGE_SCALE=1.0, DMG_STRUCT_K=0.7, DMG_DENT_W=0.18, DENT_DMG_MIN_IV=8), v1.9.0 rombolódás (vis max 0.24, DENT_MAX_OFF=0.35, kopás, szikra+törmelék iv>14, lámpa-kialvás iv>12, füst 60/85%).
- v2.0.0:
  - Halak: csak mély víz fölé ugranak (az ív 4 pontján és a landolásnál fenék < vízszint−0,8 m), az otthonpont csak vízben mozdul, szárazra került hal visszakerül a kiinduló helyére, úszó hal max. vízszint−0,15 m.
  - Főmenü: csak "v2.0.0", dátum nélkül. H favicon a template <head>-jében (data URI) + favicon.ico.
  - LOBBI (lobby.js, Room): fogócska/bújócska módban; KÉSZ gomb (Enter, gamepad D-pad fel, kattintás/koppintás). Mindenki kész + min. 2 fő → automatikus indulás (3 mp visszaszámlálás). Kör vége (8 mp eredmény) → vissza a lobbiba, kész-jelek törlődnek. Kör közben belépő: néző (rejtett, nem ütközik, követ egy játékost, C = másik játékos). Ha 2 alá csökken a létszám: vissza a lobbiba. Szabad játékban nincs lobbi.
  - LÁMPA ki/be minden módban: L (osztott képernyőn F / L), gamepad D-pad le, mobilon LÁMPA gomb. Kikapcsolva: fényszóró, halók, fénynyaláb-kúp, hátsó lámpa sötét; a sérülés miatti kialvástól független. Hálózaton fx[5] bitként megy. Halvány fénynyaláb-kúp (opacity 0,018, kereső 0,06), a helyben nem használt 2. fényszórópár a legközelebbi égő lámpájú távoli autót követi.
  - BÚJÓCSKA (hide.js): kör 3/4/6 perc keresés (alap 4) + 40 mp elbújás; 1 kereső (6 főnél 2), fertőzős. Kereső: fagyasztva + fekete kép az elbújás alatt, saját szín + piros jelzőfény, lámpa nem kapcsolható ki, 1,5x hatótáv (45 m), kúp fél-szög 0,55 rad (spot: 120→180 m, 0,46→0,66 rad, 850→1300). Megtalálás: 1,5 mp folyamatosan kúpban (0,2 mp kiesés-tűrés, 10 Hz, 3 mintapont, World.losClear: terep/rámpa/doboz/szikla/fa), vagy érintés; a kereső gépe jelent ('hq'), a házigazda dönt. Bújó: matt sötét (0x202328), névfelirat és szívás-glow rejtve a keresők elől, max 90% sérülés (dmgCap), páranyom gázhasználatnál (2 mp), ping 45 mp-enként 0,5 mp (3 mp-cel előtte figyelmeztetés), piros képszél a fényben töltés arányában. Kereső: töltődő kör a célpont fölött. Vége: mindenki megvan → az utolsó megtalált nyer; idő lejárt → minden túlélő nyer. Kilépő kereső helyett új sorsolás. Kör elején mindenki a startra, javított autóval. Parkoló autók nincsenek, a takarás terep/rámpa/doboz/szikla/fa ellen megy.
  - Távoli autók térhatású hangja (PannerNode, lineáris, 35 m, álló autó néma) minden online módban.
- Teszt (v2.0.0): egyjátékos regresszió (fizika: 4 m-es ejtés 30 a totálkárig, változatlan), 2–3 böngészős online teszt helyi PeerJS-szerverrel, klasszikus és generált pályán. Nyilvános PeerJS-szerveren nem tesztelve.

## Következő fejlesztés (v2.1.0)
1. Víz: vízben az autó mindig tapadjon a talajhoz, ne tudjon repülni, amíg ki nem jön. Ha berepül, szépen merüljön el, álljon a kerekére, és a vízfenéken lassan lehessen kimenni.
2. Víz alatti zárlat: az óra a teljes elmerüléstől indul. 7 mp-nél figyelmeztetés és fogyni kezd az életerő, 15 mp-nél zárlat = kiesés, kereső sem lehet belőle, a kör végéig vár. Bújócskában a vízben kiesett bújó vesztes (nem számít megtaláltnak); ha az utolsó bújók is vízben esnek ki, a keresők nyernek. Szabad autózásban zárlat helyett újraindulás a kezdőpontról. Fogócskában nincs zárlat, csak a víz lassít.
3. Pályahatár: láthatatlan fal a pálya szélein és tetején. Nem okoz sérülést, a Falcon 9-re nem hat.
4. Repülés (E): a tappelés se adjon nagyobb emelkedési sebességet, mint a nyomva tartás.
5. Háttérbe tett fül a házigazdánál ne állítsa meg a host-logikát (megtalálás, kör vége, lobbi).
6. Fizika-robbanás elleni védelem nagy képkocka-időnél: fix lépésköz, dt-plafon, NaN vagy abszurd sebesség esetén autó-visszaállítás.
7. Általános sebességplafon minden mozgásképességre (boost, ugrás, szívás és ezek kombinációi) és az eredő sebességre.
8. Nagy sebességnél ne lehessen átbújni tárgyakon/terepen.
9. Visszaállító gomb beragadásra/felborulásra: kerékre állítás helyben, nem teleport, bújócskában ne legyen menekülő eszköz.
10. Kezdőpontok szétosztása, hogy kör elején ne spawnoljanak egymásba.
