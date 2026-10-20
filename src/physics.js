'use strict';
// ============================================================
//  HUNYÓ – világ (terep, rámpák, akadályok) és autófizika
//  Tömegpont-rugó (PBD) karosszéria + sugárvetéses felfüggesztés
// ============================================================

const G = 9.81;
// sérülés hangolása (egy helyen): a végső sérülés = DAMAGE_SCALE * (szerkezeti + horpadás)
const DAMAGE_SCALE = 1.0;
const DMG_STRUCT_K = 0.7;     // szerkezeti tag osztója: maxDeform * DMG_STRUCT_K (korábban 0.35)
const DMG_DENT_W = 0.18;      // horpadások súlya (korábban 0.35)
const DENT_DMG_MIN_IV = 8;    // ennél kisebb ütközési sebesség (m/s) csak látvány, nem sérülés

function hashStr(s) {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeNoise(seed) {
  const rnd = mulberry32(seed);
  const p = []; for (let i = 0; i < 256; i++) p.push(i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const P = new Uint16Array(512); for (let i = 0; i < 512; i++) P[i] = p[i & 255];
  const V = new Float32Array(256); for (let i = 0; i < 256; i++) V[i] = rnd() * 2 - 1;
  const lat = (ix, iy) => V[P[P[ix & 255] + (iy & 255)] & 255];
  function n2(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const a = lat(ix, iy), b = lat(ix + 1, iy), c = lat(ix, iy + 1), d = lat(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }
  function fbm(x, y, oct) {
    let a = 1, f = 1, s = 0, n = 0;
    for (let o = 0; o < oct; o++) { s += a * n2(x * f + o * 17.31, y * f - o * 9.13); n += a; a *= 0.5; f *= 2.03; }
    return s / n;
  }
  return { n2, fbm };
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// felületek
const SURF = { GRASS: 0, ROCK: 1, SNOW: 2, SAND: 3, PAD: 4, METAL: 5 };
const SURF_MU = [0.95, 1.05, 0.5, 0.68, 1.1, 0.95];
const SURF_NAME = ['fű', 'szikla', 'hó', 'homok', 'beton', 'rámpa'];

// ------------------------------------------------------------
class World {
  constructor(cfg) {
    this.mode = cfg.mode;
    this.seedStr = cfg.mode === 'classic' ? 'TEREP2' : String(cfg.seed || 'terep');
    const seed = hashStr(this.seedStr);
    const rnd = this.rnd = mulberry32(seed ^ 0x9e3779b9);
    this.noise = makeNoise(seed);
    this.size = 640; this.N = 160; this.cell = this.size / this.N; this.half = this.size / 2;
    this.water = 0;
    this.snowLine = 36;
    this.lakes = []; this.peaks = [];

    if (cfg.mode === 'classic') {
      this.zone = { x: 20, z: 25, yaw: 0 };
      this.lakes.push({ x: -120, z: 110, r: 80, d: 16 });
      this.lakes.push({ x: 150, z: 150, r: 45, d: 10 });
      this.peaks.push({ x: 160, z: -150, r: 120, h: 62 });
      this.peaks.push({ x: -170, z: -140, r: 85, h: 34 });
      this.peaks.push({ x: -40, z: -210, r: 60, h: 22 });
    } else {
      const ang = rnd() * Math.PI * 2, rr = rnd() * 90;
      this.zone = { x: Math.cos(ang) * rr, z: Math.sin(ang) * rr, yaw: rnd() * Math.PI * 2 };
      const far = (minD) => {
        for (let k = 0; k < 60; k++) {
          const x = (rnd() * 2 - 1) * 230, z = (rnd() * 2 - 1) * 230;
          if (Math.hypot(x - this.zone.x, z - this.zone.z) > minD) return { x, z };
        }
        return { x: 200, z: 200 };
      };
      const nl = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < nl; i++) { const p = far(150); this.lakes.push({ x: p.x, z: p.z, r: 40 + rnd() * 50, d: 8 + rnd() * 10 }); }
      const np = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < np; i++) { const p = far(170); this.peaks.push({ x: p.x, z: p.z, r: 60 + rnd() * 70, h: 25 + rnd() * 45 }); }
    }
    const zc = Math.cos(this.zone.yaw), zs = Math.sin(this.zone.yaw);
    this.zone.c = zc; this.zone.s = zs;
    this.zone.rect = { x0: -100, x1: 60, z0: -34, z1: 34 };
    this.zone.h = Math.max(this.baseHeight(this.zone.x, this.zone.z), this.water + 4);
    this.pickPadSite(rnd, cfg.mode === 'classic');

    // magasságmező
    const N = this.N, H = this.H = new Float32Array((N + 1) * (N + 1));
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const x = -this.half + i * this.cell, z = -this.half + j * this.cell;
      let h = this.baseHeight(x, z);
      const m = this.zoneMask(x, z);
      if (m > 0) h = h + (this.zone.h - h) * m;
      const pm = this.padMask(x, z);
      if (pm > 0) h = h + (this.pad.h - h) * pm;
      H[j * (N + 1) + i] = h;
    }

    this.ramps = []; this.boxes = []; this.spheres = []; this.trees = []; this.tvSpots = [];
    this.buildStructures();
    this.scatter();
  }

  baseHeight(x, z) {
    const n = this.noise;
    let h = 7 + n.fbm(x / 190, z / 190, 4) * 30 + n.fbm(x / 48 + 40, z / 48 - 20, 3) * 4.5;
    for (const p of this.peaks) {
      const d = Math.hypot(x - p.x, z - p.z) / p.r;
      h += p.h * Math.exp(-d * d * 2.2) * (0.85 + 0.15 * n.n2(x / 15, z / 15));
    }
    for (const l of this.lakes) {
      const d = Math.hypot(x - l.x, z - l.z) / l.r;
      h -= l.d * (1 - smooth(0.2, 1.0, d)) + 4 * (1 - smooth(0.8, 1.3, d));
    }
    const e = Math.max(Math.abs(x), Math.abs(z)) / this.half;
    h += smooth(0.78, 1.0, e) * 75;
    return h;
  }
  toZone(x, z) { const dx = x - this.zone.x, dz = z - this.zone.z; return [dx * this.zone.c + dz * this.zone.s, -dx * this.zone.s + dz * this.zone.c]; }
  fromZone(lx, lz) { return [this.zone.x + lx * this.zone.c - lz * this.zone.s, this.zone.z + lx * this.zone.s + lz * this.zone.c]; }
  // Falcon 9 indítóállás a pálya szélén
  pickPadSite(rnd, classic) {
    let px, pz;
    if (classic) { px = -205; pz = 40; }
    else {
      const away = Math.atan2(-this.zone.z, -this.zone.x);
      let best = null, bs = -1;
      for (let k = 0; k < 24; k++) {
        const a = (Math.hypot(this.zone.x, this.zone.z) > 20 ? away : rnd() * 6.28) + (rnd() - 0.5) * 1.6, r = 195 + rnd() * 15;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        let sc = Math.hypot(x - this.zone.x, z - this.zone.z);
        for (const l of this.lakes) sc = Math.min(sc, Math.hypot(x - l.x, z - l.z) - l.r);
        for (const p of this.peaks) sc = Math.min(sc, Math.hypot(x - p.x, z - p.z) - p.r * 0.6);
        if (sc > bs) { bs = sc; best = [x, z]; }
      }
      [px, pz] = best;
    }
    const l = Math.hypot(px, pz) || 1;
    const dx = -px / l, dz = -pz / l;      // lövési irány: a pálya közepe felé
    this.pad = { x: px, z: pz, h: Math.max(this.baseHeight(px, pz), this.water + 3), dx, dz, sx: -dz, sz: dx, R: 36 };
  }
  padMask(x, z) {
    const P = this.pad; if (!P) return 0;
    return 1 - smooth(P.R, P.R + 26, Math.hypot(x - P.x, z - P.z));
  }
  zoneMask(x, z) {
    const [lx, lz] = this.toZone(x, z), r = this.zone.rect;
    const dx = Math.max(r.x0 - lx, 0, lx - r.x1), dz = Math.max(r.z0 - lz, 0, lz - r.z1);
    return 1 - smooth(0, 30, Math.hypot(dx, dz));
  }

  // --- magasság a renderelt háromszögekkel egyezően
  _tri(x, z) {
    const N = this.N, c = this.cell;
    let gx = (x + this.half) / c, gz = (z + this.half) / c;
    gx = Math.min(N - 1e-6, Math.max(0, gx)); gz = Math.min(N - 1e-6, Math.max(0, gz));
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
    const W = N + 1, H = this.H;
    return [H[j * W + i], H[j * W + i + 1], H[(j + 1) * W + i], H[(j + 1) * W + i + 1], fx, fz];
  }
  heightAt(x, z) {
    const [h00, h10, h01, h11, fx, fz] = this._tri(x, z);
    if (fx + fz < 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }
  normalAt(x, z, out) {
    const [h00, h10, h01, h11, fx, fz] = this._tri(x, z);
    let dx, dz;
    if (fx + fz < 1) { dx = (h10 - h00) / this.cell; dz = (h01 - h00) / this.cell; }
    else { dx = (h11 - h01) / this.cell; dz = (h11 - h10) / this.cell; }
    const l = Math.hypot(dx, 1, dz);
    out[0] = -dx / l; out[1] = 1 / l; out[2] = -dz / l;
    return out;
  }
  surfaceAt(x, z, h, ny) {
    if (h < this.water + 0.7) return SURF.SAND;
    if (this.zoneMask(x, z) > 0.97 || this.padMask(x, z) > 0.97) return SURF.PAD;
    if (ny < 0.74) return SURF.ROCK;
    if (h > this.snowLine + this.noise.n2(x / 22, z / 22) * 7) return SURF.SNOW;
    return SURF.GRASS;
  }

  // --- építmények
  addBox(x, y, z, hx, hy, hz, yaw, kind, color) {
    this.boxes.push({ x, y, z, hx, hy, hz, yaw, c: Math.cos(yaw), s: Math.sin(yaw), kind, color });
  }
  buildStructures() {
    const Z = this.zone, y0 = Z.h;
    const mk = (lx, lz, R, thetaMax, W, wallH, name) => {
      const [x, z] = this.fromZone(lx, lz);
      const r = { x, y: y0, z, yaw: Z.yaw, c: Z.c, s: Z.s, R, T: 0.7, W, thetaMax, wallH, name };
      this.ramps.push(r);
      return r;
    };
    // a nagy íves rámpa: felfelé, fejjel lefelé, kilövés
    const big = mk(12, -12, 13, 168 * Math.PI / 180, 10, 0, 'nagy');
    // oszlopok a két oldalon
    for (const lx of [2.5, 6.5, 10.5]) {
      const top = big.R + Math.sqrt(Math.max(0, big.R * big.R - lx * lx)) + big.T;
      for (const sd of [-1, 1]) {
        const lz = sd * (big.W / 2 + 0.7);
        const wx = big.x + lx * big.c - lz * big.s, wz = big.z + lx * big.s + lz * big.c;
        this.addBox(wx, y0 + top / 2, wz, 0.35, top / 2, 0.35, big.yaw, 'pillar');
      }
    }
    // fal: negyedcső + függőleges fal
    const wall = mk(28, 16, 7, Math.PI / 2, 12, 26, 'fal');
    {
      const lx = wall.R + wall.T / 2, wx = wall.x + lx * wall.c, wz = wall.z + lx * wall.s;
      this.addBox(wx, y0 + wall.R + wall.wallH / 2, wz, wall.T / 2, wall.wallH / 2, wall.W / 2, wall.yaw, 'wall');
    }
    // parkoló autósor, át lehet ugrani
    const colors = [0xd8d8d8, 0x2b2f36, 0xb3262b, 0x3a6fb5, 0x9aa1a8];
    for (let i = 0; i < 5; i++) {
      const [x, z] = this.fromZone(-34 + i * 2.7, 16);
      this.addBox(x, y0 + 0.75, z, 0.95, 0.75, 2.25, Z.yaw, 'parked', colors[i]);
    }
    // kezdőpontok
    const s1 = this.fromZone(-82, -12), s2 = this.fromZone(-82, 16);
    this.starts = [{ x: s1[0], z: s1[1], yaw: Z.yaw }, { x: s2[0], z: s2[1], yaw: Z.yaw }];
    // indítóállás: betonlap, torony, fokozat-tartó, kijelző, és maga a rakéta (mozgó doboz)
    const P = this.pad, ph = P.h, yaw = Math.atan2(P.dz, P.dx);
    const at = (f, s) => [P.x + P.dx * f + P.sx * s, P.z + P.dz * f + P.sz * s];
    this.addBox(P.x, ph + 0.75, P.z, 3.25, 0.75, 3.25, yaw, 'tower');
    let q = at(0, 14); P.tower = { x: q[0], z: q[1] }; this.addBox(q[0], ph + 42, q[1], 2.2, 42, 2.2, yaw, 'tower');
    q = at(0, 28); P.cradle = { x: q[0], z: q[1] }; this.addBox(q[0], ph + 1.2, q[1], 2.6, 1.2, 2.6, yaw, 'cradle');
    q = at(26, -16); P.board = { x: q[0], z: q[1] };
    for (const s of [-5.6, 5.6]) { const b = [q[0] + P.sz * 0 + (-P.dz) * 0, q[1]]; const w = [q[0] + P.sx * s, q[1] + P.sz * s]; this.addBox(w[0], ph + 4, w[1], 0.25, 4, 0.25, yaw, 'pillar'); }
    this.addBox(P.x, ph - 500, P.z, 1.85, 21, 1.85, yaw, 'rocket');
    P.box = this.boxes[this.boxes.length - 1];
  }
  scatter() {
    const rnd = this.rnd, n = [0, 0, 0];
    const inZone = (x, z, pad) => {
      const [lx, lz] = this.toZone(x, z), r = this.zone.rect;
      return lx > r.x0 - pad && lx < r.x1 + pad && lz > r.z0 - pad && lz < r.z1 + pad;
    };
    let tries = 0;
    while (this.trees.length < 320 && tries++ < 6000) {
      const x = (rnd() * 2 - 1) * this.half * 0.86, z = (rnd() * 2 - 1) * this.half * 0.86;
      if (inZone(x, z, 14) || this.padMask(x, z) > 0) continue;
      const h = this.heightAt(x, z); this.normalAt(x, z, n);
      if (h < this.water + 1.5 || n[1] < 0.86 || h > this.snowLine + 6) continue;
      // csoportos erdőfoltok
      if (this.noise.n2(x / 55 + 3, z / 55 - 7) < -0.05) continue;
      this.trees.push({ x, z, y: h, r: 0.35, h: 5 + rnd() * 5, s: 0.8 + rnd() * 0.6 });
    }
    tries = 0;
    while (this.spheres.length < 70 && tries++ < 3000) {
      const x = (rnd() * 2 - 1) * this.half * 0.86, z = (rnd() * 2 - 1) * this.half * 0.86;
      if (inZone(x, z, 8) || this.padMask(x, z) > 0) continue;
      const h = this.heightAt(x, z);
      if (h < this.water - 2) continue;
      const r = 0.8 + rnd() * rnd() * 3.2;
      this.spheres.push({ x, y: h - r * 0.35, z, r, rot: rnd() * 6.28 });
    }
    // tévékamera-pontok
    const add = (x, z, up) => this.tvSpots.push({ x, z, y: Math.max(this.heightAt(x, z), this.water) + up });
    for (const [lx, lz] of [[-45, -40], [30, -42], [62, 34], [-10, 40], [-95, 0]]) { const p = this.fromZone(lx, lz); add(p[0], p[1], 5); }
    { const P = this.pad; add(P.x + P.dx * 60 + P.sx * 30, P.z + P.dz * 60 + P.sz * 30, 4); }
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * Math.PI * 2, r = 120 + (i % 3) * 60;
      add(Math.cos(a) * r, Math.sin(a) * r, 7);
    }
  }

  // rálátás két pont között (terep, rámpák, dobozok, sziklák, fák); bújócska fénykúpjához
  losClear(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz);
    if (L < 0.5) return true;
    const ux = dx / L, uy = dy / L, uz = dz / L;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const near = this.gatherNear(mx, mz, L / 2 + 2, this._losNear || (this._losNear = { boxes: [], spheres: [], trees: [] }));
    const hit = this._losHit || (this._losHit = { t: 0, n: [0, 0, 0], surf: 0 });
    if (this.raycast(ax, ay, az, ux, uy, uz, L - 0.3, near, hit)) return false;
    // fák: törzs + lombkorona (függőleges henger), a szakasz legközelebbi pontja alapján
    for (const t of near.trees) {
      const qx = t.x - ax, qz = t.z - az, hl = ux * ux + uz * uz;
      let k = hl > 1e-6 ? (qx * ux + qz * uz) / hl : 0;
      k = Math.max(0, Math.min(L, k));
      const px = ax + ux * k, py = ay + uy * k, pz = az + uz * k;
      const d = Math.hypot(px - t.x, pz - t.z), top = t.y + t.h;
      if (py > top || py < t.y - 0.5) continue;
      const sc = t.h / 5.2, rel = py - t.y;
      const rad = rel < 1.1 * sc ? 0.3 : 1.5 * t.s * sc * Math.max(0, 1 - (rel - 1.1 * sc) / (4.1 * sc));
      if (d < rad) return false;
    }
    return true;
  }
  resetDynamic() { for (const t of this.trees) { t.down = false; t.fallT = 0; } }
  // közeli akadályok listája egy autó körül
  gatherNear(x, z, rad, out) {
    out.boxes.length = 0; out.spheres.length = 0; out.trees.length = 0;
    for (const b of this.boxes) if (Math.abs(b.x - x) < rad + 20 && Math.abs(b.z - z) < rad + 20) out.boxes.push(b);
    for (const s of this.spheres) if (Math.abs(s.x - x) < rad + s.r && Math.abs(s.z - z) < rad + s.r) out.spheres.push(s);
    for (const t of this.trees) if (!t.down && Math.abs(t.x - x) < rad && Math.abs(t.z - z) < rad) out.trees.push(t);
    return out;
  }

  // --- sugárvetés: {t, n:[..], surf}
  raycast(ox, oy, oz, dx, dy, dz, maxT, near, hit) {
    hit.t = Infinity;
    // terep
    {
      let pt = 0, f0 = oy - this.heightAt(ox, oz);
      if (f0 <= 0) { hit.t = 0; this._terrHit(ox, oz, hit); }
      else {
        const step = 0.18;
        for (let t = step; t <= maxT + step; t += step) {
          const tt = Math.min(t, maxT);
          const x = ox + dx * tt, y = oy + dy * tt, z = oz + dz * tt;
          if (y - this.heightAt(x, z) < 0) {
            let a = pt, b = tt;
            for (let k = 0; k < 6; k++) {
              const m = (a + b) / 2;
              if (oy + dy * m - this.heightAt(ox + dx * m, oz + dz * m) < 0) b = m; else a = m;
            }
            hit.t = b; this._terrHit(ox + dx * b, oz + dz * b, hit);
            break;
          }
          pt = tt;
          if (tt >= maxT) break;
        }
      }
    }
    for (const r of this.ramps) this._rayRamp(r, ox, oy, oz, dx, dy, dz, maxT, hit);
    for (const b of near.boxes) this._rayBox(b, ox, oy, oz, dx, dy, dz, maxT, hit);
    for (const s of near.spheres) {
      const px = ox - s.x, py = oy - s.y, pz = oz - s.z;
      const bq = px * dx + py * dy + pz * dz, c = px * px + py * py + pz * pz - s.r * s.r;
      const disc = bq * bq - c;
      if (disc < 0) continue;
      const t = -bq - Math.sqrt(disc);
      if (t >= 0 && t < hit.t && t <= maxT) {
        hit.t = t;
        const hx = px + dx * t, hy = py + dy * t, hz = pz + dz * t;
        hit.n[0] = hx / s.r; hit.n[1] = hy / s.r; hit.n[2] = hz / s.r; hit.surf = SURF.ROCK;
      }
    }
    return hit.t <= maxT;
  }
  _terrHit(x, z, hit) {
    this.normalAt(x, z, hit.n);
    hit.surf = this.surfaceAt(x, z, this.heightAt(x, z), hit.n[1]);
  }
  _rayRamp(r, ox, oy, oz, dx, dy, dz, maxT, hit) {
    const qx = ox - r.x, qz = oz - r.z;
    const lx = qx * r.c + qz * r.s, lz = -qx * r.s + qz * r.c, ly = oy - r.y;
    const ddx = dx * r.c + dz * r.s, ddz = -dx * r.s + dz * r.c, ddy = dy;
    const R = r.R, cy = ly - R;
    const d0 = Math.hypot(lx, cy);
    const a = ddx * ddx + ddy * ddy;
    if (a < 1e-9) return;
    const b = 2 * (lx * ddx + cy * ddy);
    const tryHit = (Rc, inner) => {
      const c = lx * lx + cy * cy - Rc * Rc, disc = b * b - 4 * a * c;
      if (disc < 0) return;
      const sq = Math.sqrt(disc);
      const t = inner ? (-b + sq) / (2 * a) : (-b - sq) / (2 * a);
      if (t < 0 || t > maxT || t >= hit.t) return;
      const hx = lx + ddx * t, hy = ly + ddy * t, hz = lz + ddz * t;
      if (Math.abs(hz) > r.W / 2) return;
      const th = Math.atan2(hx, R - hy);
      if (th < -0.02 || th > r.thetaMax) return;
      // normál lokálisan
      let nx = -hx / Rc, ny = -(hy - R) / Rc;
      if (!inner) { nx = -nx; ny = -ny; }
      hit.t = t;
      hit.n[0] = nx * r.c; hit.n[1] = ny; hit.n[2] = nx * r.s;
      hit.surf = SURF.METAL;
    };
    if (d0 < R + 0.05) tryHit(R, true);
    else if (d0 > R + r.T) tryHit(R + r.T, false);
  }
  _rayBox(bx, ox, oy, oz, dx, dy, dz, maxT, hit) {
    const qx = ox - bx.x, qz = oz - bx.z;
    const o = [qx * bx.c + qz * bx.s, oy - bx.y, -qx * bx.s + qz * bx.c];
    const d = [dx * bx.c + dz * bx.s, dy, -dx * bx.s + dz * bx.c];
    const h = [bx.hx, bx.hy, bx.hz];
    let tmin = 0, tmax = maxT, ax = -1, sg = 0;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]) < 1e-9) { if (o[k] < -h[k] || o[k] > h[k]) return; continue; }
      let t1 = (-h[k] - o[k]) / d[k], t2 = (h[k] - o[k]) / d[k], s = -1;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
      if (t1 > tmin) { tmin = t1; ax = k; sg = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return;
    }
    if (ax < 0 || tmin >= hit.t) return;
    hit.t = tmin;
    const ln = [0, 0, 0]; ln[ax] = sg;
    hit.n[0] = ln[0] * bx.c - ln[2] * bx.s; hit.n[1] = ln[1]; hit.n[2] = ln[0] * bx.s + ln[2] * bx.c;
    hit.surf = bx.kind === 'parked' ? SURF.METAL : SURF.PAD;
  }

  // --- gömb (tömegpont) ütközés: visszatér a behatolás nagyságával, p módosul
  collidePoint(p, r, near, out) {
    let total = 0;
    out.cnt = 0;
    const push = (nx, ny, nz, pen, mu) => {
      p[0] += nx * pen; p[1] += ny * pen; p[2] += nz * pen;
      total += pen;
      out.nx = nx; out.ny = ny; out.nz = nz; out.pen = pen; out.mu = mu; out.cnt++;
      if (out.cb) out.cb(nx, ny, nz, pen, mu);
    };
    // terep
    const h = this.heightAt(p[0], p[2]);
    if (p[1] - r < h + 0.5) {
      const n = this.normalAt(p[0], p[2], out.tmp);
      const pen = (h + r - p[1]) * n[1];
      if (pen > 0) push(n[0], n[1], n[2], pen, 0.65);
    }
    // rámpák
    for (const R of this.ramps) {
      const qx = p[0] - R.x, qz = p[2] - R.z;
      const lx = qx * R.c + qz * R.s, lz = -qx * R.s + qz * R.c, ly = p[1] - R.y;
      if (Math.abs(lz) > R.W / 2 + r) continue;
      const cy = ly - R.R, d = Math.hypot(lx, cy);
      if (d < 1e-6) continue;
      const th = Math.atan2(lx, R.R - ly);
      if (th < 0 || th > R.thetaMax) continue;
      let pen = 0, sgn = 0;
      if (d > R.R - r && d < R.R + R.T * 0.5) { pen = d - (R.R - r); sgn = -1; }
      else if (d >= R.R + R.T * 0.5 && d < R.R + R.T + r) { pen = R.R + R.T + r - d; sgn = 1; }
      if (pen > 0) {
        const nx = sgn * lx / d, ny = sgn * cy / d;
        push(nx * R.c, ny, nx * R.s, pen, 0.5);
      }
    }
    // dobozok
    for (const b of near.boxes) {
      const qx = p[0] - b.x, qz = p[2] - b.z;
      const lx = qx * b.c + qz * b.s, ly = p[1] - b.y, lz = -qx * b.s + qz * b.c;
      const cx = Math.max(-b.hx, Math.min(b.hx, lx)), cy = Math.max(-b.hy, Math.min(b.hy, ly)), cz = Math.max(-b.hz, Math.min(b.hz, lz));
      let ex = lx - cx, ey = ly - cy, ez = lz - cz;
      let d2 = ex * ex + ey * ey + ez * ez;
      if (d2 > r * r) continue;
      let nlx, nly, nlz, pen;
      if (d2 > 1e-10) { const d = Math.sqrt(d2); nlx = ex / d; nly = ey / d; nlz = ez / d; pen = r - d; }
      else {
        const px = b.hx - Math.abs(lx), py = b.hy - Math.abs(ly), pz = b.hz - Math.abs(lz);
        nlx = nly = nlz = 0;
        if (px < py && px < pz) { nlx = Math.sign(lx) || 1; pen = px + r; }
        else if (py < pz) { nly = Math.sign(ly) || 1; pen = py + r; }
        else { nlz = Math.sign(lz) || 1; pen = pz + r; }
      }
      push(nlx * b.c - nlz * b.s, nly, nlx * b.s + nlz * b.c, pen, 0.6);
    }
    for (const s of near.spheres) {
      const dx = p[0] - s.x, dy = p[1] - s.y, dz = p[2] - s.z;
      const d = Math.hypot(dx, dy, dz), m = s.r + r;
      if (d < m && d > 1e-6) push(dx / d, dy / d, dz / d, m - d, 0.7);
    }
    for (const t of near.trees) {
      if (t.down) continue;
      if (p[1] < t.y - 1 || p[1] > t.y + t.h * 0.6) continue;
      const dx = p[0] - t.x, dz = p[2] - t.z, d = Math.hypot(dx, dz), m = t.r + r;
      if (d < m && d > 1e-6) push(dx / d, 0, dz / d, Math.min(m - d, 0.02), 0.6);
    }
    return total;
  }
}

// ------------------------------------------------------------
const SPECS = {
  terep: {
    id: 'terep', name: 'Terepjáró', mass: 1500, len: 4.2, wb: 2.5, wid: 1.86, h: 1.25,
    wheelR: 0.43, susLen: 0.42, k: 21000, c: 2600, engineF: 10500, vmax: 44, brakeF: 15000,
    steerMax: 0.62, grip: 1.0, yieldStrain: 0.0015, plastic: 0.9, maxDeform: 0.32, nodeR: 0.27,
    drag: 0.55, rocket: false
  },
  raketa: {
    id: 'raketa', name: 'Rakéta', mass: 1400, len: 4.6, wb: 2.75, wid: 1.84, h: 1.01,
    wheelR: 0.36, susLen: 0.26, k: 70000, c: 5600, engineF: 36000, vmax: 75, brakeF: 22000,
    steerMax: 0.55, grip: 1.18, yieldStrain: 0.003, plastic: 0.55, maxDeform: 0.14, nodeR: 0.22, nodeRb: 0.07, yb: -0.33,
    drag: 0.36, rocket: true,
    suction: 2.0, tank: 600, boostG: 1.1, boostUse: 45, upG: 1.4, upUse: 65, jumpDv: 5.5, jumpCost: 45,
    attUse: 14, refill: 22
  }
};

const NN = 16;
class Car {
  constructor(spec, world) {
    this.spec = spec; this.world = world;
    const s = spec;
    this.M = s.mass; this.m = s.mass / NN;
    this.x = new Float64Array(NN); this.y = new Float64Array(NN); this.z = new Float64Array(NN);
    this.px = new Float64Array(NN); this.py = new Float64Array(NN); this.pz = new Float64Array(NN);
    this.vx = new Float64Array(NN); this.vy = new Float64Array(NN); this.vz = new Float64Array(NN);
    this.fx = new Float64Array(NN); this.fy = new Float64Array(NN); this.fz = new Float64Array(NN);
    this.lx = new Float64Array(NN); this.ly = new Float64Array(NN); this.lz = new Float64Array(NN);
    this.xs = [-s.len / 2, -s.wb / 2, s.wb / 2, s.len / 2];
    this.mi = new Float64Array(NN); this.wi = new Float64Array(NN);
    for (let ix = 0; ix < 4; ix++) for (let iy = 0; iy < 2; iy++) for (let iz = 0; iz < 2; iz++) {
      const i = Car.idx(ix, iy, iz);
      this.lx[i] = this.xs[ix]; this.ly[i] = (s.yb || 0) + iy * s.h; this.lz[i] = (iz - 0.5) * s.wid;
      this.mi[i] = this.m * (iy ? 0.45 : 1.55); this.wi[i] = 1 / this.mi[i];
    }
    // rudak: minden cellán belül minden pár
    const set = new Set(), beams = [];
    for (let c = 0; c < 3; c++) {
      const ids = [];
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let d = 0; d < 2; d++) ids.push(Car.idx(c + a, b, d));
      for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
        const A = Math.min(ids[i], ids[j]), B = Math.max(ids[i], ids[j]), key = A * 64 + B;
        if (set.has(key)) continue; set.add(key);
        const L = Math.hypot(this.lx[A] - this.lx[B], this.ly[A] - this.ly[B], this.lz[A] - this.lz[B]);
        beams.push([A, B, L]);
      }
    }
    this.nb = beams.length;
    this.ba = new Int32Array(this.nb); this.bb = new Int32Array(this.nb);
    this.rest = new Float64Array(this.nb); this.orig = new Float64Array(this.nb);
    beams.forEach((b, i) => { this.ba[i] = b[0]; this.bb[i] = b[1]; this.orig[i] = this.rest[i] = b[2]; });

    this.wheels = [
      { node: Car.idx(2, 0, 0), front: true, side: -1 }, { node: Car.idx(2, 0, 1), front: true, side: 1 },
      { node: Car.idx(1, 0, 0), front: false, side: -1 }, { node: Car.idx(1, 0, 1), front: false, side: 1 }
    ];
    for (const w of this.wheels) Object.assign(w, { t: 0, contact: false, comp: 0, prevComp: 0, spin: 0, steer: 0, n: [0, 1, 0], surf: 0, slip: 0, load: 0, hx: 0, hy: 0, hz: 0 });

    this.ctl = { throttle: 0, brake: 0, steer: 0, handbrake: 0, boost: 0, up: 0, upPressed: false, pitch: 0, roll: 0 };
    this.suctionOn = !!s.rocket;
    this.tank = s.tank || 0;
    this.steerCur = 0;
    this.f = [1, 0, 0]; this.u = [0, 1, 0]; this.r = [0, 0, 1]; this.c = [0, 0, 0]; this.v = [0, 0, 0];
    this.near = { boxes: [], spheres: [], trees: [] };
    this.hit = { t: 0, n: [0, 1, 0], surf: 0 };
    this.col = { tmp: [0, 0, 0], cnt: 0 };
    this._p = [0, 0, 0]; this._thinList = []; this.dents = []; this.dentSum = 0; this.repairs = 0; this.treeHit = null;
    this.fxBoost = 0; this.fxUp = 0; this.fxAtt = 0; this.suckActive = 0;
    this.impact = 0; this.contacts = 0; this.airTime = 0; this.inWater = 0;
    this.fwdSpeed = 0; this.speed = 0;
  }
  static idx(ix, iy, iz) { return ix * 4 + iy * 2 + iz; }

  reset(x, z, yaw, repair = true) {
    const s = this.spec, W = this.world;
    const ca = Math.cos(yaw), sa = Math.sin(yaw);
    let gh = -Infinity;
    for (const [ox, oz] of [[0, 0], [2, 1], [2, -1], [-2, 1], [-2, -1]]) {
      const wx = x + ox * ca - oz * sa, wz = z + ox * sa + oz * ca;
      gh = Math.max(gh, W.heightAt(wx, wz));
    }
    gh = Math.max(gh, W.water - 0.3);
    const by = gh + s.wheelR + s.susLen * 0.75 + 0.15;
    for (let i = 0; i < NN; i++) {
      const lx = this.lx[i], ly = this.ly[i], lz = this.lz[i];
      this.x[i] = this.px[i] = x + lx * ca - lz * sa;
      this.y[i] = this.py[i] = by + ly;
      this.z[i] = this.pz[i] = z + lx * sa + lz * ca;
      this.vx[i] = this.vy[i] = this.vz[i] = 0;
    }
    if (repair) { this.rest.set(this.orig); this.dents.length = 0; this.dentSum = 0; this.repairs++; }
    this.tank = s.tank || 0;
    for (const w of this.wheels) { w.comp = w.prevComp = 0; w.contact = false; }
    this.steerCur = 0; this.airTime = 0;
    this.frame();
  }
  resetHere() {
    this.frame();
    let yaw = Math.atan2(this.f[2], this.f[0]);
    if (Math.hypot(this.f[0], this.f[2]) < 0.2) yaw = Math.atan2(-this.u[2], -this.u[0]);
    this.reset(this.c[0], this.c[2], yaw, true);
  }
  damage() {
    let s = 0;
    for (let i = 0; i < this.nb; i++) s += Math.abs(this.rest[i] / this.orig[i] - 1);
    // dmgCap: bújócskában a bújók nem mennek totálkárba (max 90%)
    return Math.min(this.dmgCap ?? 1, DAMAGE_SCALE * (s / this.nb / (this.spec.maxDeform * DMG_STRUCT_K) + this.dentSum * DMG_DENT_W));
  }

  frame() {
    let cx = 0, cy = 0, cz = 0, vx = 0, vy = 0, vz = 0;
    for (let i = 0; i < NN; i++) { cx += this.x[i]; cy += this.y[i]; cz += this.z[i]; vx += this.vx[i]; vy += this.vy[i]; vz += this.vz[i]; }
    this.c[0] = cx / NN; this.c[1] = cy / NN; this.c[2] = cz / NN;
    this.v[0] = vx / NN; this.v[1] = vy / NN; this.v[2] = vz / NN;
    let fx = 0, fy = 0, fz = 0, ux = 0, uy = 0, uz = 0;
    for (let iy = 0; iy < 2; iy++) for (let iz = 0; iz < 2; iz++) {
      const a = Car.idx(3, iy, iz), b = Car.idx(0, iy, iz), a2 = Car.idx(2, iy, iz), b2 = Car.idx(1, iy, iz);
      fx += this.x[a] - this.x[b] + this.x[a2] - this.x[b2];
      fy += this.y[a] - this.y[b] + this.y[a2] - this.y[b2];
      fz += this.z[a] - this.z[b] + this.z[a2] - this.z[b2];
    }
    for (let ix = 0; ix < 4; ix++) for (let iz = 0; iz < 2; iz++) {
      const a = Car.idx(ix, 1, iz), b = Car.idx(ix, 0, iz);
      ux += this.x[a] - this.x[b]; uy += this.y[a] - this.y[b]; uz += this.z[a] - this.z[b];
    }
    let l = Math.hypot(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l;
    const d = ux * fx + uy * fy + uz * fz; ux -= d * fx; uy -= d * fy; uz -= d * fz;
    l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
    this.f[0] = fx; this.f[1] = fy; this.f[2] = fz;
    this.u[0] = ux; this.u[1] = uy; this.u[2] = uz;
    this.r[0] = fy * uz - fz * uy; this.r[1] = fz * ux - fx * uz; this.r[2] = fx * uy - fy * ux;
    this.speed = Math.hypot(this.v[0], this.v[1], this.v[2]);
    this.fwdSpeed = this.v[0] * fx + this.v[1] * fy + this.v[2] * fz;
  }
  // lokális (rács) pont -> világ
  toWorld(lx, ly, lz, out) {
    const h = (this.spec.yb || 0) + this.spec.h / 2;
    out[0] = this.c[0] + this.f[0] * lx + this.u[0] * (ly - h) + this.r[0] * lz;
    out[1] = this.c[1] + this.f[1] * lx + this.u[1] * (ly - h) + this.r[1] * lz;
    out[2] = this.c[2] + this.f[2] * lx + this.u[2] * (ly - h) + this.r[2] * lz;
    return out;
  }

  beginFrame(dt) {
    this.frame();
    this.world.gatherNear(this.c[0], this.c[2], 14, this.near);
    const s = this.spec, ct = this.ctl;
    const sp = Math.abs(this.fwdSpeed);
    const maxSt = s.steerMax / (1 + sp / 16);
    const target = ct.steer * maxSt;
    this.steerCur += (target - this.steerCur) * Math.min(1, dt * 9);
    this.impact = 0;
    this._jump = false;
    if (s.rocket && ct.upPressed) { ct.upPressed = false; if (this.tank >= s.jumpCost) { this._jump = true; this.tank -= s.jumpCost; this.jumpT = 1.0; } }
    this.jumpT = Math.max(0, (this.jumpT || 0) - dt);
    this.fxBoost = 0; this.fxUp = 0; this.fxAtt = 0; this.suckActive = 0;
  }

  substepA(dt) {
    const s = this.spec, W = this.world, ct = this.ctl, m = this.m;
    this.frame();
    const f = this.f, u = this.u;
    const FX = this.fx, FY = this.fy, FZ = this.fz;
    FX.fill(0); FY.fill(0); FZ.fill(0);

    // légellenállás
    const sp = this.speed, kd = s.drag * sp / this.M, MI = this.mi;
    for (let i = 0; i < NN; i++) { const q = kd * MI[i]; FX[i] -= q * this.v[0]; FY[i] -= q * this.v[1]; FZ[i] -= q * this.v[2]; }

    // kerekek
    const maxLen = s.susLen + s.wheelR;
    const hit = this.hit;
    let contacts = 0;
    const mShare = this.M / 4;
    // hajtás
    let throttle = ct.throttle, brake = ct.brake;
    let reverse = false;
    if (brake > 0.05 && this.fwdSpeed < 1.0 && throttle < 0.05) { reverse = true; }
    const vmaxEff = reverse ? 12 : s.vmax;
    const fs = Math.abs(this.fwdSpeed);
    const curve = Math.max(0, 1 - Math.pow(fs / vmaxEff, 2));
    const driveTotal = (reverse ? -brake * 0.7 : throttle) * s.engineF * curve;
    for (const w of this.wheels) {
      const i = w.node;
      const mo = -(s.yb || 0);
      const ox = this.x[i] + u[0] * mo, oy = this.y[i] + u[1] * mo, oz = this.z[i] + u[2] * mo;
      const got = W.raycast(ox, oy, oz, -u[0], -u[1], -u[2], maxLen + 0.5, this.near, hit);
      const inRange = got && hit.t < maxLen;
      w.contact = inRange;
      const n = hit.n;
      if (s.rocket && this.suctionOn && got) {
        const Fs = s.suction * this.M * G / 4 * (inRange ? 1 : 0.8);
        FX[i] -= n[0] * Fs; FY[i] -= n[1] * Fs; FZ[i] -= n[2] * Fs;
        this.suckActive = 1;
      }
      if (!inRange) { w.comp = 0; w.prevComp = 0; w.t = maxLen; w.load = 0; continue; }
      contacts++;
      const comp = maxLen - hit.t;
      const cv = (comp - w.prevComp) / dt;
      w.prevComp = comp; w.comp = comp; w.t = hit.t;
      let Fn = s.k * comp + s.c * cv;
      if (comp > s.susLen) Fn += (comp - s.susLen) * s.k * 25;
      Fn = Math.max(0, Fn);
      // felület tengelye mentén
      const ndu = -(n[0] * u[0] + n[1] * u[1] + n[2] * u[2]);
      w.n[0] = n[0]; w.n[1] = n[1]; w.n[2] = n[2]; w.surf = hit.surf;
      w.hx = ox - u[0] * hit.t; w.hy = oy - u[1] * hit.t; w.hz = oz - u[2] * hit.t;
      const N = Fn * Math.max(0.2, -ndu < 0 ? 1 : 1);
      FX[i] += n[0] * Fn; FY[i] += n[1] * Fn; FZ[i] += n[2] * Fn;

      // kerék irány
      const st = w.front ? this.steerCur : 0;
      w.steer = st;
      const cs = Math.cos(st), sn = Math.sin(st);
      let dx = f[0] * cs + this.r[0] * sn, dy = f[1] * cs + this.r[1] * sn, dz = f[2] * cs + this.r[2] * sn;
      const dn = dx * n[0] + dy * n[1] + dz * n[2];
      dx -= n[0] * dn; dy -= n[1] * dn; dz -= n[2] * dn;
      let l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
      // oldalirány = d x n
      const sx = dy * n[2] - dz * n[1], sy = dz * n[0] - dx * n[2], sz = dx * n[1] - dy * n[0];
      const vx = this.vx[i], vy = this.vy[i], vz = this.vz[i];
      const vf = vx * dx + vy * dy + vz * dz, vs = vx * sx + vy * sy + vz * sz;
      let mu = SURF_MU[hit.surf] * s.grip;
      if (w.hy < W.water) mu *= 0.55;
      const fmax = mu * N;
      let Fl = driveTotal / 4;
      const kill = mShare / dt;
      if (!reverse && brake > 0.02) Fl += -Math.sign(vf) * Math.min(brake * s.brakeF / 4, Math.abs(vf) * kill * 0.5);
      let latGrip = 1;
      if (ct.handbrake > 0.1 && !w.front) { Fl = -Math.sign(vf) * Math.min(fmax, Math.abs(vf) * kill * 0.5); latGrip = 0.35; }
      if (Math.abs(throttle) < 0.05 && !reverse && brake < 0.05 && Math.abs(vf) < 0.4) Fl += -vf * kill * 0.4;
      Fl -= vf * 9; // gördülési ellenállás
      let Fsd = -vs * kill * 0.5;
      let fm = Math.hypot(Fl, Fsd);
      const lim = fmax * (Fsd !== 0 ? 1 : 1);
      w.slip = 0;
      if (fm > lim) { const k = lim / fm; Fl *= k; Fsd *= k * latGrip; w.slip = Math.min(1, (fm - lim) / (lim + 1)); }
      else if (latGrip < 1) { Fsd *= latGrip; w.slip = 0.5; }
      if (latGrip < 1) w.slip = Math.max(w.slip, Math.min(1, Math.abs(vs) / 6));
      FX[i] += dx * Fl + sx * Fsd; FY[i] += dy * Fl + sy * Fsd; FZ[i] += dz * Fl + sz * Fsd;
      w.load = N;
      w.spinRate = vf / s.wheelR;
    }
    this.contacts = contacts;
    for (const w of this.wheels) if (!w.contact) w.spinRate = (w.spinRate || 0) * 0.995 + (this.ctl.throttle * 40) * 0.005;

    // rakéta fúvókák
    if (s.rocket) {
      let using = false;
      if (this._jump) {
        this._jump = false;
        for (let i = 0; i < NN; i++) { this.vx[i] += u[0] * s.jumpDv; this.vy[i] += u[1] * s.jumpDv; this.vz[i] += u[2] * s.jumpDv; }
        this.fxUp = 1.5;
      }
      if (ct.boost > 0.1 && this.tank > 0) {
        const F = s.boostG * G * ct.boost;
        for (let i = 0; i < NN; i++) { const q = F * MI[i]; FX[i] += f[0] * q; FY[i] += f[1] * q; FZ[i] += f[2] * q; }
        this.tank -= s.boostUse * ct.boost * dt; using = true; this.fxBoost = ct.boost;
      }
      if (ct.up > 0.1 && this.tank > 0) {
        const F = s.upG * G * ct.up;
        for (let i = 0; i < NN; i++) { const q = F * MI[i]; FX[i] += u[0] * q; FY[i] += u[1] * q; FZ[i] += u[2] * q; }
        this.tank -= s.upUse * ct.up * dt; using = true; this.fxUp = Math.max(this.fxUp, ct.up);
      }
      const manual = Math.abs(ct.pitch) > 0.1 || Math.abs(ct.roll) > 0.1;
      // ugrás / lebegés közben a helyzetszabályzó fúvókák vízszintben tartják az autót
      const level = (ct.up > 0.1 || this.jumpT > 0) && this.u[1] > 0.3;
      if (contacts < 2 && (manual || level) && this.tank > 0) {
        this._attitude(ct.pitch, ct.roll, FX, FY, FZ, level);
        this.tank -= s.attUse * dt; using = true; this.fxAtt = 1;
      }
      if (!using) this.tank = Math.min(s.tank, this.tank + s.refill * (this.refillMul || 1) * dt);
      this.tank = Math.max(0, this.tank);
    }

    // integrálás
    const water = W.water;
    let wet = 0;
    for (let i = 0; i < NN; i++) {
      const wi = this.wi[i];
      let ax = FX[i] * wi, ay = FY[i] * wi - G, az = FZ[i] * wi;
      if (this.y[i] < water + 0.3) {
        const depth = Math.min(1, (water + 0.3 - this.y[i]) / 0.8);
        ay += G * 0.95 * depth;
        const k = 1.6 * depth;
        ax -= this.vx[i] * k; ay -= this.vy[i] * k * 1.5; az -= this.vz[i] * k;
        wet += depth;
      }
      this.vx[i] += ax * dt; this.vy[i] += ay * dt; this.vz[i] += az * dt;
      this.px[i] = this.x[i]; this.py[i] = this.y[i]; this.pz[i] = this.z[i];
      this.x[i] += this.vx[i] * dt; this.y[i] += this.vy[i] * dt; this.z[i] += this.vz[i] * dt;
    }
    this.inWater = wet / NN;

    // kényszerek (plasztikus alakváltozással)
    this._solve(true);
    this._solve(false);

    // ütközések
    const p = this._p, col = this.col;
    let dentBest = 0, dentI = -1, dnx = 0, dny = 0, dnz = 0;
    for (let i = 0; i < NN; i++) {
      const bottom = !(this.ly[i] > (s.yb || 0) + 0.01);
      const r = bottom ? (s.nodeRb || s.nodeR) : s.nodeR;
      p[0] = this.x[i]; p[1] = this.y[i]; p[2] = this.z[i];
      const pen = W.collidePoint(p, r, this.near, col);
      if (pen > 0) {
        // súrlódás
        const nx = col.nx, ny = col.ny, nz = col.nz;
        let dx = p[0] - this.px[i], dy = p[1] - this.py[i], dz = p[2] - this.pz[i];
        const vn = dx * nx + dy * ny + dz * nz;
        const tx = dx - nx * vn, ty = dy - ny * vn, tz = dz - nz * vn;
        const tl = Math.hypot(tx, ty, tz);
        if (tl > 1e-9) {
          const k = Math.min(1, col.mu * (bottom && this.contacts > 1 ? 0.15 : 1) * pen / tl);
          p[0] -= tx * k; p[1] -= ty * k; p[2] -= tz * k;
        }
        const iv = -(this.vx[i] * nx + this.vy[i] * ny + this.vz[i] * nz);
        if (iv > this.impact) this.impact = iv;
        if (iv > dentBest) { dentBest = iv; dentI = i; dnx = col.nx; dny = col.ny; dnz = col.nz; }
        this.x[i] = p[0]; this.y[i] = p[1]; this.z[i] = p[2];
      }
    }
    if (dentBest > 5 && dentI >= 0) this.addDent(this.lx[dentI], this.ly[dentI], this.lz[dentI], dnx, dny, dnz, dentBest);
    if (this.near.trees.length || this.near.boxes.length) this._thin(dt);
  }
  // helyi horpadás (csak megjelenítés + sérülés)
  addDent(lx, ly, lz, nx, ny, nz, iv, dmgMul = 1) {
    const f = this.f, u = this.u, r = this.r;
    const amt = Math.min(0.16, (iv - 5) * 0.011);          // sérülésbe számított érték
    const vis = Math.min(0.24, (iv - 5) * 0.017);          // megjelenített mélység
    if (vis <= 0.003) return;
    if (this.dents.length > 40) this.dents.shift();
    this.dents.push({ lx, ly, lz, nx: nx * f[0] + ny * f[1] + nz * f[2], ny: nx * u[0] + ny * u[1] + nz * u[2], nz: nx * r[0] + ny * r[1] + nz * r[2], amt, vis, iv });
    if (iv >= DENT_DMG_MIN_IV) this.dentSum = Math.min(6, this.dentSum + amt * dmgMul);
  }
  // vékony akadályok (fák, oszlopok) a karosszéria dobozával
  _thin(dt) {
    const s = this.spec;
    this.frame();
    const c = this.c, f = this.f, r = this.r, u = this.u;
    const items = this._thinList;
    items.length = 0;
    for (const t of this.near.trees) if (!t.down) items.push(t);
    for (const b of this.near.boxes) if (b.kind === 'pillar') items.push(b);
    const yb = s.yb || 0, hh = s.h / 2;
    for (const o of items) {
      const isTree = o.h !== undefined && o.kind === undefined;
      const rad = isTree ? o.r : 0.4;
      const y0 = isTree ? o.y - 1 : o.y - o.hy, y1 = isTree ? o.y + o.h * 0.75 : o.y + o.hy;
      const oy = Math.max(y0, Math.min(y1, c[1]));
      const dx = o.x - c[0], dy = oy - c[1], dz = o.z - c[2];
      const lu = dx * u[0] + dy * u[1] + dz * u[2];
      if (Math.abs(lu) > hh + 0.3) continue;
      const lf = dx * f[0] + dy * f[1] + dz * f[2], lr = dx * r[0] + dy * r[1] + dz * r[2];
      const pf = s.len / 2 + rad - Math.abs(lf), pr = s.wid / 2 + rad - Math.abs(lr);
      if (pf <= 0 || pr <= 0) continue;
      const pmin = Math.min(pf, pr);
      const sp = this.speed;
      if (isTree && (pmin > 0.45 || sp > 12 || c[1] > o.y + o.h * 0.45)) {
        // a fa kidől: a kocsi átmegy rajta, de lassul és horpad
        o.down = true;
        o.fallYaw = Math.atan2(this.v[2], this.v[0]);
        const keep = sp > 12 ? 0.72 : 0.9;
        for (let i = 0; i < NN; i++) {
          this.px[i] = this.x[i] - (this.x[i] - this.px[i]) * keep;
          this.py[i] = this.y[i] - (this.y[i] - this.py[i]) * keep;
          this.pz[i] = this.z[i] - (this.z[i] - this.pz[i]) * keep;
        }
        const front = pf < pr;
        const sg = front ? Math.sign(lf) : Math.sign(lr);
        const ix = front ? (sg > 0 ? 3 : 0) : 1, iz = front ? 0 : (sg > 0 ? 1 : 0);
        const lx = front ? sg * s.len / 2 : Math.max(-s.len / 2, Math.min(s.len / 2, lf));
        const lz = front ? Math.max(-s.wid / 2, Math.min(s.wid / 2, lr)) : sg * s.wid / 2;
        const nW = front ? [-f[0] * sg, -f[1] * sg, -f[2] * sg] : [-r[0] * sg, -r[1] * sg, -r[2] * sg];
        this.addDent(lx, yb + s.h * 0.7, lz, nW[0], nW[1], nW[2], 5 + Math.min(14, sp * 0.8));
        this.impact = Math.max(this.impact, Math.min(12, sp * 0.6));
        this.treeHit = o;
        continue;
      }
      const lim = 0.02;
      if (pf < pr) {
        const sg = Math.sign(lf), face = sg > 0 ? 3 : 0, nxt = sg > 0 ? 2 : 1, q = Math.min(pf, lim);
        for (let iy = 0; iy < 2; iy++) for (let iz = 0; iz < 2; iz++) {
          const i = Car.idx(face, iy, iz), j = Car.idx(nxt, iy, iz);
          this.x[i] -= f[0] * q * sg; this.y[i] -= f[1] * q * sg; this.z[i] -= f[2] * q * sg;
          this.x[j] -= f[0] * q * sg * 0.3; this.y[j] -= f[1] * q * sg * 0.3; this.z[j] -= f[2] * q * sg * 0.3;
        }
        this.impact = Math.max(this.impact, Math.abs(this.fwdSpeed));
      } else {
        const sg = Math.sign(lr), iz = sg > 0 ? 1 : 0, q = Math.min(pr, lim);
        for (let ix = 0; ix < 4; ix++) {
          const w = Math.max(0, 1 - Math.abs(this.xs[ix] - lf) / 1.6);
          if (w <= 0) continue;
          for (let iy = 0; iy < 2; iy++) {
            const i = Car.idx(ix, iy, iz);
            this.x[i] -= r[0] * q * sg * w; this.y[i] -= r[1] * q * sg * w; this.z[i] -= r[2] * q * sg * w;
          }
        }
        this.impact = Math.max(this.impact, Math.abs(this.v[0] * r[0] + this.v[1] * r[1] + this.v[2] * r[2]));
      }
    }
  }
  substepB(dt) {
    if (this._carHitT > 0) this._carHitT--;
    if (this._carDentT > 0) this._carDentT -= dt;
    for (let i = 0; i < NN; i++) {
      this.vx[i] = (this.x[i] - this.px[i]) / dt * 0.99985;
      this.vy[i] = (this.y[i] - this.py[i]) / dt * 0.99985;
      this.vz[i] = (this.z[i] - this.pz[i]) / dt * 0.99985;
    }
    // biztonság
    if (!(this.x[0] === this.x[0]) || this.y[0] < -200) this.resetHere2();
  }
  resetHere2() {
    const st = this.world.starts[0];
    this.reset(st.x, st.z, st.yaw);
  }
  _solve(plastic) {
    const s = this.spec, X = this.x, Y = this.y, Z = this.z;
    for (let k = 0; k < this.nb; k++) {
      const a = this.ba[k], b = this.bb[k];
      const dx = X[b] - X[a], dy = Y[b] - Y[a], dz = Z[b] - Z[a];
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-9) continue;
      let rest = this.rest[k];
      if (plastic) {
        const strain = (len - rest) / rest, as = Math.abs(strain);
        if (as > s.yieldStrain) {
          const o = this.orig[k];
          rest += Math.sign(strain) * (as - s.yieldStrain) * rest * s.plastic * (this._carHitT > 0 ? (this.carDmgMul ?? 1) : 1);
          rest = Math.min(o * (1 + s.maxDeform * 0.5), Math.max(o * (1 - s.maxDeform), rest));
          this.rest[k] = rest;
        }
      }
      const wa = this.wi[a], wb = this.wi[b];
      const corr = (len - rest) / len / (wa + wb);
      X[a] += dx * corr * wa; Y[a] += dy * corr * wa; Z[a] += dz * corr * wa;
      X[b] -= dx * corr * wb; Y[b] -= dy * corr * wb; Z[b] -= dz * corr * wb;
    }
  }
  // szögsebesség becslés + szöggyorsítás alkalmazása (fúvókák)
  _attitude(pitch, roll, FX, FY, FZ, level) {
    const c = [0, 0, 0], v = [0, 0, 0], MI = this.mi;
    for (let i = 0; i < NN; i++) { const q = MI[i] / this.M; c[0] += this.x[i] * q; c[1] += this.y[i] * q; c[2] += this.z[i] * q; v[0] += this.vx[i] * q; v[1] += this.vy[i] * q; v[2] += this.vz[i] * q; }
    let Ixx = 0, Iyy = 0, Izz = 0, Ixy = 0, Ixz = 0, Iyz = 0, Lx = 0, Ly = 0, Lz = 0;
    for (let i = 0; i < NN; i++) {
      const rx = this.x[i] - c[0], ry = this.y[i] - c[1], rz = this.z[i] - c[2];
      const ux = this.vx[i] - v[0], uy = this.vy[i] - v[1], uz = this.vz[i] - v[2];
      const q = MI[i];
      Lx += q * (ry * uz - rz * uy); Ly += q * (rz * ux - rx * uz); Lz += q * (rx * uy - ry * ux);
      Ixx += q * (ry * ry + rz * rz); Iyy += q * (rx * rx + rz * rz); Izz += q * (rx * rx + ry * ry);
      Ixy -= q * rx * ry; Ixz -= q * rx * rz; Iyz -= q * ry * rz;
    }
    const w = solve3(Ixx, Ixy, Ixz, Ixy, Iyy, Iyz, Ixz, Iyz, Izz, Lx, Ly, Lz);
    const f = this.f, r = this.r;
    const wr = w[0] * r[0] + w[1] * r[1] + w[2] * r[2];
    const wf = w[0] * f[0] + w[1] * f[1] + w[2] * f[2];
    let tr = -pitch * 3.8, tf = roll * 4.5;
    if (level) {
      // u -> függőleges felé forgató tengely: u x (0,1,0)
      const ex = -this.u[2], ez = this.u[0];
      if (Math.abs(pitch) < 0.1) tr += (ex * r[0] + ez * r[2]) * 4;
      if (Math.abs(roll) < 0.1) tf += (ex * f[0] + ez * f[2]) * 4;
    }
    let ar = (tr - wr) * 7, af = (tf - wf) * 7;
    ar = Math.max(-14, Math.min(14, ar)); af = Math.max(-16, Math.min(16, af));
    const ax = r[0] * ar + f[0] * af, ay = r[1] * ar + f[1] * af, az = r[2] * ar + f[2] * af;
    for (let i = 0; i < NN; i++) {
      const m = MI[i];
      const rx = this.x[i] - c[0], ry = this.y[i] - c[1], rz = this.z[i] - c[2];
      FX[i] += m * (ay * rz - az * ry); FY[i] += m * (az * rx - ax * rz); FZ[i] += m * (ax * ry - ay * rx);
    }
  }
}
function solve3(a, b, c, d, e, f, g, h, i, x, y, z) {
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-9) return [0, 0, 0];
  const D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g);
  const Gg = b * f - c * e, Hh = -(a * f - c * d), I = a * e - b * d;
  return [(A * x + D * y + Gg * z) / det, (B * x + E * y + Hh * z) / det, (C * x + F * y + I * z) / det];
}

// két autó ütközése (rács-pont vs. másik autó doboza)
function carCarCollide(A, B) {
  if (Math.abs(A.c[0] - B.c[0]) > 8 || Math.abs(A.c[2] - B.c[2]) > 8 || Math.abs(A.c[1] - B.c[1]) > 8) return 0;
  let imp = 0;
  for (const [P, Q] of [[A, B], [B, A]]) {
    Q.frame();
    const hx = Q.spec.len / 2, hy = Q.spec.h / 2 + 0.05, hz = Q.spec.wid / 2;
    const r = P.spec.nodeR;
    for (let i = 0; i < NN; i++) {
      const dx = P.x[i] - Q.c[0], dy = P.y[i] - Q.c[1], dz = P.z[i] - Q.c[2];
      const lf = dx * Q.f[0] + dy * Q.f[1] + dz * Q.f[2];
      const lu = dx * Q.u[0] + dy * Q.u[1] + dz * Q.u[2];
      const lr = dx * Q.r[0] + dy * Q.r[1] + dz * Q.r[2];
      const pf = hx + r - Math.abs(lf), pu = hy + r - Math.abs(lu), pr = hz + r - Math.abs(lr);
      if (pf <= 0 || pu <= 0 || pr <= 0) continue;
      let n, pen;
      if (pf < pu && pf < pr) { n = Q.f; pen = pf * Math.sign(lf); }
      else if (pu < pr) { n = Q.u; pen = pu * Math.sign(lu); }
      else { n = Q.r; pen = pr * Math.sign(lr); }
      const a = pen * 16 / 17, b = pen / 17;
      P.x[i] += n[0] * a; P.y[i] += n[1] * a; P.z[i] += n[2] * a;
      for (let j = 0; j < NN; j++) { Q.x[j] -= n[0] * b; Q.y[j] -= n[1] * b; Q.z[j] -= n[2] * b; }
      imp = Math.max(imp, Math.abs(pen));
    }
  }
  return imp;
}

if (typeof module !== 'undefined') module.exports = { World, Car, SPECS, SURF, SURF_MU, SURF_NAME, carCarCollide, hashStr, mulberry32, G };
