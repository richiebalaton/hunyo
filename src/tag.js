'use strict';
// ============================================================
//  HUNYÓ – Fogócska játékmód (online, 2–6 fő)
//  Minden döntést (kör, fogó, átadás, pontok) a házigazda hoz, és a Room 'g' üzenetében szétküldi.
//  A lobbit, a módot és a kör hosszát a Room (lobby.js) kezeli; a Tag csak a futó kört.
//  A kliensek csak megjelenítenek. Időket a hátralévő másodpercekkel küldjük, így az órák eltérése nem számít.
// ============================================================
const TAG_LENS = [120, 180, 300];
const TAG_COUNT = 3, TAG_RES = 8, TAG_IMMUNE = 3, TAG_XFER_GAP = 0.6;
const TAG_REFILL_MUL = 1.5;      // a fogónál a hideggáz ennyiszer gyorsabban töltődik
const TAG_CAR_DMG_MUL = 0.5;     // fogócskában az autók egymás közti ütközése ennyiszeres sérülést okoz

const Tag = {
  phase: 'off',          // off | count | play | res
  endAt: 0, it: -1, prevIt: -1, immuneUntil: 0, lastXfer: 0,
  times: {}, results: null, syncT: 0, xfer: 0,
  markers: new Map(),

  now() { return performance.now() / 1000; },
  get mode() { return Room.mode; },
  get len() { return Room.len; },
  on() { return Net.active && Room.mode === 'tag' && Room.phase === 'game'; },
  inPart(id) { return Room.part.includes(id) && Net.players.has(id); },
  name(id) { const p = Net.players.get(id); return p ? p.name : '?'; },

  // ---- házigazda
  stop() { this.phase = 'off'; this.it = -1; this.prevIt = -1; this.results = null; this.times = {}; },
  start(part) { this.startRound(part); },
  startRound(part) {
    this.times = {};
    for (const id of part) this.times[id] = 0;
    const ids = [...part];
    this.it = ids[Math.floor(Math.random() * ids.length)];
    this.prevIt = -1; this.immuneUntil = 0; this.results = null;
    this.phase = 'count'; this.endAt = this.now() + TAG_COUNT;
    this.broadcast();
  },
  hostTick(dt) {
    if (!Net.host || this.mode !== 'tag' || Room.phase !== 'game') return;
    const now = this.now();
    if (this.phase === 'count') { if (now >= this.endAt) { this.phase = 'play'; this.endAt = now + this.len; this.lastXfer = now; this.broadcast(); } return; }
    if (this.phase === 'play') {
      if (!this.inPart(this.it)) this.pickNewIt();
      this.times[this.it] = (this.times[this.it] || 0) + dt;
      // átadás: a fogó autója hozzáér valakihez (a házigazda nézete szerint)
      if (now - this.lastXfer > TAG_XFER_GAP && !this.isWrecked(this.it)) {
        const A = this.carOf(this.it);
        if (A) for (const id of Room.part) {
          if (id === this.it || !this.inPart(id)) continue;
          const B = this.carOf(id);
          if (B && carsTouch(A, B)) { this.claim(this.it, id); break; }
        }
      }
      if (now >= this.endAt) this.endRound();
      this.syncT -= dt;
      if (this.syncT <= 0) { this.syncT = 1; this.broadcast(); }
      return;
    }
    if (this.phase === 'res' && now >= this.endAt) Room.toLobby();
  },
  // érintés-bejelentés: bármelyik gép jelezheti, a házigazda ellenőrzi és dönt
  claim(a, b) {
    if (!Net.host || this.phase !== 'play') return false;
    const now = this.now();
    if (a !== this.it || b === a || !this.inPart(b)) return false;
    if (now - this.lastXfer < TAG_XFER_GAP) return false;
    if (this.isWrecked(a) || this.isWrecked(b)) return false;
    if (b === this.prevIt && now < this.immuneUntil) return false;
    const A = this.carOf(a), B = this.carOf(b);
    if (!A || !B || Math.hypot(A.c[0] - B.c[0], A.c[2] - B.c[2]) > 40) return false;
    this.transfer(b);
    return true;
  },
  // a saját gépen észlelt érintés (pontosabb, mert a saját autó nem késik)
  localCheck(dt) {
    this._cq = (this._cq || 0) - dt;
    if (!this.on() || this.phase !== 'play' || this._cq > 0) return;
    const me = Game.cars[0]; if (!me || me.wrecked) return;
    const now = this.now(), my = Net.myId;
    if (!Room.part.includes(my)) return;
    const send = (a, b) => {
      this._cq = 0.25;
      if (Net.host) this.claim(a, b);
      else if (Net.hostConn && Net.hostConn.open) { try { Net.hostConn.send({ t: 'tq', a, b }); } catch (e) { } }
    };
    const touched = (id, r) => (me.lastTouch === id && now - me.lastTouchT < 0.35) || carsTouch(me, r.car);
    if (this.it === my) {
      for (const [id, r] of Net.remotes) {
        if (!Room.part.includes(id) || r.wrecked || (id === this.prevIt && now < this.immuneUntil)) continue;
        if (touched(id, r)) { send(my, id); return; }
      }
    } else {
      const r = Net.remotes.get(this.it);
      if (r && !r.wrecked && !(my === this.prevIt && now < this.immuneUntil) && touched(this.it, r)) send(this.it, my);
    }
  },
  transfer(id) {
    const now = this.now();
    this.prevIt = this.it; this.it = id; this.immuneUntil = now + TAG_IMMUNE; this.lastXfer = now;
    this.xfer++;
    this.broadcast();
    this.onTransfer(this.prevIt, id);
  },
  pickNewIt() {
    const ids = Room.part.filter(i => i !== this.it && Net.players.has(i));
    this.prevIt = -1;
    this.it = ids.length ? ids[Math.floor(Math.random() * ids.length)] : -1;
    this.xfer++;
    this.broadcast();
    if (this.it >= 0) this.onTransfer(-1, this.it);
  },
  endRound() {
    const list = Room.part.filter(id => Net.players.has(id)).map(id => ({ id, name: this.name(id), t: +(this.times[id] || 0).toFixed(1) })).sort((a, b) => a.t - b.t);
    this.results = list;
    this.phase = 'res'; this.endAt = this.now() + TAG_RES; this.it = -1;
    this.broadcast();
  },
  // késő belépő: a lobbiban vár (Room kezeli), a futó körbe nem kerül be
  onLeave(id) {
    if (!Net.host || this.mode !== 'tag') return;
    delete this.times[id];
    if (id === this.it && this.phase === 'play') this.pickNewIt();
    else this.broadcast();
  },
  carOf(id) {
    if (id === Net.myId) return Game.cars[0] || null;
    const r = Net.remotes.get(id); return r ? r.car : null;
  },
  isWrecked(id) {
    if (id === Net.myId) return !!(Game.cars[0] && Game.cars[0].wrecked);
    const r = Net.remotes.get(id); return !!(r && r.wrecked);
  },
  snapshot() {
    const now = this.now(), tm = {};
    for (const k in this.times) tm[k] = +this.times[k].toFixed(1);
    return { ph: this.phase, rem: +Math.max(0, this.endAt - now).toFixed(2), it: this.it, pv: this.prevIt,
      im: +Math.max(0, this.immuneUntil - now).toFixed(2), tm, res: this.results, x: this.xfer };
  },
  broadcast() { Room.broadcast(); },

  // ---- kliens
  apply(d) {
    const now = this.now(), oldIt = this.it, oldX = this.xfer;
    this.phase = d.ph; this.endAt = now + d.rem;
    this.it = d.it; this.prevIt = d.pv; this.immuneUntil = now + d.im;
    this.times = {}; for (const k in d.tm) this.times[k] = d.tm[k];
    this.results = d.res; this.xfer = d.x;
    if (d.x !== oldX && this.phase === 'play' && d.it >= 0 && d.it !== oldIt) this.onTransfer(oldIt, d.it);
  },
  reset() { this.phase = 'off'; this.it = -1; this.times = {}; this.results = null; this.clearMarkers(); },

  // ---- megjelenítés
  onTransfer(from, to) {
    const me = Net.myId;
    UI.toast(0, (to === me ? 'TE vagy a fogó!' : this.name(to) + ' lett a fogó'));
    if (typeof Sound !== 'undefined') { Sound.blip(to === me ? 330 : 880, 0.09); setTimeout(() => Sound.blip(to === me ? 220 : 1320, 0.12), 110); }
    if (to === me || from === me) UI.flash(to === me ? 'rgba(255,40,40,0.55)' : 'rgba(85,255,255,0.45)');
    const c = this.carOf(to);
    if (c && Game.particles) for (let k = 0; k < 30; k++) {
      const a = Math.random() * 6.28;
      Game.particles.emit(c.c[0], c.c[1] + 0.5, c.c[2], Math.cos(a) * 6, 2 + Math.random() * 4, Math.sin(a) * 6, 0xff4040, 0.3, 0.7, 1, 0.5, 4);
    }
  },
  marker(id) {
    let m = this.markers.get(id);
    if (m) return m;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex(true), color: 0xff3030, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, fog: false, opacity: 0 }));
    halo.scale.set(9, 9, 1);
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 80;
    const x = cv.getContext('2d');
    x.fillStyle = 'rgba(200,0,0,0.85)'; x.fillRect(20, 8, 216, 64);
    x.strokeStyle = '#ffff55'; x.lineWidth = 5; x.strokeRect(20, 8, 216, 64);
    x.fillStyle = '#ffffff'; x.font = 'bold 46px "Lucida Console", Consolas, monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('FOGÓ', 128, 42);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, fog: false }));
    label.scale.set(2.6, 0.8, 1);
    Game.scene.add(halo); Game.scene.add(label);
    m = { halo, label }; this.markers.set(id, m);
    return m;
  },
  clearMarkers() {
    for (const m of this.markers.values()) { Game.scene.remove(m.halo); Game.scene.remove(m.label); m.label.material.map.dispose(); }
    this.markers.clear();
  },
  update(dt) {
    if (!Net.active) { if (this.markers.size) this.clearMarkers(); UI.tagHud(null); return; }
    if (Net.host) this.hostTick(dt);
    this.localCheck(dt);
    const t = this.now(), v = [0, 0, 0];
    for (const [id, m] of this.markers) if (id !== this.it || !this.on() || this.phase !== 'play') { m.halo.visible = false; m.label.visible = false; }
    if (this.on() && this.phase === 'play' && this.it >= 0) {
      const c = this.carOf(this.it);
      if (c) {
        const m = this.marker(this.it);
        m.halo.visible = m.label.visible = true;
        const pulse = 0.5 + 0.5 * Math.sin(t * 7);
        c.toWorld(0, 0.2, 0, v); m.halo.position.set(v[0], v[1], v[2]);
        m.halo.material.opacity = 0.25 + pulse * 0.4; const s = 7 + pulse * 3; m.halo.scale.set(s, s, 1);
        c.toWorld(0, this.it === Net.myId ? 1.9 : 2.5, 0, v); m.label.position.set(v[0], v[1], v[2]);
      }
    }
    // kiegyenlítés: a fogó gyorsabban tölti a hideggázt; autó–autó sérülés felezése
    const me = Game.cars[0];
    if (me) {
      me.refillMul = this.on() && this.phase === 'play' && this.it === Net.myId ? TAG_REFILL_MUL : 1;
      me.carDmgMul = Net.active && Room.mode === 'tag' ? TAG_CAR_DMG_MUL : 1;
    }
    UI.tagHud(this.on() && this.phase !== 'off' ? this : null);
  }
};

// két autó érintkezik-e (bármelyik csomópont a másik dobozában, 0,25 m ráhagyással)
function carsTouch(A, B) {
  if (Math.hypot(A.c[0] - B.c[0], A.c[1] - B.c[1], A.c[2] - B.c[2]) > 7) return false;
  for (const [P, Q] of [[A, B], [B, A]]) {
    const hx = Q.spec.len / 2 + 0.4, hy = Q.spec.h / 2 + 0.4, hz = Q.spec.wid / 2 + 0.4;
    for (let i = 0; i < 16; i++) {
      const dx = P.x[i] - Q.c[0], dy = P.y[i] - Q.c[1], dz = P.z[i] - Q.c[2];
      if (Math.abs(dx * Q.f[0] + dy * Q.f[1] + dz * Q.f[2]) < hx && Math.abs(dx * Q.u[0] + dy * Q.u[1] + dz * Q.u[2]) < hy && Math.abs(dx * Q.r[0] + dy * Q.r[1] + dz * Q.r[2]) < hz) return true;
    }
  }
  return false;
}
