'use strict';
// ============================================================
//  HUNYÓ – Falcon 9 indítóállás a pálya szélén
//  Ciklus (210 s, a valós órához kötve, így online is mindenkinél egyszerre):
//  fokozat felhelyezése → tankolás → visszaszámlálás → indítás → MECO,
//  fokozatleválás → a gyorsítórakéta visszatér és leszáll → újra.
// ============================================================
const L_CYCLE = 210, L_IGN = 60, L_MECO = 96, L_LAND = 148;
const L_BOOST = 42, L_STAGE = 25, L_MOUNT = 1.5;

const smoothK = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function keyInterp(keys, t) {
  if (t <= keys[0][0]) return keys[0].slice(1);
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t <= b[0]) { const k = smoothK(a[0], b[0], t); return a.slice(1).map((v, j) => v + (b[j + 1] - v) * k); }
  }
  return keys[keys.length - 1].slice(1);
}
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

class LaunchView {
  constructor(parent, world) {
    this.world = world; const P = this.P = world.pad;
    const g = this.group = new THREE.Group();
    g.matrixAutoUpdate = false;
    g.matrix.makeBasis(new THREE.Vector3(P.dx, 0, P.dz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(P.sx, 0, P.sz)).setPosition(P.x, P.h, P.z);
    parent.add(g);
    this.offset = 0;
    this.build();
    this.lastText = ''; this.boomed = -1; this.rumbled = -1; this.prevT = -1;
    this._v = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._up = new THREE.Vector3(0, 1, 0);
  }
  build() {
    const g = this.group;
    const lam = (opts) => new THREE.MeshLambertMaterial(Object.assign({ vertexColors: true, flatShading: true }, opts));
    // betonlap, indítóállvány
    const pad = new GB();
    pad.box(0, -0.13, 0, 30, 0.3, 30, 0x6f6c68, 0x8b8782);
    pad.box(0, 0.03, 0, 30, 0.02, 4, 0x24252a);
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; pad.box(Math.cos(a) * 9, 0.04, Math.sin(a) * 9, 1.2, 0.02, 1.2, 0xf2c230); }
    pad.box(0, L_MOUNT / 2, 0, 6.5, L_MOUNT, 6.5, 0x2c2f35);
    pad.box(0, 1.2, 28, 5.2, 2.4, 5.2, 0x2c2f35);
    const pm = new THREE.Mesh(pad.geometry(), lam()); pm.receiveShadow = true; pm.castShadow = true; g.add(pm);
    // torony (rácsos)
    const tw = new GB(), H = 84;
    for (const [cx, cz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) tw.box(cx, H / 2, 14 + cz, 0.4, H, 0.4, 0x3a3f48);
    for (let y = 4; y < H; y += 6) {
      tw.box(0, y, 12, 4.4, 0.3, 0.3, 0x434955); tw.box(0, y, 16, 4.4, 0.3, 0.3, 0x434955);
      tw.box(-2, y, 14, 0.3, 0.3, 4.4, 0x434955); tw.box(2, y, 14, 0.3, 0.3, 4.4, 0x434955);
    }
    tw.box(0, H + 0.5, 14, 5, 1, 5, 0x2a2e36);
    const tm = new THREE.Mesh(tw.geometry(), lam()); tm.castShadow = true; g.add(tm);
    this.redLights = [];
    for (const y of [H + 1.2, 56, 28]) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex(true), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      s.position.set(0, y, 14); s.scale.set(3, 3, 1); g.add(s); this.redLights.push(s);
    }
    // kar (forgó, emelkedő)
    this.arm = new THREE.Group();
    const ag = new GB();
    ag.box(0, 0, 0, 5.2, 2, 5.2, 0x2a2e36);
    ag.box(7.5, 0, 0, 14, 0.9, 1.1, 0xd8d2c4);
    ag.box(14, -0.9, 0, 1.2, 1.6, 3.4, 0x2a2e36);
    const am = new THREE.Mesh(ag.geometry(), lam()); am.castShadow = true;
    this.arm.add(am); this.arm.position.set(0, 60, 14); g.add(this.arm);
    // gyorsítórakéta
    this.booster = new THREE.Group();
    const bg = new GB();
    const cyl = (gb, r, y0, y1, seg, hex) => {
      for (let k = 0; k < seg; k++) {
        const a0 = k / seg * Math.PI * 2, a1 = (k + 1) / seg * Math.PI * 2, am2 = (a0 + a1) / 2;
        gb.quad([Math.cos(a0) * r, y0, Math.sin(a0) * r], [Math.cos(a1) * r, y0, Math.sin(a1) * r], [Math.cos(a1) * r, y1, Math.sin(a1) * r], [Math.cos(a0) * r, y1, Math.sin(a0) * r], hex, [Math.cos(am2), 0, Math.sin(am2)]);
      }
    };
    const disc = (gb, r, y, seg, hex, up) => { for (let k = 0; k < seg; k++) { const a0 = k / seg * Math.PI * 2, a1 = (k + 1) / seg * Math.PI * 2; gb.tri([0, y, 0], [Math.cos(a0) * r, y, Math.sin(a0) * r], [Math.cos(a1) * r, y, Math.sin(a1) * r], hex, [0, up, 0]); } };
    const R = 1.83;
    cyl(bg, R * 0.92, 0, 1.6, 12, 0x2b2d31);
    cyl(bg, R, 1.6, 38, 16, 0xeeeeea);
    cyl(bg, R, 38, L_BOOST, 16, 0x1a1b1e);
    disc(bg, R * 0.92, 0, 12, 0x15161a, -1); disc(bg, R, L_BOOST, 16, 0x1a1b1e, 1);
    for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2 + Math.PI / 4; bg.box(Math.cos(a) * (R + 0.6), 40.5, Math.sin(a) * (R + 0.6), 1.2, 0.15, 1.2, 0x55585e); }
    bg.box(0, 20, R + 0.01, 0.02, 9, 0.5, 0x1d2a4a);
    const bm = new THREE.Mesh(bg.geometry(), lam({ fog: false, emissive: 0x1a1d26 })); bm.castShadow = true;
    this.booster.add(bm);
    this.legs = [];
    for (let k = 0; k < 4; k++) {
      const piv = new THREE.Group(), a = k / 4 * Math.PI * 2;
      piv.position.set(Math.cos(a) * R, 2.2, Math.sin(a) * R); piv.rotation.y = -a;
      const lg = new GB(); lg.box(0.18, 4.6, 0, 0.36, 9.2, 0.45, 0x2b2d31);
      const lm = new THREE.Mesh(lg.geometry(), lam({ fog: false })); piv.add(lm);
      this.booster.add(piv); this.legs.push(piv);
    }
    g.add(this.booster);
    // felső fokozat + orrkúp
    this.stage = new THREE.Group();
    const sg = new GB();
    cyl(sg, R * 0.7, 0, 1.2, 10, 0x2b2d31);
    cyl(sg, R, 1.2, 12, 16, 0xeeeeea);
    cyl(sg, R, 12, 13, 16, 0x1a1b1e);
    cyl(sg, 2.6, 13, 18.5, 16, 0xf4f4f0);
    for (let k = 0; k < 16; k++) {
      const a0 = k / 16 * Math.PI * 2, a1 = (k + 1) / 16 * Math.PI * 2, am2 = (a0 + a1) / 2;
      sg.tri([Math.cos(a0) * 2.6, 18.5, Math.sin(a0) * 2.6], [Math.cos(a1) * 2.6, 18.5, Math.sin(a1) * 2.6], [0, L_STAGE, 0], 0xf4f4f0, [Math.cos(am2), 0.5, Math.sin(am2)]);
    }
    disc(sg, R * 0.7, 0, 10, 0x15161a, -1); disc(sg, 2.6, 13, 16, 0xdedcd6, -1);
    const smm = new THREE.Mesh(sg.geometry(), lam({ fog: false, emissive: 0x1a1d26 })); smm.castShadow = true;
    this.stage.add(smm); g.add(this.stage);
    // lángok
    const fg = new THREE.ConeGeometry(1, 1, 14, 1, true).translate(0, -0.5, 0);
    const fmat = (c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.bFlame = new THREE.Mesh(fg, fmat(0xffc27a)); this.bFlame.visible = false; this.booster.add(this.bFlame);
    this.bCore = new THREE.Mesh(fg, fmat(0xffffff)); this.bCore.visible = false; this.booster.add(this.bCore);
    this.sFlame = new THREE.Mesh(fg, fmat(0x9fd0ff)); this.sFlame.visible = false; this.stage.add(this.sFlame);
    const halo = (red, c, s) => { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex(red), color: c, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: 0 })); m.scale.set(s, s, 1); return m; };
    this.bGlow = halo(false, 0xffb070, 30); this.bGlow.position.set(0, -2, 0); this.booster.add(this.bGlow);
    this.sGlow = halo(false, 0xa8d4ff, 14); this.sGlow.position.set(0, -1, 0); this.stage.add(this.sGlow);
    this.jelly = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex('rgba(170,215,255,0.8)', 'rgba(120,170,255,0)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: 0 }));
    this.jelly.visible = false; g.add(this.jelly);
    // fények
    this.engLight = new THREE.PointLight(0xffa860, 0, 260, 1.5); g.add(this.engLight);
    this.flood = new THREE.SpotLight(0xdde8ff, 650, 140, 0.42, 0.5, 1.2);
    this.flood.position.set(20, 1, -18); this.flood.target.position.set(0, 32, 0); g.add(this.flood); g.add(this.flood.target);
    // visszaszámláló kijelző
    const cv = this.cv = document.createElement('canvas'); cv.width = 1024; cv.height = 420;
    this.ctx = cv.getContext('2d');
    this.tex = new THREE.CanvasTexture(cv); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 4;
    const board = new THREE.Group();
    const bgb = new GB(); bgb.box(0, 6.3, -0.15, 11.6, 5, 0.2, 0x22242a);
    board.add(new THREE.Mesh(bgb.geometry(), lam()));
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(11.2, 4.6), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    scr.position.set(0, 6.3, 0); board.add(scr);
    // a tábla a pálya közepe felé néz (lokális -x irány)
    board.position.set(26, 0, -16); board.rotation.y = Math.PI / 2;
    g.add(board);
  }
  time() { return (((Date.now() / 1000 + this.offset) % L_CYCLE) + L_CYCLE) % L_CYCLE; }
  // a gyorsítórakéta helyzete és tengelye (lokális koordinátákban)
  boosterPose(t, out) {
    if (t < L_IGN + 1 || t >= L_LAND) { out.p = [0, L_MOUNT, 0]; out.a = [0, 1, 0]; return out; }
    if (t <= L_MECO) {
      const tau = t - (L_IGN + 1);
      out.p = [0.012 * tau ** 3, L_MOUNT + 1.4 * tau * tau, 0];
      const dd = 0.036 * tau * tau, dy = 2.8 * tau + 0.01, l = Math.hypot(dd, dy);
      out.a = [dd / l, dy / l, 0];
      return out;
    }
    const m = this.mecoPt();
    const K = this.returnKeys || (this.returnKeys = [
      [L_MECO - 8, m[0] * 0.8, m[1] * 0.75], [L_MECO, m[0], m[1]], [104, m[0] * 1.02, m[1] + 70], [112, m[0] * 0.78, m[1] * 0.92],
      [120, m[0] * 0.5, m[1] * 0.62], [126, m[0] * 0.32, m[1] * 0.4], [134, m[0] * 0.1, 320], [140, 0, 120], [144, 0, 32], [L_LAND, 0, L_MOUNT], [L_LAND + 8, 0, L_MOUNT]]);
    let i = 1; while (i < K.length - 2 && t > K[i + 1][0]) i++;
    const k = (t - K[i][0]) / (K[i + 1][0] - K[i][0]);
    const x = catmull(K[i - 1][1], K[i][1], K[i + 1][1], K[i + 2][1], k), y = catmull(K[i - 1][2], K[i][2], K[i + 1][2], K[i + 2][2], k);
    out.p = [x, Math.max(L_MOUNT, y), 0];
    // tengely: a hajtóművek a haladási irány felé (hajtóművel előre esik), a leválás után pár mp alatt átfordul
    const t2 = Math.min(L_LAND, t + 0.3);
    const p2 = this.boosterPose2(t2);
    let vx = p2[0] - x, vy = p2[1] - y;
    const vl = Math.hypot(vx, vy) || 1;
    let ax = -vx / vl, ay = -vy / vl;
    if (t > 144) { ax = 0; ay = 1; }
    const asc = this.ascentAxis();
    const f = smoothK(L_MECO, L_MECO + 5, t);
    ax = asc[0] + (ax - asc[0]) * f; ay = asc[1] + (ay - asc[1]) * f;
    const al = Math.hypot(ax, ay) || 1;
    out.a = [ax / al, ay / al, 0];
    return out;
  }
  boosterPose2(t) {
    const K = this.returnKeys; let i = 1; while (i < K.length - 2 && t > K[i + 1][0]) i++;
    const k = (t - K[i][0]) / (K[i + 1][0] - K[i][0]);
    return [catmull(K[i - 1][1], K[i][1], K[i + 1][1], K[i + 2][1], k), catmull(K[i - 1][2], K[i][2], K[i + 1][2], K[i + 2][2], k)];
  }
  mecoPt() { const tau = L_MECO - (L_IGN + 1); return [0.012 * tau ** 3, L_MOUNT + 1.4 * tau * tau]; }
  ascentAxis() { const tau = L_MECO - (L_IGN + 1), dd = 0.036 * tau * tau, dy = 2.8 * tau, l = Math.hypot(dd, dy); return [dd / l, dy / l]; }
  armPose(t) {
    const PI = Math.PI;
    return keyInterp([[0, -PI / 2, 60], [4, -PI / 2, 29.0], [5, -PI / 2, 29.0], [11, -PI / 2, 74], [19, PI / 2, 74], [25, PI / 2, 70.1], [26, PI / 2, 70.1], [30, PI / 2, 77],
      [48, PI / 2, 77], [54, PI, 77], [L_LAND + 10, PI, 77], [170, -PI / 2, 60], [L_CYCLE, -PI / 2, 60]], t);
  }
  hookPos(th, hy) { return [Math.cos(th) * 14, hy - 1.6, 14 - Math.sin(th) * 14]; }
  setAxisObj(obj, p, a) {
    obj.position.set(p[0], p[1], p[2]);
    this._v.set(a[0], a[1], a[2]);
    obj.quaternion.setFromUnitVectors(this._up, this._v);
  }
  boardDraw(t) {
    const fmt = (s) => { s = Math.max(0, Math.ceil(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
    let status, timer;
    if (t < 26) status = 'FOKOZAT FELHELYEZÉSE';
    else if (t < 45) status = 'TANKOLÁS';
    else if (t < L_IGN) status = 'INDÍTÁSI SZAKASZ';
    else if (t < L_MECO) status = 'EMELKEDÉS';
    else if (t < L_LAND) status = 'A BOOSTER VISSZATÉR';
    else status = 'LANDOLT · KÖVETKEZŐ INDÍTÁS';
    if (t < L_IGN) timer = 'T−' + fmt(L_IGN - t);
    else if (t < L_LAND) timer = 'T+' + fmt(t - L_IGN);
    else timer = 'T−' + fmt(L_CYCLE - t + L_IGN);
    const txt = status + '|' + timer;
    if (txt === this.lastText) return;
    this.lastText = txt;
    const x = this.ctx, mono = '"Lucida Console", Consolas, "DejaVu Sans Mono", monospace';
    x.fillStyle = '#000060'; x.fillRect(0, 0, 1024, 420);
    x.strokeStyle = '#55ffff'; x.lineWidth = 10; x.strokeRect(12, 12, 1000, 396);
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = '#55ffff'; x.font = '38px ' + mono; x.fillText('FALCON 9 · HUNYÓ ŰRKÖZPONT', 512, 62);
    const warn = t >= L_IGN - 10 && t < L_IGN + 4;
    x.fillStyle = warn ? '#ff5555' : '#ffffff'; x.font = 'bold 170px ' + mono; x.fillText(timer, 512, 215);
    x.fillStyle = '#ffff55'; x.font = '46px ' + mono; x.fillText(status, 512, 352);
    this.tex.needsUpdate = true;
  }
  update(dt, cars, P) {
    const t = this.time(), W = this.world, pad = this.P;
    // gyorsítórakéta
    const bp = this.boosterPose(t, this._bp || (this._bp = {}));
    this.setAxisObj(this.booster, bp.p, bp.a);
    // lábak
    let leg = 0;
    if (t >= 142 && t < L_LAND) leg = smoothK(142, 145.5, t);
    else if (t >= L_LAND) leg = 1 - smoothK(166, 176, t);
    for (const lp of this.legs) lp.rotation.z = -leg * 1.97;
    // kar
    const [th, hy] = this.armPose(t);
    this.arm.position.y = hy; this.arm.rotation.y = th;
    // felső fokozat
    let sp, sa = [0, 1, 0], sVisible = true;
    if (t >= L_LAND || t < 5) sp = [0, 2.4, 28];
    else if (t < 26) { const h = this.hookPos(th, hy); sp = [h[0], h[1] - L_STAGE, h[2]]; }
    else if (t < L_MECO) { sp = [bp.p[0] + bp.a[0] * L_BOOST, bp.p[1] + bp.a[1] * L_BOOST, 0]; sa = bp.a; }
    else if (t < L_LAND) {
      const m = this.mecoPt(), ax = this.ascentAxis(), tau = L_MECO - (L_IGN + 1);
      const vx = 0.036 * tau * tau, vy = 2.8 * tau, u = t - L_MECO;
      sp = [m[0] + ax[0] * L_BOOST + vx * u + ax[0] * 9 * u * u, m[1] + ax[1] * L_BOOST + vy * u + ax[1] * 9 * u * u, 0];
      sa = ax;
      if (u < 2) sp[0] += 0; // leválás
    } else sVisible = false;
    this.stage.visible = sVisible;
    if (sVisible) this.setAxisObj(this.stage, sp, sa);
    // lángok
    let bf = 0, bl = 0;
    if (t >= L_IGN && t < L_MECO) { bf = t < L_IGN + 1 ? (t - L_IGN) : 1; bl = 34; }
    else if (t >= 98 && t < 104) { bf = 0.7; bl = 12; }
    else if (t >= 120 && t < 126) { bf = 1; bl = 20; }
    else if (t >= 140 && t < L_LAND) { bf = 0.85; bl = 15; }
    const fl = 0.88 + Math.random() * 0.24;
    this.bFlame.visible = this.bCore.visible = bf > 0.01;
    if (bf > 0.01) {
      this.bFlame.position.set(0, 0, 0); this.bFlame.scale.set(1.9 + bl * 0.03, bl * fl * bf, 1.9 + bl * 0.03);
      this.bCore.scale.set(0.9, bl * 0.45 * fl * bf, 0.9);
    }
    this.bGlow.material.opacity = bf * 0.9; this.bGlow.scale.set(26 + bl, 26 + bl, 1);
    const sf = (t >= L_MECO + 1.5 && t < 150) ? 1 : 0;
    this.sFlame.visible = sf > 0; if (sf) this.sFlame.scale.set(0.9, 10 * fl, 0.9);
    this.sGlow.material.opacity = sf * 0.8;
    // fény a talajon (csak alacsonyan)
    const ly = bp.p[1];
    this.engLight.position.set(bp.p[0] - bp.a[0] * 4, ly - bp.a[1] * 4, 0);
    this.engLight.intensity = bf > 0 ? 9000 * bf * Math.max(0, 1 - ly / 600) * fl : 0;
    // medúza a magasban
    if (t > 84 && t < 160) {
      this.jelly.visible = true;
      const j = smoothK(84, 110, t) * (1 - smoothK(140, 160, t));
      const src = sVisible && t > L_MECO ? sp : bp.p;
      this.jelly.position.set(src[0], src[1], src[2]);
      this.jelly.scale.set(200 + j * 700, 160 + j * 540, 1);
      this.jelly.material.opacity = j * 0.45;
    } else this.jelly.visible = false;
    // mozgó ütközési doboz
    const box = pad.box;
    if (t < L_IGN + 1 || t >= L_LAND) {
      const stacked = t >= 26 && t < L_IGN + 1;
      box.hy = stacked ? (L_BOOST + L_STAGE) / 2 : L_BOOST / 2;
      box.x = pad.x; box.z = pad.z; box.y = pad.h + L_MOUNT + box.hy;
    } else box.y = pad.h - 500;
    // vörös jelzőfények villognak
    const blink = (Math.floor(t * 1.2) % 2) ? 1 : 0.25;
    for (const s of this.redLights) s.material.opacity = blink;
    this.boardDraw(t);
    // részecskék és hangok
    this.effects(t, dt, P, bp, sp, sf);
    this.prevT = t;
  }
  toWorld(lx, ly, lz, out) {
    const P = this.P;
    out[0] = P.x + P.dx * lx + P.sx * lz; out[1] = P.h + ly; out[2] = P.z + P.dz * lx + P.sz * lz;
    return out;
  }
  effects(t, dt, Ps, bp, sp, sf) {
    if (!Ps) return;
    const P = this.P, v = [0, 0, 0];
    // szellőztetés (folyékony oxigén párája)
    if (t > 32 && t < L_IGN && Math.random() < 0.5) {
      this.toWorld(0, L_BOOST - 2 + Math.random() * 4, 0, v);
      Ps.emit(v[0] + (Math.random() - 0.5) * 3, v[1], v[2] + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, -0.5, (Math.random() - 0.5) * 2, 0xe8f2ff, 2 + Math.random() * 2, 3, 0.35, 2.5, 0.4);
    }
    // indítási füstfelhő
    if (t > L_IGN && t < L_IGN + 12) {
      for (let k = 0; k < 4; k++) {
        const side = Math.random() < 0.5 ? -1 : 1, sp2 = 10 + Math.random() * 18;
        this.toWorld(side * 6, 1.5, (Math.random() - 0.5) * 6, v);
        Ps.emit(v[0], v[1], v[2], P.dx * side * sp2 + (Math.random() - 0.5) * 4, 2 + Math.random() * 5, P.dz * side * sp2 + (Math.random() - 0.5) * 4, Math.random() < 0.2 ? 0xffb070 : 0xb8b4ae, 5 + Math.random() * 5, 5 + Math.random() * 3, 0.5, 4, -0.3);
      }
    }
    // emelkedési csík
    const burning = (t > L_IGN + 1 && t < L_MECO) || (t >= 98 && t < 104) || (t >= 120 && t < 126) || (t >= 140 && t < L_LAND);
    if (burning) {
      for (let k = 0; k < 2; k++) {
        this.toWorld(bp.p[0] - bp.a[0] * 3, bp.p[1] - bp.a[1] * 3, 0, v);
        Ps.emit(v[0] + (Math.random() - 0.5) * 2, v[1], v[2] + (Math.random() - 0.5) * 2, -bp.a[0] * 8 * P.dx, -bp.a[1] * 8, -bp.a[0] * 8 * P.dz, 0xd8d2c8, 3 + Math.random() * 3, 7, 0.45, 3, -0.2);
      }
    }
    if (sf && sp && Math.random() < 0.7) { this.toWorld(sp[0], sp[1] - 1, 0, v); Ps.emit(v[0], v[1], v[2], 0, -3, 0, 0xbcd8ff, 2.5, 5, 0.35, 2.5, 0); }
    // leszállás: por
    if (t > 144 && t < L_LAND + 1 && Math.random() < 0.9) {
      const a = Math.random() * Math.PI * 2; this.toWorld(Math.cos(a) * 4, 0.8, Math.sin(a) * 4, v);
      Ps.emit(v[0], v[1], v[2], Math.cos(a) * 14, 1 + Math.random() * 2, Math.sin(a) * 14, 0xb8b4ae, 3 + Math.random() * 3, 3.5, 0.45, 3, -0.2);
    }
    // hangok
    if (typeof Sound !== 'undefined') {
      const cyc = Math.floor((Date.now() / 1000 + this.offset) / L_CYCLE);
      if (t > L_IGN && t < L_IGN + 3 && this.rumbled !== cyc) { this.rumbled = cyc; Sound.rumble && Sound.rumble(this.distGain()); }
      if (t > L_LAND + 1.5 && t < L_LAND + 6 && this.boomed !== cyc) { this.boomed = cyc; Sound.boom(); }
    }
  }
  distGain() {
    const c = Game.cars[0]; if (!c) return 0.5;
    const d = Math.hypot(c.c[0] - this.P.x, c.c[2] - this.P.z);
    return Math.max(0.15, Math.min(1, 120 / (d + 1)));
  }
  // indításkor a hajtóművek lökéshulláma elsodorja a közeli autókat
  blast(car, dt) {
    const t = this.time();
    if (t < L_IGN || t > L_IGN + 7) return;
    const dx = car.c[0] - this.P.x, dz = car.c[2] - this.P.z, d = Math.hypot(dx, dz);
    if (d > 55 || d < 0.1) return;
    const k = (1 - d / 55) * 16 * dt;
    for (let i = 0; i < 16; i++) { car.vx[i] += dx / d * k; car.vz[i] += dz / d * k; car.vy[i] += k * 0.3; }
  }
}
