'use strict';
// ============================================================
//  HUNYÓ – online játék (WebRTC P2P a PeerJS-en keresztül, max 6 fő)
//  Csillag topológia: a szoba létrehozója a házigazda, ő továbbítja az állapotokat.
//  Mindenki a saját autóját számolja, a többiek autója interpolált "szellem".
// ============================================================
const NET_MAX = 6;
const NET_RATE = 1 / 15;
const NET_DELAY = 0.12;
const PEERJS_URL = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
const PEER_PREFIX = 'terep30-v1-';

function netCode() {
  const ch = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = '';
  for (let i = 0; i < 5; i++) s += ch[Math.floor(Math.random() * ch.length)];
  return s;
}
function loadPeerJS() {
  if (window.Peer) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = PEERJS_URL; s.onload = () => res(); s.onerror = () => rej(new Error('A PeerJS nem töltődött be (nincs internet?)'));
    document.head.appendChild(s);
  });
}

const Net = {
  active: false, host: false, code: '', myId: 0, name: '',
  peer: null, conns: new Map(), hostConn: null,
  players: new Map(),   // id -> {id, name, conn?}
  remotes: new Map(),   // id -> {car, view, label, buf:[], name, wrecked}
  sendT: 0, pendDents: [], pendTrees: [],
  onStatus: null,

  status(msg, err) { if (this.onStatus) this.onStatus(msg, err); },

  async hostRoom(name, mode, len) {
    this.name = name; this._mode = mode || this._mode || 'free'; this._len = len || this._len || 180;
    try { await loadPeerJS(); } catch (e) { this.status(e.message, true); return false; }
    this.code = netCode();
    this.status('Szoba létrehozása…');
    return new Promise(resolve => {
      const peer = this.peer = new Peer(PEER_PREFIX + this.code, Object.assign({ debug: 0 }, window.T30_PEER || {}));
      peer.on('open', () => {
        this.active = true; this.host = true; this.myId = 0;
        this.players.clear(); this.players.set(0, { id: 0, name });
        Room.hostSetup(this._mode, this._len);
        this.status('Szoba kész: ' + this.code);
        resolve(true);
      });
      peer.on('connection', conn => this._hostAccept(conn));
      peer.on('error', e => {
        if (e.type === 'unavailable-id') { peer.destroy(); this.hostRoom(name, this._mode, this._len).then(resolve); return; }
        this.status('Hálózati hiba: ' + (e.type || e.message), true);
        if (!this.active) resolve(false);
      });
      peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { } });
    });
  },
  _hostAccept(conn) {
    conn.on('open', () => {
      conn.on('data', d => this._hostData(conn, d));
      conn.on('close', () => this._dropConn(conn));
      conn.on('error', () => this._dropConn(conn));
    });
  },
  _freeId() { for (let i = 1; i < NET_MAX; i++) if (!this.players.has(i)) return i; return -1; },
  _hostData(conn, d) {
    if (d.t === 'hello') {
      const id = this._freeId();
      if (id < 0) { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 300); return; }
      conn.netId = id;
      const name = String(d.name || 'Játékos').slice(0, 16);
      this.players.set(id, { id, name, conn });
      this.conns.set(id, conn);
      const list = [...this.players.values()].map(p => ({ id: p.id, name: p.name }));
      conn.send({ t: 'welcome', id, map: Game.cfg.map, seed: Game.cfg.seed, players: list, trees: this._downTrees(), g: Room.snapshot() });
      this._broadcast({ t: 'join', id, name }, id);
      this.addRemote(id, name);
      Room.onJoin(id);
      UI.toast(0, name + ' csatlakozott');
      UI.netList();
      return;
    }
    const id = conn.netId;
    if (id === undefined) return;
    if (d.t === 's') {
      d.id = id;
      const p = this.players.get(id); if (p) p.last = d;
      this._recvState(d);
    } else if (d.t === 'e') {
      d.id = id;
      this._broadcast(d, id);
      this._recvEvent(d);
    } else if (d.t === 'tq') {
      // csak a saját autóját érintő érintést jelezhet
      if (d.a === id || d.b === id) Tag.claim(d.a, d.b);
    } else if (d.t === 'hq') {
      if (d.a === id || d.b === id) Hide.claim(d.a, d.b);
    } else if (d.t === 'rdy') {
      Room.setReady(id, !!d.v);
    } else if (d.t === 'out') {
      // víz alatti zárlat: csak a saját autójáról jelezhet
      Hide.eliminate(id);
    }
  },
  _downTrees() { const out = []; Game.world.trees.forEach((t, i) => { if (t.down) out.push(i); }); return out; },
  _dropConn(conn) {
    const id = conn.netId;
    if (id === undefined || !this.players.has(id)) return;
    const name = this.players.get(id).name;
    this.players.delete(id); this.conns.delete(id);
    this.removeRemote(id);
    this._broadcast({ t: 'leave', id });
    Room.onLeave(id);
    UI.toast(0, name + ' kilépett');
    UI.netList();
  },
  sendHost(msg) { if (this.hostConn && this.hostConn.open) { try { this.hostConn.send(msg); } catch (e) { } } },
  _broadcast(msg, exceptId) {
    for (const [id, c] of this.conns) if (id !== exceptId && c.open) { try { c.send(msg); } catch (e) { } }
  },

  async joinRoom(code, name) {
    this.name = name;
    code = String(code || '').trim().toUpperCase();
    if (code.length < 4) { this.status('Írd be a szoba kódját', true); return false; }
    try { await loadPeerJS(); } catch (e) { this.status(e.message, true); return false; }
    this.status('Kapcsolódás a ' + code + ' szobához…');
    return new Promise(resolve => {
      const peer = this.peer = new Peer(Object.assign({ debug: 0 }, window.T30_PEER || {}));
      let done = false;
      const fail = (m) => { if (done) return; done = true; this.status(m, true); try { peer.destroy(); } catch (e) { } resolve(false); };
      const to = setTimeout(() => fail('Nem sikerült kapcsolódni. Jó a kód? Fut még a szoba?'), 12000);
      peer.on('open', () => {
        const conn = this.hostConn = peer.connect(PEER_PREFIX + code, { serialization: 'json', reliable: true });
        conn.on('open', () => conn.send({ t: 'hello', name }));
        conn.on('data', d => {
          if (d.t === 'full') { clearTimeout(to); fail('A szoba megtelt (max ' + NET_MAX + ' fő)'); return; }
          if (d.t === 'welcome' && !done) {
            clearTimeout(to); done = true;
            this.active = true; this.host = false; this.myId = d.id; this.code = code;
            this.players.clear();
            for (const p of d.players) this.players.set(p.id, p);
            this._welcome = d;
            if (d.g) Room.apply(d.g);
            resolve(true);
            return;
          }
          this._clientData(d);
        });
        conn.on('close', () => { if (this.active) this.lost('A házigazda kilépett'); });
        conn.on('error', () => { if (this.active) this.lost('Megszakadt a kapcsolat'); });
      });
      peer.on('error', e => {
        if (e.type === 'peer-unavailable') fail('Nincs ilyen szoba: ' + code);
        else fail('Hálózati hiba: ' + (e.type || e.message));
      });
    });
  },
  // a világ felépítése után hívjuk: a többiek autóinak létrehozása
  afterStart() {
    if (!this.active) return;
    if (!this.host && this._welcome) {
      for (const p of this._welcome.players) if (p.id !== this.myId) this.addRemote(p.id, p.name);
      for (const i of this._welcome.trees || []) { const t = Game.world.trees[i]; if (t) { t.down = true; t.fallYaw = 0; } }
      this._welcome = null;
    }
    UI.netList();
  },
  _clientData(d) {
    if (d.t === 'b') { for (const s of d.s) this._recvState(s); }
    else if (d.t === 'g') { Room.apply(d); UI.netList(); }
    else if (d.t === 'e') this._recvEvent(d);
    else if (d.t === 'join') { this.players.set(d.id, { id: d.id, name: d.name }); this.addRemote(d.id, d.name); UI.toast(0, d.name + ' csatlakozott'); UI.netList(); }
    else if (d.t === 'leave') { const p = this.players.get(d.id); this.players.delete(d.id); this.removeRemote(d.id); if (p) UI.toast(0, p.name + ' kilépett'); UI.netList(); }
  },
  lost(msg) {
    this.leave();
    Game.toMenu();
    UI.netOpen(msg, true);
  },
  leave() {
    this.active = false;
    for (const id of [...this.remotes.keys()]) this.removeRemote(id);
    try { if (this.peer) this.peer.destroy(); } catch (e) { }
    this.peer = null; this.hostConn = null; this.conns.clear(); this.players.clear();
    this.pendDents = []; this.pendTrees = [];
    Room.reset();
  },

  // ---- távoli autók
  addRemote(id, name) {
    if (id === this.myId || this.remotes.has(id) || !Game.world || Game.state !== 'play') return;
    const car = new Car(SPECS.raketa, Game.world);
    const st = spawnPoint(Game.world, id);
    car.reset(st.x, st.z, st.yaw);
    const view = new CarView(Game.scene, car, id, null);
    const label = makeLabel(name, id);
    Game.scene.add(label);
    this.remotes.set(id, { id, car, view, label, buf: [], name, wrecked: false, voice: Sound.makeRemoteVoice() });
  },
  removeRemote(id) {
    const r = this.remotes.get(id); if (!r) return;
    if (r.voice) Sound.killVoice(r.voice);
    r.view.dispose(); Game.scene.remove(r.label); r.label.material.map.dispose(); r.label.material.dispose();
    this.remotes.delete(id);
  },
  _recvState(s) {
    if (s.id === this.myId) return;
    let r = this.remotes.get(s.id);
    if (!r) { const p = this.players.get(s.id); this.addRemote(s.id, p ? p.name : 'Játékos'); r = this.remotes.get(s.id); if (!r) return; }
    if (s.q !== undefined && r.lastQ !== undefined && s.q <= r.lastQ) return;
    r.lastQ = s.q;
    s.rt = performance.now() / 1000;
    // teleport (újraindulás, kör eleje): nem interpolálunk végig a pályán, és rövid ideig nem ütközik
    const pv = r.buf[r.buf.length - 1];
    if (pv && Math.hypot(s.c[0] - pv.c[0], s.c[1] - pv.c[1], s.c[2] - pv.c[2]) > 10) { r.buf.length = 0; r.guard = 1.0; }
    r.buf.push(s);
    if (r.buf.length > 12) r.buf.shift();
  },
  _recvEvent(d) {
    const r = this.remotes.get(d.id);
    if (d.dn && r) for (const x of d.dn) r.car.dents.push({ lx: x[0], ly: x[1], lz: x[2], nx: x[3], ny: x[4], nz: x[5], amt: x[6], vis: x[7] || x[6], iv: x[8] || 0 });
    if (d.tr) for (const i of d.tr) { const t = Game.world.trees[i]; if (t && !t.down) { t.down = true; t.fallYaw = d.fy || 0; } }
    if (d.rp && r) { r.car.dents.length = 0; r.car.repairs++; }
    if (d.wk && r) remoteWreckFx(r.car);
  },

  // ---- saját állapot küldése, távoliak frissítése (képkockánként)
  update(dt, car) {
    if (!this.active) return;
    if (car) {
      // események: horpadások, kidőlt fák, javítás, totálkár
      if (car._netRep !== car.repairs) { car._netRep = car.repairs; this._sendEvent({ rp: 1 }); }
      if (car._netWreck !== !!car.wrecked) { car._netWreck = !!car.wrecked; if (car.wrecked) this._sendEvent({ wk: 1 }); }
    }
    this.sendT -= dt;
    if (car && this.sendT <= 0) {
      this.sendT = NET_RATE;
      const st = this._pack(car);
      if (this.host) {
        // csomag minden kliensnek: mindenki más legutóbbi állapota
        st.id = 0;
        const all = [st];
        for (const p of this.players.values()) if (p.id !== 0 && p.last) all.push(p.last);
        for (const [id, c] of this.conns) if (c.open) { try { c.send({ t: 'b', s: all.filter(x => x.id !== id) }); } catch (e) { } }
      } else if (this.hostConn && this.hostConn.open) {
        try { this.hostConn.send(st); } catch (e) { }
      }
    }
    // távoli autók interpolálása
    const now = performance.now() / 1000 - NET_DELAY;
    for (const r of this.remotes.values()) { if (r.guard > 0) r.guard -= dt; this._interp(r, now, dt); }
    // a második (helyben nem használt) fényszórópár a legközelebbi, égő lámpájú távoli autóé
    const spot = Game.headlights && Game.headlights[1];
    let best = null, bd = 150;
    const ref = Game.camTarget ? Game.camTarget() : car;
    if (spot && ref) for (const r of this.remotes.values()) {
      if (Room.spectator(r.id)) continue;
      const st = r.view.lampState(); if (!st[0] && !st[1]) continue;
      const d = Math.hypot(r.car.c[0] - ref.c[0], r.car.c[2] - ref.c[2]);
      if (d < bd) { bd = d; best = r; }
    }
    for (const r of this.remotes.values()) r.view.setSpot(r === best ? spot : null);
    // térhatású hang a távoli autóknak
    for (const r of this.remotes.values()) Sound.updateRemoteVoice(r.voice, r.car, dt, Room.spectator(r.id) || Game.paused ? 0 : 1);
  },
  // horpadás/fa események gyűjtése a saját autóból
  noteDent(d) { this.pendDents.push([+d.lx.toFixed(2), +d.ly.toFixed(2), +d.lz.toFixed(2), +d.nx.toFixed(2), +d.ny.toFixed(2), +d.nz.toFixed(2), +d.amt.toFixed(3), +(d.vis || d.amt).toFixed(3), Math.round(d.iv || 0)]); },
  noteTree(t) { const i = Game.world.trees.indexOf(t); if (i >= 0) { this.pendTrees.push(i); this._treeYaw = t.fallYaw || 0; } },
  flushEvents() {
    if (!this.active) return;
    if (this.pendDents.length || this.pendTrees.length) {
      this._sendEvent({ dn: this.pendDents.length ? this.pendDents : undefined, tr: this.pendTrees.length ? this.pendTrees : undefined, fy: this._treeYaw });
      this.pendDents = []; this.pendTrees = [];
    }
  },
  _sendEvent(o) {
    const m = Object.assign({ t: 'e' }, o);
    if (this.host) { m.id = 0; this._broadcast(m); }
    else if (this.hostConn && this.hostConn.open) { try { this.hostConn.send(m); } catch (e) { } }
  },
  _pack(car) {
    car.frame();
    const c = car.c, n = [];
    for (let i = 0; i < 16; i++) n.push(Math.round((car.x[i] - c[0]) * 100), Math.round((car.y[i] - c[1]) * 100), Math.round((car.z[i] - c[2]) * 100));
    const w = [];
    for (const wh of car.wheels) w.push(Math.round(wh.t * 1000), Math.round((wh.steer || 0) * 100), Math.round((wh.spinRate || 0) * 10));
    this.seq = (this.seq || 0) + 1;
    return {
      t: 's', q: this.seq, c: [+c[0].toFixed(3), +c[1].toFixed(3), +c[2].toFixed(3)], n, w,
      v: [+car.v[0].toFixed(2), +car.v[1].toFixed(2), +car.v[2].toFixed(2)],
      fx: [+car.fxBoost.toFixed(2), +Math.min(1.5, car.fxUp).toFixed(2), car.fxAtt ? 1 : 0, car.suctionOn ? 1 : 0, car.contacts, car.lampsOff ? 1 : 0],
      wr: car.wrecked ? 1 : 0, dm: +car.damage().toFixed(2),
    };
  },
  _interp(r, now, dt) {
    const b = r.buf, car = r.car;
    if (!b.length) return;
    let a = b[0], c = b[b.length - 1], k = 0;
    for (let i = 0; i < b.length - 1; i++) if (b[i].rt <= now && b[i + 1].rt >= now) { a = b[i]; c = b[i + 1]; k = (now - a.rt) / Math.max(1e-3, c.rt - a.rt); break; }
    if (now > c.rt) { a = c; k = 0; }
    const ext = now > c.rt ? Math.min(0.25, now - c.rt) : 0;
    const L = (p, q) => p + (q - p) * k;
    const cx = L(a.c[0], c.c[0]) + a.v[0] * ext, cy = L(a.c[1], c.c[1]) + a.v[1] * ext, cz = L(a.c[2], c.c[2]) + a.v[2] * ext;
    for (let i = 0; i < 16; i++) {
      car.x[i] = cx + L(a.n[i * 3], c.n[i * 3]) / 100;
      car.y[i] = cy + L(a.n[i * 3 + 1], c.n[i * 3 + 1]) / 100;
      car.z[i] = cz + L(a.n[i * 3 + 2], c.n[i * 3 + 2]) / 100;
      car.vx[i] = L(a.v[0], c.v[0]); car.vy[i] = L(a.v[1], c.v[1]); car.vz[i] = L(a.v[2], c.v[2]);
    }
    car.wheels.forEach((wh, j) => { wh.t = L(a.w[j * 3], c.w[j * 3]) / 1000; wh.steer = L(a.w[j * 3 + 1], c.w[j * 3 + 1]) / 100; wh.spinRate = c.w[j * 3 + 2] / 10; });
    car.fxBoost = c.fx[0]; car.fxUp = c.fx[1]; car.fxAtt = c.fx[2]; car.suctionOn = !!c.fx[3]; car.contacts = c.fx[4]; car.lampsOff = !!c.fx[5];
    r.wrecked = !!c.wr; car.wrecked = r.wrecked; car.netDamage = c.dm || 0;
    car.frame();
    car.speed = Math.hypot(car.v[0], car.v[1], car.v[2]);
    // néző (kör közben belépett) autója rejtve; bújócskában a keresők nem látják a bújók nevét
    const spect = Room.spectator(r.id);
    r.view.setVisible(!spect);
    r.view.update(dt);
    car.toWorld(0, 1.6, 0, Net._v);
    r.label.position.set(Net._v[0], Net._v[1], Net._v[2]);
    r.label.visible = !spect && !Hide.hideLabel(r.id);
    if (c.wr && Math.random() < 0.6) Game.particles.emit(car.c[0], car.c[1] + 0.6, car.c[2], (Math.random() - 0.5), 1.8, (Math.random() - 0.5), 0x23252c, 1.2, 2.2, 0.5, 1.6, -0.5);
  },
  _v: [0, 0, 0],
};

// kezdőpont: minden azonosítónak saját sávja van (így a kör elején egyszerre visszaálló autók nem
// kerülnek egymásra); ha a sáv első helyén autó áll (avoid: autók listája), a sáv következő sorát adja
const SPAWN_LANES = [-12, 16, -4, 8, -18, 22], SPAWN_ROWS = [-82, -72, -92, -62];
function spawnPoint(W, id, avoid) {
  const lane = SPAWN_LANES[id % 6];
  let first = null;
  for (const back of SPAWN_ROWS) {
    const [x, z] = W.fromZone(back, lane);
    const p = { x, z, yaw: W.zone.yaw };
    if (!first) first = p;
    if (!avoid || !avoid.some(c => Math.hypot(c.c[0] - x, c.c[2] - z) < 6 && Math.abs(c.c[1] - W.heightAt(x, z)) < 6)) return p;
  }
  return first;
}
function makeLabel(name, id) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 96;
  const x = cv.getContext('2d');
  x.font = 'bold 54px "Lucida Console", Consolas, "DejaVu Sans Mono", monospace';
  const w = Math.min(500, x.measureText(name).width + 40);
  x.fillStyle = 'rgba(0,0,170,0.78)'; x.fillRect((512 - w) / 2, 10, w, 76);
  x.strokeStyle = NET_COLORS_CSS[id % 6]; x.lineWidth = 5; x.strokeRect((512 - w) / 2, 10, w, 76);
  x.fillStyle = '#ffffff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(name, 256, 50);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, fog: false }));
  s.scale.set(4, 0.75, 1);
  return s;
}
const NET_COLORS_CSS = ['#f3f3f0', '#55ffff', '#ff5555', '#ffff55', '#ff55ff', '#55ff55'];
function remoteWreckFx(car) {
  const P = Game.particles, c = car.c;
  for (let k = 0; k < 90; k++) {
    const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2, sp = 6 + Math.random() * 12;
    P.emit(c[0], c[1] + 0.3, c[2], Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 3, Math.sin(a) * Math.cos(e) * sp, k % 3 === 0 ? 0xffb347 : (k % 3 === 1 ? 0x9fe8ff : 0xffffff), 0.16 + Math.random() * 0.12, 0.6 + Math.random() * 0.8, 1, 0, 9);
  }
  Sound.crash(0.6);
}
// egyoldalú ütközés: a saját autót eltolja a távoli autó dobozából
function carPushFrom(P, Q, qid) {
  if (Math.abs(P.c[0] - Q.c[0]) > 8 || Math.abs(P.c[2] - Q.c[2]) > 8 || Math.abs(P.c[1] - Q.c[1]) > 8) return;
  const hx = Q.spec.len / 2, hy = Q.spec.h / 2 + 0.05, hz = Q.spec.wid / 2, r = P.spec.nodeR;
  let best = 0, bi = -1, bn = null;
  for (let i = 0; i < 16; i++) {
    const dx = P.x[i] - Q.c[0], dy = P.y[i] - Q.c[1], dz = P.z[i] - Q.c[2];
    const lf = dx * Q.f[0] + dy * Q.f[1] + dz * Q.f[2], lu = dx * Q.u[0] + dy * Q.u[1] + dz * Q.u[2], lr = dx * Q.r[0] + dy * Q.r[1] + dz * Q.r[2];
    const pf = hx + r - Math.abs(lf), pu = hy + r - Math.abs(lu), pr = hz + r - Math.abs(lr);
    if (pf <= 0 || pu <= 0 || pr <= 0) continue;
    let n, pen;
    if (pf < pu && pf < pr) { n = Q.f; pen = pf * Math.sign(lf); } else if (pu < pr) { n = Q.u; pen = pu * Math.sign(lu); } else { n = Q.r; pen = pr * Math.sign(lr); }
    pen = Math.max(-0.03, Math.min(0.03, pen));
    P.x[i] += n[0] * pen; P.y[i] += n[1] * pen; P.z[i] += n[2] * pen;
    P._carHitT = 6; P.lastTouch = qid; P.lastTouchT = performance.now() / 1000;
    // ütközési sebesség a másik autóhoz képest (horpadáshoz)
    const sg = Math.sign(pen) || 1;
    const iv = -((P.vx[i] - Q.v[0]) * n[0] + (P.vy[i] - Q.v[1]) * n[1] + (P.vz[i] - Q.v[2]) * n[2]) * sg;
    if (iv > best) { best = iv; bi = i; bn = [n[0] * sg, n[1] * sg, n[2] * sg]; }
  }
  if (best > 5 && bi >= 0 && !(P._carDentT > 0)) { P._carDentT = 0.25; P.addDent(P.lx[bi], P.ly[bi], P.lz[bi], bn[0], bn[1], bn[2], best, P.carDmgMul || 1); }
}
