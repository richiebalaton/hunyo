'use strict';
// ============================================================
//  HUNYÓ – Bújócska játékmód (online, 2–6 fő)
//  A házigazda dönt mindenről (kereső sorsolása, megtalálás, kör vége), és a Room
//  'g' üzenetében szétküldi. A fénykúp-ellenőrzést a kereső gépe végzi, és 'hq'
//  üzenettel jelenti; a házigazda jóváhagyja. Az időket hátralévő másodpercekkel küldjük.
//  Menet: visszaszámlálás 3 mp → elbújás 40 mp (a kereső áll, fekete a képe) → keresés
//  (3/4/6 perc) → eredménytábla 8 mp → lobbi. Akit megtalálnak, kereső lesz.
// ============================================================
const HIDE_COUNT = 3, HIDE_HIDE = 40, HIDE_RES = 8;
const HIDE_PING = 45, HIDE_PING_DUR = 0.5, HIDE_WARN = 3;   // ping 45 mp-enként, 0,5 mp, 3 mp-cel előtte figyelmeztetés
const HIDE_FIND_T = 1.5;          // ennyi ideig kell folyamatosan a fénykúpban lenni
const HIDE_GRACE = 0.2;           // ennél rövidebb kiesés (mintavételi zaj) nem nullázza a töltést
const HIDE_RANGE = 45;            // a kereső fénykúpjának hatótávja (m) – a sima lámpa 30 m-éhez képest 1,5x
const HIDE_CONE = 0.55;           // a kúp fél-nyílásszöge (rad, kb. 31°); a sima lámpáé 0,42
const HIDE_DMG_CAP = 0.9;         // a bújók legfeljebb 90%-ig sérülhetnek
const HIDE_MATTE = 0x202328;      // a bújók egységes sötét, matt fényezése
const HIDE_SCAN_DT = 0.1;         // fénykúp-ellenőrzés 10 Hz-cel

const Hide = {
  phase: 'off',          // off | count | hide | seek | res
  endAt: 0, seekers: new Set(), surv: {}, results: null, round: 0, why: '',
  charge: new Map(), exp: new Map(), rings: new Map(), beacons: new Map(),
  _scanT: 0, _cq: 0, _myRound: -1, _applied: false, _warned: -1, _pingOn: false,

  now() { return performance.now() / 1000; },
  on() { return Net.active && Room.mode === 'hide' && Room.phase === 'game' && this.phase !== 'off'; },
  name(id) { const p = Net.players.get(id); return p ? p.name : '?'; },
  inPart(id) { return Room.part.includes(id) && Net.players.has(id); },
  isSeeker(id) { return this.seekers.has(id); },
  isHider(id) { return this.on() && this.inPart(id) && !this.seekers.has(id); },
  hidersLeft() { return Room.part.filter(id => Net.players.has(id) && !this.seekers.has(id)).length; },
  // a keresési fázisban eltelt idő (a pinghez)
  seekElapsed() { return this.phase === 'seek' ? Math.max(0, Room.len - Math.max(0, this.endAt - this.now())) : 0; },
  nextPing() { const e = this.seekElapsed(); return (Math.floor(e / HIDE_PING) + 1) * HIDE_PING - e; },
  pinging() { if (this.phase !== 'seek') return false; const e = this.seekElapsed(); return e >= HIDE_PING && (e % HIDE_PING) < HIDE_PING_DUR; },

  // ---- házigazda
  stop() { this.phase = 'off'; this.seekers.clear(); this.surv = {}; this.results = null; this.charge.clear(); this.exp.clear(); },
  start(part) {
    const ids = [...part];
    const k = ids.length >= 6 ? 2 : 1;
    this.seekers.clear();
    while (this.seekers.size < k) this.seekers.add(ids[Math.floor(Math.random() * ids.length)]);
    this.surv = {}; this.results = null; this.why = '';
    this.round++;
    this.phase = 'count'; this.endAt = this.now() + HIDE_COUNT;
    this.broadcast();
  },
  hostTick(dt) {
    if (!Net.host || Room.mode !== 'hide' || Room.phase !== 'game') return;
    const now = this.now();
    if (this.phase === 'count') { if (now >= this.endAt) { this.phase = 'hide'; this.endAt = now + HIDE_HIDE; this.broadcast(); } return; }
    if (this.phase === 'hide') { this.ensureSeeker(); if (now >= this.endAt) { this.phase = 'seek'; this.endAt = now + Room.len; this.broadcast(); } return; }
    if (this.phase === 'seek') {
      this.ensureSeeker();
      // érintés a házigazda nézete szerint is (a kliens-bejelentés mellett)
      for (const a of this.seekers) {
        const A = Tag.carOf(a); if (!A) continue;
        for (const b of Room.part) {
          if (this.seekers.has(b) || !Net.players.has(b)) continue;
          const B = Tag.carOf(b);
          if (B && carsTouch(A, B)) this.claim(a, b);
        }
      }
      if (this.hidersLeft() === 0) this.endRound('all');
      else if (now >= this.endAt) this.endRound('time');
      return;
    }
    if (this.phase === 'res' && now >= this.endAt) Room.toLobby();
  },
  // ha nem maradt kereső (kilépett), a házigazda sorsol újat a bújók közül
  ensureSeeker() {
    for (const s of [...this.seekers]) if (!this.inPart(s)) this.seekers.delete(s);
    if (this.seekers.size) return;
    const h = Room.part.filter(id => Net.players.has(id));
    if (!h.length) return;
    const id = h[Math.floor(Math.random() * h.length)];
    this.seekers.add(id);
    this.broadcast();
    this.onFound(id, -1, true);
  },
  claim(a, b) {
    if (!Net.host || this.phase !== 'seek') return false;
    if (!this.seekers.has(a) || this.seekers.has(b) || !this.inPart(a) || !this.inPart(b)) return false;
    const A = Tag.carOf(a), B = Tag.carOf(b);
    if (!A || !B || Math.hypot(A.c[0] - B.c[0], A.c[1] - B.c[1], A.c[2] - B.c[2]) > HIDE_RANGE + 20) return false;
    this.seekers.add(b);
    this.surv[b] = +(this.now() - (this.endAt - Room.len)).toFixed(1);
    this.broadcast();
    this.onFound(b, a);
    if (this.hidersLeft() === 0) this.endRound('all');
    return true;
  },
  endRound(why) {
    const list = Room.part.filter(id => Net.players.has(id)).map(id => {
      const found = this.surv[id] !== undefined, initial = this.seekers.has(id) && !found;
      const t = initial ? 0 : found ? this.surv[id] : Room.len;
      return { id, name: this.name(id), t, s: initial ? 'k' : found ? 'f' : 'a' };
    }).sort((a, b) => b.t - a.t);
    // győztes: idő lejártakor minden túlélő; ha mindenkit megtaláltak, az utolsó megtalált
    const best = list.length ? list[0].t : 0;
    for (const r of list) r.w = why === 'time' ? r.s === 'a' : (r.s === 'f' && r.t === best);
    this.results = list; this.why = why;
    this.phase = 'res'; this.endAt = this.now() + HIDE_RES;
    this.broadcast();
  },
  onLeave(id) {
    if (!Net.host) return;
    this.seekers.delete(id);
    this.charge.delete(id);
  },
  snapshot() {
    const sv = {};
    for (const k in this.surv) sv[k] = this.surv[k];
    return { ph: this.phase, rem: +Math.max(0, this.endAt - this.now()).toFixed(2), sk: [...this.seekers], sv, res: this.results, r: this.round, w: this.why };
  },
  broadcast() { Room.broadcast(); },

  // ---- kliens
  apply(d) {
    const old = new Set(this.seekers), oldPh = this.phase;
    this.phase = d.ph; this.endAt = this.now() + d.rem;
    this.seekers = new Set(d.sk); this.surv = d.sv || {}; this.results = d.res; this.round = d.r; this.why = d.w || '';
    // új kereső: megtalálták (van túlélési ideje), vagy pótlás egy kilépett kereső helyett
    if (oldPh !== 'off' && this.phase !== 'count') for (const id of this.seekers) if (!old.has(id)) this.onFound(id, -1, this.surv[id] === undefined);
  },
  reset() { this.stop(); this.restoreLocal(); this.clearSprites(); },

  // a saját gép vizuális/egyensúlyi beállításainak visszaállítása (kör vége)
  restoreLocal() {
    const me = Game.cars[0]; if (me) me.dmgCap = 1;
    Game.freeze = false;
    for (const v of Game.views) this.styleView(v, null);
    for (const r of Net.remotes.values()) this.styleView(r.view, null);
    this._applied = false; this._pingOn = false;
    UI.hideHud(null);
  },
  styleView(v, role) {
    if (!v) return;
    const seeker = role === 'seeker', hider = role === 'hider';
    v.forceLamps = seeker; v.boostLamps = seeker;
    v.setPaint(hider ? HIDE_MATTE : null);
    v.hideGlow = hider && this.isSeeker(Net.myId) && v !== Game.views[0];
    v.ping = hider && this._pingOn;
  },

  onFound(id, by, newSeeker) {
    const me = Net.myId;
    if (newSeeker) UI.toast(0, id === me ? 'TE vagy az új KERESŐ!' : this.name(id) + ' az új kereső');
    else UI.toast(0, id === me ? 'MEGTALÁLTAK! Most te is kereső vagy' : this.name(id) + ' megvan! (' + this.hidersLeft() + ' bújó maradt)');
    if (typeof Sound !== 'undefined') { Sound.blip(id === me ? 300 : 900, 0.1); setTimeout(() => Sound.blip(id === me ? 200 : 1350, 0.14), 120); }
    if (id === me || by === me || this.isSeeker(me)) UI.flash(id === me ? 'rgba(255,40,40,0.6)' : 'rgba(255,255,85,0.45)');
    const c = Tag.carOf(id);
    if (c && Game.particles) for (let k = 0; k < 34; k++) {
      const a = Math.random() * 6.28;
      Game.particles.emit(c.c[0], c.c[1] + 0.6, c.c[2], Math.cos(a) * 6, 2 + Math.random() * 4, Math.sin(a) * 6, 0xffff66, 0.3, 0.8, 1, 0.5, 4);
    }
    this.charge.delete(id);
  },

  // látja-e az S autó fénykúpja a T autót (hatótáv, szög, takarás; 3 mintapont)
  sees(S, T) {
    if (!S || !T || S.wrecked) return false;
    const o = this._o || (this._o = [0, 0, 0]), p = this._p || (this._p = [0, 0, 0]);
    S.toWorld(2.15, 0.1, 0, o);
    const f = S.f, u = S.u;
    let dx0 = f[0] - u[0] * 0.09, dy0 = f[1] - u[1] * 0.09, dz0 = f[2] - u[2] * 0.09;
    const l0 = Math.hypot(dx0, dy0, dz0); dx0 /= l0; dy0 /= l0; dz0 /= l0;
    const cosA = Math.cos(HIDE_CONE), W = Game.world;
    for (const lx of [0, 1.6, -1.6]) {
      T.toWorld(lx, 0.15, 0, p);
      const dx = p[0] - o[0], dy = p[1] - o[1], dz = p[2] - o[2], d = Math.hypot(dx, dy, dz);
      if (d > HIDE_RANGE || d < 0.01) continue;
      if ((dx * dx0 + dy * dy0 + dz * dz0) / d < cosA) continue;
      if (W.losClear(o[0], o[1], o[2], p[0], p[1], p[2])) return true;
    }
    return false;
  },
  sendClaim(a, b) {
    this._cq = 0.3;
    if (Net.host) this.claim(a, b);
    else Net.sendHost({ t: 'hq', a, b });
  },

  update(dt) {
    if (!Net.active) { if (this._applied) this.restoreLocal(); this.clearSprites(); return; }
    if (Net.host) this.hostTick(dt);
    const on = this.on(), me = Game.cars[0], my = Net.myId;
    if (!on) { if (this._applied) this.restoreLocal(); this.clearSprites(); UI.hideHud(null); return; }
    this._applied = true;
    const amPart = Room.part.includes(my), amSeeker = this.seekers.has(my);
    // új kör: mindenki a startra, megjavított autóval
    if (this._myRound !== this.round && (this.phase === 'count' || this.phase === 'hide')) {
      this._myRound = this.round;
      if (me && amPart) { const st = spawnPoint(Game.world, my); me.wrecked = false; me.reset(st.x, st.z, st.yaw); me.lampsOff = false; if (Game.ctls[0]) Game.ctls[0].snap = true; UI.wreck(0, false); }
      this.charge.clear(); this.exp.clear(); this._warned = -1;
    }
    // ping: keresés közben 45 mp-enként minden bújó lámpája felvillan
    const pingOn = this.pinging();
    if (pingOn !== this._pingOn) { this._pingOn = pingOn; if (pingOn) Sound.blip(amSeeker ? 1500 : 500, 0.12); }
    if (this.phase === 'seek' && amPart && !amSeeker) {
      const np = this.nextPing(), slot = Math.floor(this.seekElapsed() / HIDE_PING);
      if (np <= HIDE_WARN && this._warned !== slot) { this._warned = slot; UI.toast(0, 'PING ' + HIDE_WARN + ' mp múlva: felvillannak a lámpáid!'); Sound.blip(700, 0.08); }
    }
    // saját autó: fagyasztás, sérülés-korlát
    if (me) {
      me.dmgCap = amPart && !amSeeker ? HIDE_DMG_CAP : 1;
      Game.freeze = amPart && (this.phase === 'count' || (amSeeker && this.phase === 'hide'));
      if (amSeeker && me.lampsOff) me.lampsOff = false;
    }
    // megjelenés: kereső = saját szín + erős lámpa + piros jelzőfény; bújó = matt sötét
    const role = (id) => !this.inPart(id) ? null : this.seekers.has(id) ? 'seeker' : 'hider';
    if (Game.views[0]) this.styleView(Game.views[0], role(my));
    for (const [id, r] of Net.remotes) this.styleView(r.view, role(id));
    this.updateBeacons();
    // páranyom: a bújó gázhasználata rövid, halványan derengő felhőt hagy
    this.vapor(dt);
    // kereső: fénykúp-ellenőrzés és érintés
    this._cq -= dt; this._scanT -= dt;
    // a töltés valós időben mér (lassú képkockáknál se csússzon el); egy lépés max. 0,25 mp
    const nowS = this.now();
    let sdt = 0;
    if (this._scanT <= 0) { sdt = Math.min(0.25, nowS - (this._lastScan || nowS - HIDE_SCAN_DT)); this._lastScan = nowS; }
    let vig = 0;
    if (this.phase === 'seek' && amPart && me && !me.wrecked) {
      const now = this.now();
      if (amSeeker) {
        const scan = this._scanT <= 0;
        if (scan) this._scanT = HIDE_SCAN_DT;
        for (const [id, r] of Net.remotes) {
          if (!this.isHider(id)) { this.charge.delete(id); continue; }
          let c = this.charge.get(id) || { t: 0, miss: 0 };
          if (scan) {
            if (this.sees(me, r.car)) { c.t += sdt; c.miss = 0; }
            else { c.miss += sdt; if (c.miss > HIDE_GRACE) c.t = 0; }
          }
          this.charge.set(id, c);
          const touched = (me.lastTouch === id && now - me.lastTouchT < 0.35) || carsTouch(me, r.car);
          if ((c.t >= HIDE_FIND_T || touched) && this._cq <= 0) this.sendClaim(my, id);
        }
      } else {
        // bújó: saját becslés arról, mennyire van fényben (csak visszajelzés)
        const scan = this._scanT <= 0;
        if (scan) this._scanT = HIDE_SCAN_DT;
        for (const [id, r] of Net.remotes) {
          if (!this.seekers.has(id) || !this.inPart(id)) { this.exp.delete(id); continue; }
          let c = this.exp.get(id) || { t: 0, miss: 0 };
          if (scan) {
            if (this.sees(r.car, me)) { c.t += sdt; c.miss = 0; }
            else { c.miss += sdt; if (c.miss > HIDE_GRACE) c.t = 0; }
          }
          this.exp.set(id, c);
          vig = Math.max(vig, Math.min(1, c.t / HIDE_FIND_T));
          const touched = (me.lastTouch === id && now - me.lastTouchT < 0.35) || carsTouch(me, r.car);
          if (touched && this._cq <= 0) this.sendClaim(id, my);
        }
      }
    }
    this.updateRings(amSeeker && this.phase === 'seek');
    UI.hideHud(this, vig);
  },

  vapor(dt) {
    const P = Game.particles; if (!P) return;
    const cars = [];
    if (Game.cars[0] && this.isHider(Net.myId)) cars.push(Game.cars[0]);
    for (const [id, r] of Net.remotes) if (this.isHider(id)) cars.push(r.car);
    for (const car of cars) {
      const wall = car.suctionOn && car.contacts > 0 && car.u[1] < 0.55;
      const lvl = Math.max(car.fxBoost || 0, Math.min(1, car.fxUp || 0), wall ? 0.5 : 0);
      if (lvl < 0.05 || Math.random() > lvl * dt * 30) continue;
      const v = this._vp || (this._vp = [0, 0, 0]);
      car.toWorld((Math.random() - 0.5) * 3.6, -0.2, (Math.random() - 0.5) * 1.6, v);
      P.emit(v[0], v[1], v[2], (Math.random() - 0.5) * 1.2 + car.v[0] * 0.2, 0.4 + Math.random() * 0.6, (Math.random() - 0.5) * 1.2 + car.v[2] * 0.2,
        0xb8f4ff, 0.9 + Math.random() * 0.7, 2.0, 0.32, 1.6, -0.15);
    }
  },

  // piros jelzőfény a keresők tetején
  updateBeacons() {
    const t = this.now(), v = [0, 0, 0];
    for (const [id, b] of this.beacons) if (!this.seekers.has(id) || !this.inPart(id) || !Tag.carOf(id)) b.visible = false;
    for (const id of this.seekers) {
      const c = Tag.carOf(id); if (!c || !this.inPart(id)) continue;
      let b = this.beacons.get(id);
      if (!b) {
        b = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex(true), color: 0xff2020, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
        Game.scene.add(b); this.beacons.set(id, b);
      }
      b.visible = true;
      const pulse = 0.5 + 0.5 * Math.sin(t * 9 + id);
      c.toWorld(-0.3, 0.75, 0, v); b.position.set(v[0], v[1], v[2]);
      b.material.opacity = 0.45 + pulse * 0.5; const s = 1.6 + pulse * 1.4; b.scale.set(s, s, 1);
    }
  },
  // a kereső képén: töltődő kör a célpont fölött
  ringTex(k) {
    this._rt = this._rt || [];
    if (this._rt[k]) return this._rt[k];
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const x = cv.getContext('2d');
    x.lineWidth = 12; x.strokeStyle = 'rgba(0,0,0,0.55)'; x.beginPath(); x.arc(64, 64, 46, 0, Math.PI * 2); x.stroke();
    x.strokeStyle = k >= 20 ? '#ff4040' : '#ffff55'; x.beginPath(); x.arc(64, 64, 46, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k / 20); x.stroke();
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    return (this._rt[k] = t);
  },
  updateRings(show) {
    const v = [0, 0, 0];
    for (const [id, s] of this.rings) s.visible = false;
    if (!show) return;
    for (const [id, c] of this.charge) {
      if (c.t <= 0) continue;
      const r = Net.remotes.get(id); if (!r) continue;
      let s = this.rings.get(id);
      if (!s) { s = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, depthWrite: false, transparent: true, fog: false })); s.scale.set(1.6, 1.6, 1); Game.scene.add(s); this.rings.set(id, s); }
      const k = Math.min(20, Math.round(c.t / HIDE_FIND_T * 20));
      const tex = this.ringTex(k);
      if (s.material.map !== tex) { s.material.map = tex; s.material.needsUpdate = true; }
      s.visible = true;
      r.car.toWorld(0, 2.2, 0, v); s.position.set(v[0], v[1], v[2]);
    }
  },
  clearSprites() {
    for (const s of this.rings.values()) Game.scene.remove(s);
    for (const b of this.beacons.values()) Game.scene.remove(b);
    this.rings.clear(); this.beacons.clear();
  },
  // a keresők elől elrejtett névfelirat
  hideLabel(id) { return this.on() && this.isSeeker(Net.myId) && this.isHider(id); }
};
