'use strict';
// ============================================================
//  HUNYÓ – megjelenítés (Three.js)
// ============================================================

const PAL = {
  grass: [0x86ab5c, 0x7aa253, 0x8fb364, 0x739c4d],
  forest: [0x5f8c47, 0x56823f],
  rock: [0x8d867b, 0x7f786e, 0x968f84],
  snow: [0xf3f5f8, 0xe8edf2, 0xdde5ee],
  sand: [0xdcc794, 0xd2bc88],
  sandWet: [0xa7976f, 0x9a8b66],
  pad: [0xb8b0a2, 0xb0a899, 0xbdb5a8],
  water: 0x1f4f6e,
  skyTop: 0x04060f, skyHor: 0x1a2147, skyGlow: 0x4a3f78, fog: 0x10162e,
};
const _col = new THREE.Color();
const hcol = (hex) => _col.setHex(hex);
const hash2 = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };

const DENT_MAX_OFF = 0.35;   // a horpadás csúcsonkénti legnagyobb elmozdulása (m)
// egyszerű geometria-építő (nem indexelt, csúcsszínekkel)
class GB {
  constructor() { this.p = []; this.c = []; }
  tri(a, b, c, hex, dn) {
    if (dn) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nx * dn[0] + ny * dn[1] + nz * dn[2] < 0) { const t = b; b = c; c = t; }
    }
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    const col = hcol(hex);
    for (let k = 0; k < 3; k++) this.c.push(col.r, col.g, col.b);
  }
  quad(a, b, c, d, hex, dn) { this.tri(a, b, c, hex, dn); this.tri(a, c, d, hex, dn); }
  box(cx, cy, cz, sx, sy, sz, hex, hexTop) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    const P = (x, y, z) => [x, y, z];
    this.quad(P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1), hex, [1, 0, 0]);
    this.quad(P(x0, y0, z0), P(x0, y1, z0), P(x0, y1, z1), P(x0, y0, z1), hex, [-1, 0, 0]);
    this.quad(P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1), hexTop ?? hex, [0, 1, 0]);
    this.quad(P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1), hex, [0, -1, 0]);
    this.quad(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1), hex, [0, 0, 1]);
    this.quad(P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0), hex, [0, 0, -1]);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeVertexNormals();
    return g;
  }
}
const lambert = (opts = {}) => new THREE.MeshLambertMaterial(Object.assign({ vertexColors: true, flatShading: true }, opts));

// ------------------------------------------------------------
class WorldView {
  constructor(scene, world) {
    this.scene = scene; this.world = world;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.buildTerrain();
    this.buildWater();
    this.buildTrees();
    this.buildRocks();
    this.buildStructures();
    this.buildNight();
    this.buildFish();
    this.launch = new LaunchView(this.group, this.world);
  }
  // halak a tavakban: halványan derengő pontyok, néha kiugranak
  buildFish() {
    const W = this.world, rnd = mulberry32(99);
    const spots = [];
    for (let k = 0; k < 6000 && spots.length < 70; k++) {
      const x = (rnd() * 2 - 1) * W.half * 0.9, z = (rnd() * 2 - 1) * W.half * 0.9;
      const bottom = W.heightAt(x, z);
      if (bottom > W.water - 1.6) continue;
      spots.push({ x, z, bottom });
    }
    this.fish = [];
    if (!spots.length) return;
    const gb = new GB();
    const body = 0xff8a3d, belly = 0xffd2a0, fin = 0xff5f2a;
    const N = [0.42, 0, 0], T = [-0.3, 0, 0], U = [0, 0.11, 0], D = [0, -0.1, 0], L = [0.02, 0, -0.08], Rr = [0.02, 0, 0.08];
    gb.tri(N, U, Rr, body, [0.3, 1, 0.5]); gb.tri(N, Rr, D, belly, [0.3, -1, 0.5]); gb.tri(N, D, L, belly, [0.3, -1, -0.5]); gb.tri(N, L, U, body, [0.3, 1, -0.5]);
    gb.tri(T, Rr, U, body, [-0.3, 1, 0.5]); gb.tri(T, D, Rr, belly, [-0.3, -1, 0.5]); gb.tri(T, L, D, belly, [-0.3, -1, -0.5]); gb.tri(T, U, L, body, [-0.3, 1, -0.5]);
    gb.tri([-0.28, 0, 0], [-0.5, 0.13, 0], [-0.5, -0.13, 0], fin, [0, 0, 1]); gb.tri([-0.28, 0, 0], [-0.5, -0.13, 0], [-0.5, 0.13, 0], fin, [0, 0, -1]);
    gb.tri([0.05, 0.1, 0], [-0.12, 0.2, 0], [-0.15, 0.08, 0], fin, [0, 0, 1]); gb.tri([0.05, 0.1, 0], [-0.15, 0.08, 0], [-0.12, 0.2, 0], fin, [0, 0, -1]);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0xd0581c });
    const mesh = new THREE.InstancedMesh(gb.geometry(), mat, spots.length);
    mesh.frustumCulled = false;
    const tint = new THREE.Color();
    spots.forEach((p, i) => {
      const depthMax = Math.min(2.6, W.water - p.bottom - 0.4);
      const kind = rnd();
      tint.setRGB(1, kind < 0.3 ? 1 : 0.85 + rnd() * 0.15, kind < 0.3 ? 1 : 0.8);
      if (kind > 0.85) tint.setRGB(0.55, 0.75, 1.2);
      mesh.setColorAt(i, tint);
      this.fish.push({ hx: p.x, hz: p.z, a: rnd() * 6.28, w: (0.25 + rnd() * 0.35) * (rnd() < 0.5 ? -1 : 1), rad: 2 + rnd() * 6,
        depth: 0.5 + rnd() * Math.max(0.2, depthMax - 0.5), s: 0.8 + rnd() * 1.1, x: p.x, y: W.water - 1, z: p.z,
        jump: 0, vy: 0, vx: 0, vz: 0, flee: 0, phase: rnd() * 10, sx: p.x, sz: p.z });
    });
    this.fishMesh = mesh;
    this.group.add(mesh);
    this._fm = new THREE.Matrix4(); this._fq = new THREE.Quaternion(); this._fe = new THREE.Euler(0, 0, 0, 'YZX'); this._fp = new THREE.Vector3(); this._fs = new THREE.Vector3();
  }
  updateFish(dt, cars, P) {
    if (!this.fishMesh) return;
    const W = this.world, wl = W.water, t = this.waterT;
    this.fish.forEach((f, i) => {
      let yaw, pitch = 0;
      if (f.jump > 0) {
        f.vy -= 9.81 * dt;
        f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
        yaw = Math.atan2(f.vz, f.vx); pitch = Math.atan2(f.vy, Math.hypot(f.vx, f.vz));
        if (f.y < wl && f.vy < 0) {
          f.jump = 0;
          if (P) for (let k = 0; k < 10; k++) P.emit(f.x, wl + 0.05, f.z, (Math.random() - 0.5) * 2, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 2, 0xdff2ff, 0.25, 0.7, 0.6, 1, 6);
          f.hx = f.x - Math.cos(f.a) * f.rad; f.hz = f.z - Math.sin(f.a) * f.rad;
        }
      } else {
        // menekülés az autó elől
        let fx = 0, fz = 0;
        for (const c of cars) {
          const dx = f.x - c.c[0], dz = f.z - c.c[2], d = Math.hypot(dx, dz);
          if (d < 9 && c.c[1] < wl + 3) { fx += dx / (d + 0.1); fz += dz / (d + 0.1); f.flee = 1.5; }
        }
        f.flee = Math.max(0, f.flee - dt);
        const sp = 1 + f.flee * 2.5;
        f.a += f.w * sp * dt;
        // az otthon pont csak vízben mozdulhat
        const hx2 = f.hx + fx * dt * 4, hz2 = f.hz + fz * dt * 4;
        if (W.heightAt(hx2, hz2) < wl - 0.8) { f.hx = hx2; f.hz = hz2; }
        const nx = f.hx + Math.cos(f.a) * f.rad + Math.sin(t * 0.7 + f.phase) * 0.6, nz = f.hz + Math.sin(f.a) * f.rad;
        const bottom = W.heightAt(nx, nz);
        if (bottom > wl - 0.5) { f.w = -f.w; f.a += f.w * sp * dt * 2; }
        else { f.x = nx; f.z = nz; }
        // biztonsági háló: ha valahogy szárazra került, vissza a kiinduló helyére
        if (W.heightAt(f.x, f.z) > wl - 0.35) { f.x = f.hx = f.sx; f.z = f.hz = f.sz; f.flee = 0; }
        f.y = Math.min(wl - 0.15, Math.max(W.heightAt(f.x, f.z) + 0.3, wl - f.depth + Math.sin(t * 1.3 + f.phase) * 0.15));
        yaw = f.a + (f.w > 0 ? Math.PI / 2 : -Math.PI / 2);
        // néha kiugrik
        if (Math.random() < dt * 0.025 && f.depth < 2) {
          const h = 3 + Math.random() * 2;
          const vx = Math.cos(yaw) * h * 0.8, vz = Math.sin(yaw) * h * 0.8, vy = 4 + Math.random() * 2.5;
          const tf = 2 * vy / 9.81;
          // csak akkor ugrik, ha a teljes ív alatt (és a landolásnál) mély víz van
          let ok = true;
          for (let k = 1; k <= 4 && ok; k++) { const q = k / 4 * tf; if (W.heightAt(f.x + vx * q, f.z + vz * q) > wl - 0.8) ok = false; }
          if (ok) {
            f.jump = 1; f.vx = vx; f.vz = vz; f.vy = vy; f.y = wl;
            if (P) for (let k = 0; k < 8; k++) P.emit(f.x, wl + 0.05, f.z, (Math.random() - 0.5) * 1.5, 1 + Math.random() * 2, (Math.random() - 0.5) * 1.5, 0xdff2ff, 0.22, 0.6, 0.55, 1, 6);
          }
        }
      }
      const wig = Math.sin(t * (6 + f.flee * 6) + f.phase) * 0.18;
      this._fe.set(0, -yaw + wig, pitch);
      this._fq.setFromEuler(this._fe);
      this._fm.compose(this._fp.set(f.x, f.y, f.z), this._fq, this._fs.set(f.s, f.s, f.s));
      this.fishMesh.setMatrixAt(i, this._fm);
    });
    this.fishMesh.instanceMatrix.needsUpdate = true;
  }
  // éjszakai fények: neon csíkok, fénytornyok, lidércfények
  buildNight() {
    const W = this.world, Z = W.zone, y0 = Z.h;
    const NEON_C = 0x3ff0ff, NEON_M = 0xff3fd2;
    for (const r of W.ramps) {
      const ng = new GB();
      const n = Math.ceil(r.thetaMax / (Math.PI / 48));
      const P = (th, rad, z) => [rad * Math.sin(th), r.R - rad * Math.cos(th), z];
      for (let i = 0; i < n; i++) {
        const t0 = i / n * r.thetaMax, t1 = (i + 1) / n * r.thetaMax, tm = (t0 + t1) / 2;
        const inN = [-Math.sin(tm), Math.cos(tm), 0];
        for (const sz of [-1, 1]) {
          const z0 = sz * (r.W / 2 - 0.02), z1 = sz * (r.W / 2 - 0.16);
          ng.quad(P(t0, r.R - 0.02, z0), P(t1, r.R - 0.02, z0), P(t1, r.R - 0.02, z1), P(t0, r.R - 0.02, z1), r.wallH ? NEON_M : NEON_C, inN);
        }
      }
      const m = new THREE.Mesh(ng.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
      m.position.set(r.x, r.y, r.z); m.rotation.y = -r.yaw;
      this.group.add(m);
    }
    for (const b of W.boxes) if (b.kind === 'wall') {
      const ng = new GB();
      for (let k = 0; k < 6; k++) ng.box(-b.hx - 0.03, -b.hy + 3 + k * 4, 0, 0.02, 0.14, b.hz * 2 - 0.2, k % 2 ? NEON_C : NEON_M);
      for (const sz of [-1, 1]) ng.box(-b.hx - 0.03, 0, sz * (b.hz - 0.1), 0.02, b.hy * 2, 0.12, NEON_M);
      const m = new THREE.Mesh(ng.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
      m.position.set(b.x, b.y, b.z); m.rotation.y = -b.yaw;
      this.group.add(m);
    }
    // fénytornyok
    const towers = [
      { at: [-6, -30], aim: [18, 22, -12], col: 0x46e8ff, I: 2400 },
      { at: [44, -32], aim: [16, 14, -12], col: 0xff4fd8, I: 2400 },
      { at: [6, 36], aim: [34, 18, 16], col: 0x9a6bff, I: 1500 },
      { at: [-48, 34], aim: [-28, 0, 16], col: 0xffb35c, I: 1300 },
    ];
    this.zoneLights = [];
    const tg = new GB();
    for (const t of towers) {
      const [tx, tz] = W.fromZone(t.at[0], t.at[1]);
      const ty = W.heightAt(tx, tz);
      const H = 11;
      tg.box(tx, ty + H / 2, tz, 0.3, H, 0.3, 0x2a2e36);
      tg.box(tx, ty + H, tz, 1.2, 0.5, 0.7, 0x1a1c22);
      const [ax, az] = W.fromZone(t.aim[0], t.aim[2]);
      const L = new THREE.SpotLight(t.col, t.I, 140, 0.55, 0.6, 1.4);
      L.position.set(tx, ty + H + 0.2, tz);
      L.target.position.set(ax, y0 + t.aim[1], az);
      this.group.add(L); this.group.add(L.target);
      this.zoneLights.push(L);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex(false), color: t.col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      halo.position.set(tx, ty + H - 0.1, tz); halo.scale.set(4, 4, 1);
      this.group.add(halo);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.5), new THREE.MeshBasicMaterial({ color: t.col, toneMapped: false }));
      lamp.position.set(tx, ty + H - 0.3, tz);
      this.group.add(lamp);
    }
    const tm = new THREE.Mesh(tg.geometry(), lambert());
    tm.castShadow = true;
    this.group.add(tm);
    // lidércfények az erdők felett
    const rnd = mulberry32(7), pos = [], ph = [];
    for (let i = 0; i < 420 && W.trees.length; i++) {
      const t = W.trees[Math.floor(rnd() * W.trees.length)];
      pos.push(t.x + (rnd() - 0.5) * 14, t.y + 0.8 + rnd() * 5, t.z + (rnd() - 0.5) * 14);
      ph.push(rnd() * 100);
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    fg.setAttribute('aPh', new THREE.Float32BufferAttribute(ph, 1));
    this.flyMat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 } },
      vertexShader: `attribute float aPh; uniform float uT; varying float vA;
        void main(){ vec3 p = position + vec3(sin(uT*0.3+aPh)*1.2, sin(uT*0.5+aPh*1.7)*0.6, cos(uT*0.27+aPh)*1.2);
          vec4 mv = modelViewMatrix * vec4(p,1.0); gl_Position = projectionMatrix * mv;
          vA = pow(0.5+0.5*sin(uT*1.3+aPh*3.0), 3.0) * clamp(1.0 - (-mv.z)/160.0, 0.0, 1.0);
          gl_PointSize = 90.0 / max(1.0, -mv.z); }`,
      fragmentShader: `varying float vA; void main(){ float r = length(gl_PointCoord-0.5); if (r>0.5) discard;
          gl_FragColor = vec4(0.75, 1.0, 0.55, vA * smoothstep(0.5, 0.0, r)); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const flies = new THREE.Points(fg, this.flyMat);
    flies.frustumCulled = false;
    this.group.add(flies);
  }
  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); } });
  }
  buildTerrain() {
    const W = this.world, N = W.N, c = W.cell, H = W.H, half = W.half;
    const pos = new Float32Array(N * N * 18), col = new Float32Array(N * N * 18);
    let o = 0;
    const n = [0, 0, 0];
    const put = (x, y, z, cc) => { pos[o] = x; pos[o + 1] = y; pos[o + 2] = z; col[o] = cc.r; col[o + 1] = cc.g; col[o + 2] = cc.b; o += 3; };
    const forestN = (x, z) => W.noise.n2(x / 55 + 3, z / 55 - 7);
    const faceColor = (x, z, h, ny, i, j, k) => {
      const s = W.surfaceAt(x, z, h, ny);
      const r = hash2(i * 2 + k, j);
      let arr;
      if (s === SURF.SAND) arr = h < W.water - 0.3 ? PAL.sandWet : PAL.sand;
      else if (s === SURF.PAD) arr = PAL.pad;
      else if (s === SURF.ROCK) arr = PAL.rock;
      else if (s === SURF.SNOW) arr = PAL.snow;
      else arr = forestN(x, z) > 0.05 ? PAL.forest : PAL.grass;
      const nz = W.noise.n2(x / 38 + 11, z / 38 - 5) * 0.5 + 0.5;
      const ia = Math.min(arr.length - 1, Math.floor(nz * arr.length));
      const cc = _col.setHex(arr[ia]);
      const jit = 1 + (r - 0.5) * (s === SURF.PAD ? 0.035 : 0.07);
      cc.multiplyScalar(jit);
      if (s === SURF.SAND && h < W.water) { const d = Math.min(1, (W.water - h) / 10); cc.lerp(new THREE.Color(0x4f6f6a), d * 0.7); }
      return cc;
    };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x0 = -half + i * c, z0 = -half + j * c, x1 = x0 + c, z1 = z0 + c;
      const w = N + 1;
      const h00 = H[j * w + i], h10 = H[j * w + i + 1], h01 = H[(j + 1) * w + i], h11 = H[(j + 1) * w + i + 1];
      // 1. háromszög: 00, 01, 10
      let cx = x0 + c / 3, cz = z0 + c / 3, ch = (h00 + h10 + h01) / 3;
      W.normalAt(cx, cz, n);
      let cc = faceColor(cx, cz, ch, n[1], i, j, 0).clone();
      put(x0, h00, z0, cc); put(x0, h01, z1, cc); put(x1, h10, z0, cc);
      cx = x1 - c / 3; cz = z1 - c / 3; ch = (h11 + h10 + h01) / 3;
      W.normalAt(cx, cz, n);
      cc = faceColor(cx, cz, ch, n[1], i, j, 1).clone();
      put(x1, h11, z1, cc); put(x1, h10, z0, cc); put(x0, h01, z1, cc);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, lambert());
    m.receiveShadow = true;
    this.group.add(m);
    this.terrain = m;
  }
  buildWater() {
    const W = this.world, S = 72;
    const g = new THREE.PlaneGeometry(W.size, W.size, S, S).toNonIndexed();
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    this.waterBase = new Float32Array(p.array);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: PAL.water, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.74, flatShading: true }));
    m.position.y = W.water;
    m.receiveShadow = true;
    this.group.add(m);
    this.water = m;
    this.waterT = 0;
  }
  resetTrees() {
    const m4 = new THREE.Matrix4();
    this.treeBase.forEach((b, i) => { b.anim = 0; m4.compose(b.p, b.q, b.s); this.treeMesh.setMatrixAt(i, m4); });
    this.treeMesh.instanceMatrix.needsUpdate = true;
  }
  updateTrees(dt) {
    const trees = this.world.trees;
    let dirty = false;
    const m4 = this._tm || (this._tm = new THREE.Matrix4()), qa = this._tq || (this._tq = new THREE.Quaternion()), ax = this._ta || (this._ta = new THREE.Vector3()), pp = this._tp || (this._tp = new THREE.Vector3());
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i], b = this.treeBase[i];
      if (!t.down || b.anim >= 1) continue;
      b.anim = Math.min(1, b.anim + dt * 1.3);
      const e = b.anim * b.anim;
      const dx = Math.cos(t.fallYaw || 0), dz = Math.sin(t.fallYaw || 0);
      ax.set(dz, 0, -dx).normalize();
      qa.setFromAxisAngle(ax, 1.42 * e).multiply(b.q);
      pp.copy(b.p); pp.y -= 0.35 * e;
      m4.compose(pp, qa, b.s);
      this.treeMesh.setMatrixAt(i, m4);
      dirty = true;
    }
    if (dirty) this.treeMesh.instanceMatrix.needsUpdate = true;
  }
  update(dt, cars, P) {
    this.updateTrees(dt);
    if (this.launch) this.launch.update(dt, cars || [], P);
    this.updateFish(dt, cars || [], P);
    this.waterT += dt;
    if (this.flyMat) this.flyMat.uniforms.uT.value = this.waterT;
    const p = this.water.geometry.attributes.position, a = p.array, b = this.waterBase, t = this.waterT;
    for (let i = 0; i < a.length; i += 3) {
      const x = b[i], z = b[i + 2];
      a[i + 1] = Math.sin(x * 0.09 + t * 1.1) * 0.12 + Math.cos(z * 0.11 - t * 0.9) * 0.12;
    }
    p.needsUpdate = true;
    this.water.geometry.computeVertexNormals();
  }
  buildTrees() {
    const gb = new GB();
    const cyl = (r0, r1, h, y, seg, hex) => {
      for (let k = 0; k < seg; k++) {
        const a0 = k / seg * Math.PI * 2, a1 = (k + 1) / seg * Math.PI * 2;
        const A = [Math.cos(a0) * r0, y, Math.sin(a0) * r0], B = [Math.cos(a1) * r0, y, Math.sin(a1) * r0];
        const C = [Math.cos(a1) * r1, y + h, Math.sin(a1) * r1], D = [Math.cos(a0) * r1, y + h, Math.sin(a0) * r1];
        const am = (a0 + a1) / 2, dn = [Math.cos(am), 0.3, Math.sin(am)];
        if (r1 > 0.001) gb.quad(A, B, C, D, hex, dn); else gb.tri(A, B, [0, y + h, 0], hex, dn);
        gb.tri([0, y, 0], A, B, hex, [0, -1, 0]);
      }
    };
    cyl(0.22, 0.16, 1.4, 0, 5, 0x6b4a2f);
    cyl(1.7, 0, 3.0, 1.1, 7, 0x3f7a3c);
    cyl(1.25, 0, 2.5, 2.7, 7, 0x4f8d45);
    const geo = gb.geometry();
    const trees = this.world.trees;
    const mesh = new THREE.InstancedMesh(geo, lambert(), trees.length);
    this.treeMesh = mesh; this.treeBase = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), e = new THREE.Euler();
    const tint = new THREE.Color();
    trees.forEach((t, i) => {
      const sc = t.h / 5.2;
      e.set(0, hash2(i, 7) * 6.28, 0); q.setFromEuler(e);
      m4.compose(v.set(t.x, t.y - 0.2, t.z), q, s.set(t.s * sc * 0.9, sc, t.s * sc * 0.9));
      mesh.setMatrixAt(i, m4);
      this.treeBase.push({ p: v.clone(), q: q.clone(), s: s.clone(), anim: 0 });
      const k = 0.82 + hash2(i, 3) * 0.3;
      tint.setRGB(k, k * (0.95 + hash2(i, 5) * 0.1), k * 0.9);
      if (t.y > this.world.snowLine - 4) tint.setRGB(1.25, 1.3, 1.35);
      mesh.setColorAt(i, tint);
    });
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.group.add(mesh);
  }
  buildRocks() {
    const base = new THREE.IcosahedronGeometry(1, 0);
    const p = base.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 0.78 + hash2(Math.round(x * 100), Math.round(y * 100 + z * 37)) * 0.4;
      p.setXYZ(i, x * k, y * k * 0.8, z * k);
    }
    const cols = []; for (let i = 0; i < p.count; i++) { const c = hcol(PAL.rock[Math.floor(i / 3) % 3]); cols.push(c.r, c.g, c.b); }
    base.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    base.computeVertexNormals();
    const sp = this.world.spheres;
    const mesh = new THREE.InstancedMesh(base, lambert(), sp.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    sp.forEach((s, i) => {
      e.set(hash2(i, 1) * 0.5, s.rot, hash2(i, 2) * 0.5); q.setFromEuler(e);
      m4.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(s.r, s.r, s.r));
      mesh.setMatrixAt(i, m4);
    });
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.group.add(mesh);
  }
  buildStructures() {
    const W = this.world;
    for (const r of W.ramps) this.group.add(this.rampMesh(r));
    const gb = new GB();
    for (const b of W.boxes) {
      const g = new GB();
      if (b.kind === 'pillar') g.box(0, 0, 0, b.hx * 2, b.hy * 2, b.hz * 2, 0x5c6b7c);
      else if (b.kind === 'wall') {
        g.box(0, 0, 0, b.hx * 2, b.hy * 2, b.hz * 2, 0xcbc5b9);
        // csíkok a falon
        for (let k = 0; k < 6; k++) g.box(-b.hx - 0.01, -b.hy + 3 + k * 4, 0, 0.02, 0.5, b.hz * 2, 0x26262c);
      } else if (b.kind === 'parked') {
        g.box(0, -0.3, 0, b.hx * 2, 0.8, b.hz * 2, b.color);
        g.box(0, 0.4, -0.2, b.hx * 1.8, 0.62, b.hz * 1.05, 0x2a3644, b.color);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.box(sx * b.hx * 0.95, -0.42, sz * b.hz * 0.62, 0.25, 0.64, 0.64, 0x1c1c1e);
        g.box(0, -0.25, b.hz + 0.01, b.hx * 1.5, 0.12, 0.02, 0xfff1c0);
        g.box(0, -0.15, -b.hz - 0.01, b.hx * 1.6, 0.1, 0.02, 0xd02828);
      }
      const m = new THREE.Mesh(g.geometry(), lambert());
      m.position.set(b.x, b.y, b.z); m.rotation.y = -b.yaw;
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
    }
    // startvonalak és felfestések
    const Z = W.zone;
    const paint = new GB();
    for (const s of W.starts) {
      const [lx, lz] = W.toZone(s.x, s.z);
      for (let k = 0; k < 8; k++) paint.box(lx + 3, 0, lz - 3.5 + k, 0.5, 0.04, 0.5, (k % 2) ? 0x1d1d1d : 0xf5f5f5);
      for (let k = 0; k < 5; k++) {
        const x = lx + 20 + k * 14;
        paint.tri([x, 0.03, lz - 1.5], [x + 3, 0.03, lz], [x, 0.03, lz + 1.5], 0xf2c230, [0, 1, 0]);
      }
    }
    const pm = new THREE.Mesh(paint.geometry(), lambert());
    pm.position.set(Z.x, Z.h, Z.z); pm.rotation.y = -Z.yaw; pm.receiveShadow = true;
    this.group.add(pm);
    this.group.add(this.billboard());
  }
  billboard() {
    const W = this.world, Z = W.zone;
    const g = new THREE.Group();
    const gb = new GB();
    gb.box(-5.5, 3, 0, 0.3, 6, 0.3, 0x4a4f57); gb.box(5.5, 3, 0, 0.3, 6, 0.3, 0x4a4f57);
    gb.box(0, 5, -0.12, 12.4, 3.6, 0.2, 0x22242a);
    const posts = new THREE.Mesh(gb.geometry(), lambert());
    posts.castShadow = true;
    g.add(posts);
    const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 600;
    const x = cv.getContext('2d');
    const mono = '"Lucida Console", Consolas, "DejaVu Sans Mono", "Courier New", monospace';
    x.fillStyle = '#0000aa'; x.fillRect(0, 0, 2048, 600);
    x.strokeStyle = '#55ffff'; x.lineWidth = 14; x.strokeRect(26, 26, 1996, 548);
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = '#ffff55'; x.font = 'bold 250px ' + mono;
    x.fillText('HUNYÓ', 1024, 215);
    x.fillStyle = '#55ffff'; x.font = '74px ' + mono;
    x.fillText('A TEREP2 INSPIRÁLTA', 1024, 400);
    x.fillStyle = '#ffffff'; x.font = '60px ' + mono;
    x.fillText('Nagymáthé Dénes · 1994–1996', 1024, 492);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(12, 3.5), new THREE.MeshBasicMaterial({ map: tex }));
    board.position.set(0, 5, 0.0);
    g.add(board);
    const [bx, bz] = W.fromZone(-40, -36);
    g.position.set(bx, Z.h, bz);
    g.rotation.y = -Z.yaw;
    return g;
  }
  rampMesh(r) {
    const gb = new GB();
    const R = r.R, T = r.T, W = r.W, n = Math.ceil(r.thetaMax / (Math.PI / 32));
    const P = (th, rad, z) => [rad * Math.sin(th), R - rad * Math.cos(th), z];
    const zs = [-W / 2, -W / 2 + 0.55, -0.12, 0.12, W / 2 - 0.55, W / 2];
    for (let i = 0; i < n; i++) {
      const t0 = i / n * r.thetaMax, t1 = (i + 1) / n * r.thetaMax, tm = (t0 + t1) / 2;
      const inN = [-Math.sin(tm), Math.cos(tm), 0];
      for (let k = 0; k < zs.length - 1; k++) {
        let hex = 0x3a3d43;
        if (k === 0 || k === 4) hex = (i % 2) ? 0x1c1c1c : 0xf2c230;
        if (k === 2) hex = (i % 3 === 0) ? 0x3a3d43 : 0xf4f4f4;
        if (k === 1 || k === 3) hex = (i % 2) ? 0x3d4046 : 0x383b41;
        gb.quad(P(t0, R, zs[k]), P(t1, R, zs[k]), P(t1, R, zs[k + 1]), P(t0, R, zs[k + 1]), hex, inN);
      }
      // külső héj
      gb.quad(P(t0, R + T, -W / 2), P(t1, R + T, -W / 2), P(t1, R + T, W / 2), P(t0, R + T, W / 2), 0x9aa3ad, [-inN[0], -inN[1], 0]);
      // oldalak
      for (const sz of [-1, 1]) gb.quad(P(t0, R, sz * W / 2), P(t1, R, sz * W / 2), P(t1, R + T, sz * W / 2), P(t0, R + T, sz * W / 2), 0x7d8792, [0, 0, sz]);
    }
    const te = r.thetaMax;
    gb.quad(P(te, R, -W / 2), P(te, R + T, -W / 2), P(te, R + T, W / 2), P(te, R, W / 2), 0xf2c230, [Math.cos(te), Math.sin(te), 0]);
    const m = new THREE.Mesh(gb.geometry(), lambert());
    m.position.set(r.x, r.y, r.z); m.rotation.y = -r.yaw;
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
}

// ------------------------------------------------------------
// Autó modell (saját low-poly dizájn, kerékívekkel)
// lokális y: 0 = felfüggesztés rögzítési pontja; talaj szívással ~ -0.47
const S = (x, a, b, c, d, e) => ({ x, p: [a, b, c, d, e] });
const BODY = {
  raketa: {
    sections: [
      S(2.32, [0.70, -0.30], [0.82, -0.21], [0.80, -0.11], [0.40, -0.08], [0, -0.08]),
      S(1.95, [0.93, -0.32], [1.00, -0.15], [0.98, 0.17], [0.45, 0.10], [0, 0.08]),
      S(1.80, [0.95, -0.10], [1.01, 0.02], [0.99, 0.25], [0.47, 0.13], [0, 0.11]),
      S(1.60, [0.96, 0.20], [1.02, 0.24], [1.00, 0.34], [0.49, 0.16], [0, 0.14]),
      S(1.375, [0.96, 0.31], [1.02, 0.33], [1.00, 0.38], [0.50, 0.19], [0, 0.17]),
      S(1.15, [0.96, 0.20], [1.02, 0.24], [0.99, 0.35], [0.52, 0.23], [0, 0.22]),
      S(0.95, [0.96, -0.10], [1.02, 0.02], [0.98, 0.31], [0.55, 0.28], [0, 0.28]),
      S(0.80, [0.96, -0.33], [1.03, -0.03], [0.97, 0.30], [0.56, 0.31], [0, 0.31]),
      S(0.05, [0.97, -0.33], [1.03, 0.00], [0.95, 0.31], [0.60, 0.66], [0, 0.69]),
      S(-0.60, [0.98, -0.33], [1.05, 0.00], [1.00, 0.33], [0.58, 0.64], [0, 0.66]),
      S(-0.95, [0.99, -0.12], [1.06, 0.03], [1.03, 0.36], [0.60, 0.58], [0, 0.60]),
      S(-1.15, [1.00, 0.20], [1.07, 0.25], [1.05, 0.38], [0.61, 0.53], [0, 0.55]),
      S(-1.375, [1.00, 0.31], [1.07, 0.33], [1.05, 0.40], [0.62, 0.49], [0, 0.50]),
      S(-1.60, [1.00, 0.20], [1.07, 0.25], [1.05, 0.39], [0.62, 0.46], [0, 0.47]),
      S(-1.80, [0.99, -0.10], [1.05, 0.03], [1.03, 0.37], [0.62, 0.43], [0, 0.44]),
      S(-2.05, [0.97, -0.30], [1.03, 0.02], [1.00, 0.35], [0.62, 0.40], [0, 0.41]),
      S(-2.32, [0.92, -0.26], [0.98, 0.02], [0.95, 0.32], [0.62, 0.36], [0, 0.36]),
    ],
    color(si, band, c) {
      if (band === 4 || band === 5) return 0x0c0d0f;
      if (band === 0) return (si >= 6 && si <= 9) || si === 0 ? 0x121316 : c.body;
      if (band === 2 && si >= 7 && si <= 9) return 0x141b24;
      if (band === 3 && si === 7) return 0x141b24;
      if (band === 3 && si === 9) return 0x1a2129;
      return c.body;
    },
    front: (c) => c.body, rear: (c) => c.body,
    extras(gb, c) {
      // első légbeömlők
      for (const sz of [-1, 1]) gb.box(2.27, -0.22, sz * 0.5, 0.08, 0.1, 0.42, 0x0d0e10);
      gb.box(2.3, -0.27, 0, 0.06, 0.05, 0.5, 0x0d0e10);
      // oldalsó légbeömlő a hátsó kerék előtt
      for (const sz of [-1, 1]) gb.box(-0.78, 0.18, sz * 1.04, 0.3, 0.16, 0.03, 0x0d0e10);
      // motorfedél zsalu
      const ly = [0.6, 0.555, 0.51, 0.475];
      for (let k = 0; k < 4; k++) gb.box(-1.0 - k * 0.2, ly[k], 0, 0.09, 0.03, 0.85, c.dark);
      // hátsó diffúzor és lámpa sötét kerete
      gb.box(-2.28, -0.27, 0, 0.12, 0.1, 1.72, 0x0d0e10);
            gb.box(-2.335, 0.2, 0, 0.03, 0.12, 1.86, 0x111214);
      // négy kipufogó-szerű fúvóka középen
      for (const z of EXH_Z) {
        gb.cyl(-2.36, -0.11, z, 0.062, 0.14, 8, 0x9ea4ab);
        gb.box(-2.43, -0.11, z, 0.01, 0.075, 0.075, 0x070708);
      }
      gb.box(-2.345, -0.11, 0, 0.04, 0.2, 0.74, 0x16171a);
    },
    lights(gl, def) {
      // egy darabból álló, a motorháztető lejtőjére simuló, ék alakú lámpa
      const A = def.sections[0], B = def.sections[1];
      const pt = (x, s, sz) => {
        const t = (A.x - x) / (A.x - B.x);
        const za = A.p[3][0] + (A.p[2][0] - A.p[3][0]) * s, ya = A.p[3][1] + (A.p[2][1] - A.p[3][1]) * s;
        const zb = B.p[3][0] + (B.p[2][0] - B.p[3][0]) * s, yb = B.p[3][1] + (B.p[2][1] - B.p[3][1]) * s;
        return [x, ya + (yb - ya) * t + 0.035, sz * (za + (zb - za) * t)];
      };
      for (const sz of [-1, 1]) {
        const q = [pt(2.25, 0.30, sz), pt(2.22, 0.92, sz), pt(2.02, 0.95, sz), pt(1.98, 0.42, sz)];
        for (const dn of [[0.3, 1, 0], [-0.3, -1, 0]]) gl.quad(q[0], q[1], q[2], q[3], 0xf4f8ff, dn);
        const e = [pt(2.255, 0.28, sz), pt(2.235, 0.95, sz), pt(2.23, 0.95, sz), pt(2.25, 0.28, sz)];
        e[2][1] -= 0.03; e[3][1] -= 0.03;
        for (const dn of [[1, 0, 0], [-1, 0, 0]]) gl.quad(e[0], e[1], e[2], e[3], 0xbfe8ff, dn);
      }
      gl.box(-2.35, 0.2, 0, 0.02, 0.035, 1.78, 0xff1a1a);
      for (const sz of [-1, 1]) gl.box(-2.35, 0.17, sz * 0.86, 0.02, 0.09, 0.08, 0xff2a2a);
    },
    wheelW: 0.3, rim: 0x2f3338,
  }
};
const EXH_Z = [-0.27, -0.09, 0.09, 0.27];
const CAR_COLORS = {
  raketa: [{ body: 0xf3f3f0, dark: 0x1a1c20 }, { body: 0x2b2e34, dark: 0xd9d9d9 }, { body: 0xc8262c, dark: 0x1a1c20 }, { body: 0xf0c419, dark: 0x1a1c20 }, { body: 0x7b3fd1, dark: 0xe0e0e0 }, { body: 0x1f9e6e, dark: 0x1a1c20 }],
};
GB.prototype.cyl = function (cx, cy, cz, r, len, seg, hex) {
  // x tengely mentén
  for (let k = 0; k < seg; k++) {
    const a0 = k / seg * Math.PI * 2, a1 = (k + 1) / seg * Math.PI * 2;
    const y0 = Math.cos(a0) * r, z0 = Math.sin(a0) * r, y1 = Math.cos(a1) * r, z1 = Math.sin(a1) * r;
    const am = (a0 + a1) / 2, dn = [0, Math.cos(am), Math.sin(am)];
    this.quad([cx - len / 2, cy + y0, cz + z0], [cx + len / 2, cy + y0, cz + z0], [cx + len / 2, cy + y1, cz + z1], [cx - len / 2, cy + y1, cz + z1], hex, dn);
  }
};
function radialTex(inner, outer) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const x = cv.getContext('2d'), gr = x.createRadialGradient(64, 64, 2, 64, 64, 64);
  gr.addColorStop(0, inner); gr.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.45)')); gr.addColorStop(1, outer);
  x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
let _haloW = null, _haloR = null;
const haloTex = (red) => red ? (_haloR || (_haloR = radialTex('rgba(255,60,50,1)', 'rgba(255,0,0,0)'))) : (_haloW || (_haloW = radialTex('rgba(235,245,255,1)', 'rgba(200,220,255,0)')));

class CarView {
  constructor(scene, car, colorIdx, headlight) {
    this.car = car; this.scene = scene;
    const s = car.spec, def = BODY[s.id], cols = CAR_COLORS[s.id][colorIdx % CAR_COLORS[s.id].length];
    const gb = new GB();
    const rings = def.sections.map(sec => {
      // belső alsó pontok: az alj végig lent marad, a kerékív "plafonja" csak a kerék fölött emelkedik
      const p0y = sec.p[0][1], yIn = p0y < -0.25 ? p0y : -0.33, zIn = Math.min(0.62, sec.p[0][0] - 0.05);
      const ring = [[sec.x, yIn, zIn]];
      for (const [z, y] of sec.p) ring.push([sec.x, y, z]);
      for (let k = sec.p.length - 2; k >= 0; k--) ring.push([sec.x, sec.p[k][1], -sec.p[k][0]]);
      ring.push([sec.x, yIn, -zIn]);
      let ay = 0; for (const p of ring) ay += p[1]; ay /= ring.length;
      return { ring, ay, x: sec.x };
    });
    const bandOf = [5, 0, 1, 2, 3, 3, 2, 1, 0, 5, 4];
    for (let si = 0; si < rings.length - 1; si++) {
      const A = rings[si], B = rings[si + 1], nR = A.ring.length;
      for (let k = 0; k < nR; k++) {
        const k2 = (k + 1) % nR;
        const a = A.ring[k], b = A.ring[k2], c = B.ring[k2], d = B.ring[k];
        const cy = (a[1] + b[1] + c[1] + d[1]) / 4, cz = (a[2] + b[2] + c[2] + d[2]) / 4;
        // kifelé mutató irány sávonként (a kerékíveknél az átlag-alapú becslés hibázna)
        const band = bandOf[k], sz = Math.sign(cz) || 1;
        let dn = band === 4 ? [0, -1, 0] : band === 5 ? [0, -1, sz * 0.6] : band === 3 ? [0, 1, 0] : band === 2 ? [0, 0.6, sz] : [0, 0, sz];
        const hex = def.color(si, band, cols);
        gb.tri(a, b, c, hex, dn); gb.tri(a, c, d, hex, dn);
      }
    }
    for (const [R, sgn, fn] of [[rings[0], 1, def.front], [rings[rings.length - 1], -1, def.rear]]) {
      const ctr = [R.x, R.ay, 0], hex = fn(cols);
      for (let k = 0; k < R.ring.length; k++) gb.tri(ctr, R.ring[k], R.ring[(k + 1) % R.ring.length], hex, [sgn, 0, 0]);
    }
    def.extras(gb, cols);
    const gl = new GB();
    def.lights(gl, def);
    this.skins = [];
    this.body = this._skinned(gb.geometry(), lambert(), true);
    this.lightMesh = this._skinned(gl.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), false);
    this.geo = this.body.geometry;

    // kerekek
    this.wheels = [];
    const rw = s.wheelR, ww = def.wheelW;
    const tireG = new THREE.CylinderGeometry(rw, rw, ww, 16, 1).rotateX(Math.PI / 2).toNonIndexed();
    const rimG = new THREE.CylinderGeometry(rw * 0.66, rw * 0.66, 0.03, 10, 1).rotateX(Math.PI / 2).toNonIndexed();
    const hubG = new THREE.CylinderGeometry(rw * 0.2, rw * 0.2, 0.05, 6, 1).rotateX(Math.PI / 2).toNonIndexed();
    const tireM = new THREE.MeshLambertMaterial({ color: 0x18181a, flatShading: true });
    const rimM = new THREE.MeshLambertMaterial({ color: def.rim, flatShading: true });
    const hubM = new THREE.MeshLambertMaterial({ color: 0x9ea4ab, flatShading: true });
    for (const w of car.wheels) {
      const grp = new THREE.Group(); grp.matrixAutoUpdate = false;
      const spin = new THREE.Group();
      const t = new THREE.Mesh(tireG, tireM); t.castShadow = true;
      const r = new THREE.Mesh(rimG, rimM); r.position.z = w.side * (ww / 2 + 0.003);
      const hb = new THREE.Mesh(hubG, hubM); hb.position.z = w.side * (ww / 2 + 0.02);
      spin.add(t); spin.add(r); spin.add(hb);
      grp.add(spin);
      scene.add(grp);
      this.wheels.push({ grp, spin, w, angle: 0 });
    }
    this.objects = [this.body, this.lightMesh, ...this.wheels.map(w => w.grp)];
    // vizuális rugóút-korlát: a kerék ne bújjon ki a kerékíven
    const mo = -(s.yb || 0), maxLen = s.susLen + s.wheelR;
    const restComp = (1 + (s.suction || 0)) * s.mass * G / 4 / s.k;
    this.dMin = (maxLen - restComp) - s.wheelR - mo - 0.05;

    // fényszóró-halók, hátsó lámpa, fénynyaláb
    this.halos = [];
    const addHalo = (lx, ly, lz, red, size) => {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex(red), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: red ? 0.75 : 0.9 }));
      m.scale.set(size, size, 1); m.frustumCulled = false;
      scene.add(m); this.objects.push(m); this.halos.push({ m, l: [lx, ly, lz] });
    };
    for (const sz of [-1, 1]) addHalo(2.12, 0.06, sz * 0.66, false, 1.1);
    for (const sz of [-0.75, 0, 0.75]) addHalo(-2.4, 0.2, sz, true, 0.8);
    this.headlight = headlight;
    this.lightOut = [false, false]; this.bodyHex = cols.body;
    // lámpaállapot: lightOut = sérülés miatti kialvás; car.lampsOff = a játékos kapcsolója;
    // forceLamps/boostLamps = bújócska kereső; ping = bújócska felvillanás
    this.forceLamps = false; this.boostLamps = false; this.ping = false; this.hideGlow = false;
    this._lk = '';
    // halvány fénynyaláb (kúp) a két fényszóróból
    this.beams = [];
    {
      const bg = new THREE.ConeGeometry(1, 1, 14, 1, true).translate(0, -0.5, 0);
      const pos = bg.attributes.position, colA = new Float32Array(pos.count * 3);
      for (let v = 0; v < pos.count; v++) { const k = Math.max(0, 1 + pos.getY(v)); const c = 1 - k; colA[v * 3] = c * 0.8; colA[v * 3 + 1] = c * 0.88; colA[v * 3 + 2] = c; }
      bg.setAttribute('color', new THREE.BufferAttribute(colA, 3));
      const bm = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      for (let k = 0; k < 2; k++) { const m = new THREE.Mesh(bg, bm); m.frustumCulled = false; scene.add(m); this.objects.push(m); this.beams.push(m); }
      this.beamMat = bm;
    }

    // fúvókák (hideggáz) és szívás fénye
    this.jets = [];
    if (s.rocket) {
      const jg = new THREE.ConeGeometry(0.1, 1, 8, 1, true).translate(0, 0.5, 0);
      const jm = new THREE.MeshBasicMaterial({ color: 0xbfeaff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const jgU = new THREE.ConeGeometry(0.16, 1, 8, 1, true).translate(0, 0.5, 0);
      const add = (lx, ly, lz, dir, type) => {
        const m = new THREE.Mesh(type === 'boost' ? jg : jgU, jm); m.visible = false; m.frustumCulled = false;
        scene.add(m); this.objects.push(m);
        this.jets.push({ m, l: [lx, ly, lz], dir, type });
      };
      for (const z of EXH_Z) add(-2.43, -0.11, z, 'b', 'boost');
      for (const sx of [1.75, -1.75]) for (const sz of [0.55, -0.55]) add(sx, -0.33, sz, 'd', 'up');
      const tex = radialTex('rgba(110,225,255,0.9)', 'rgba(110,225,255,0)');
      this.glow = new THREE.Mesh(new THREE.PlaneGeometry(6, 3.6), new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.0, side: THREE.DoubleSide }));
      this.glow.frustumCulled = false;
      scene.add(this.glow); this.objects.push(this.glow);
    }
    this.off = new Float32Array(this.geo.attributes.position.count * 3); this.dentN = 0; this.repairs = car.repairs;
    this._m = new THREE.Matrix4(); this._v = [0, 0, 0];
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._c = new THREE.Vector3(); this._q = new THREE.Quaternion();
  }
  _skinned(geo, mat, shadow) {
    const car = this.car, s = car.spec;
    const lp = geo.attributes.position.array, nv = lp.length / 3;
    const sk = { geo, local: new Float32Array(lp), idx: new Uint8Array(nv * 8), w: new Float32Array(nv * 8) };
    const xs = car.xs, h = s.h, hw = s.wid / 2;
    for (let v = 0; v < nv; v++) {
      const x = lp[v * 3], y = lp[v * 3 + 1], z = lp[v * 3 + 2];
      const cIdx = x < xs[1] ? 0 : (x < xs[2] ? 1 : 2);
      const u = (x - xs[cIdx]) / (xs[cIdx + 1] - xs[cIdx]), vv = (y - (s.yb || 0)) / h, w = (z + hw) / (2 * hw);
      let k = 0;
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) {
        sk.idx[v * 8 + k] = Car.idx(cIdx + a, b, c);
        sk.w[v * 8 + k] = (a ? u : 1 - u) * (b ? vv : 1 - vv) * (c ? w : 1 - w);
        k++;
      }
    }
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadow; m.receiveShadow = shadow; m.frustumCulled = false;
    this.scene.add(m);
    sk.mesh = m; sk.normals = shadow;
    this.skins.push(sk);
    return m;
  }
  dispose() {
    for (const o of this.objects) { this.scene.remove(o); }
    for (const sk of this.skins) sk.geo.dispose();
    if (this.headlight) this.headlight.forEach(L => L.intensity = 0);
  }
  _applyDents(sk, dents) {
    const L = sk.local, nv = L.length / 3;
    if (!sk.off) sk.off = new Float32Array(nv * 3);
    const OF = sk.off;
    for (const d of dents) {
      const va = d.vis || d.amt, R = 0.6 + va * 3.5;
      for (let v = 0; v < nv; v++) {
        const ex = L[v * 3] - d.lx, ey = L[v * 3 + 1] - d.ly, ez = L[v * 3 + 2] - d.lz;
        const dd = Math.sqrt(ex * ex + ey * ey + ez * ez);
        if (dd >= R) continue;
        const w = (1 - dd / R); const k = w * w * va;
        let ox = OF[v * 3] + d.nx * k, oy = OF[v * 3 + 1] + d.ny * k, oz = OF[v * 3 + 2] + d.nz * k;
        const ol = Math.hypot(ox, oy, oz);
        if (ol > DENT_MAX_OFF) { ox *= DENT_MAX_OFF / ol; oy *= DENT_MAX_OFF / ol; oz *= DENT_MAX_OFF / ol; }
        OF[v * 3] = ox; OF[v * 3 + 1] = oy; OF[v * 3 + 2] = oz;
      }
    }
    if (sk.normals) this._scuff(sk);
  }
  // lekopott festék: a horpadás mélységével arányosan sötétedik, fémszürke felé
  _scuff(sk) {
    const col = sk.geo.attributes.color; if (!col) return;
    if (!sk.col0) sk.col0 = new Float32Array(col.array);
    const C = col.array, C0 = sk.col0, OF = sk.off, n = C.length / 3;
    const sr = 0.045, sg = 0.046, sb = 0.05;
    for (let v = 0; v < n; v++) {
      const m = Math.min(1, Math.hypot(OF[v * 3], OF[v * 3 + 1], OF[v * 3 + 2]) / 0.2) * 0.78;
      // apró kopásminta, hogy ne egyszínű folt legyen
      const g = m * (0.85 + 0.15 * Math.sin(v * 12.9898));
      C[v * 3] = C0[v * 3] + (sr - C0[v * 3]) * g; C[v * 3 + 1] = C0[v * 3 + 1] + (sg - C0[v * 3 + 1]) * g; C[v * 3 + 2] = C0[v * 3 + 2] + (sb - C0[v * 3 + 2]) * g;
    }
    col.needsUpdate = true;
  }
  // nagy ütközés: szikra, törmelék; erős frontális ütés: kialszik az adott oldali lámpa
  _dentFx(d) {
    const car = this.car, v = [0, 0, 0];
    car.toWorld(d.lx, d.ly, d.lz, v);
    if (d.iv > 14 && typeof Game !== 'undefined' && Game.particles) {
      const P = Game.particles;
      for (let k = 0; k < 22; k++) P.emit(v[0], v[1], v[2], (Math.random() - 0.5) * 9, 2 + Math.random() * 5, (Math.random() - 0.5) * 9, k % 2 ? 0xffd27a : 0xfff3d0, 0.1 + Math.random() * 0.08, 0.35 + Math.random() * 0.4, 1, 0, 14);
      if (Game.debris) Game.debris.burst(v, car.v, 3 + Math.floor(Math.random() * 4), this.bodyHex);
    }
    if (d.iv > 12 && d.lx > 1.5) {
      const sides = Math.abs(d.lz) < 0.3 ? [0, 1] : [d.lz > 0 ? 1 : 0];
      for (const k of sides) this.lampOut(k, true);
    }
  }
  // teljes elrejtés (online néző)
  setVisible(v) {
    if (this.hidden === !v) return;
    this.hidden = !v;
    for (const o of this.objects) o.visible = v;
    if (!v && this.headlight) this.headlight.forEach(S => S.intensity = 0);
    this._lk = '';
  }
  // sérülés miatti kialvás (a kapcsolótól független állapot)
  lampOut(k, out) { this.lightOut[k] = out; }
  // a tényleges lámpaállapot: [bal első, jobb első, hátsó]
  lampState() {
    const car = this.car, force = this.forceLamps || this.ping;
    const userOff = !!car.lampsOff && !force;
    return [!userOff && (!this.lightOut[0] || force), !userOff && (!this.lightOut[1] || force), !userOff];
  }
  // remote autóhoz kölcsönadott fényszóró (online: a legközelebbi távoli autó)
  setSpot(L) {
    if (this.headlight === L) return;
    if (this.headlight) this.headlight.forEach(S => S.intensity = 0);
    this.headlight = L; this._lk = '';
  }
  _applyLights() {
    const st = this.lampState(), boost = this.boostLamps, ping = this.ping;
    const key = st.join() + boost + ping + !!this.headlight;
    if (key === this._lk) return;
    this._lk = key;
    for (let k = 0; k < this.halos.length; k++) this.halos[k].m.visible = k < 2 ? st[k] : st[2];
    if (this.headlight) this.headlight.forEach((S, k) => {
      S.intensity = st[k] ? (ping ? 1600 : boost ? 1300 : 850) : 0;
      S.distance = boost ? 180 : 120; S.angle = boost ? 0.66 : 0.46;
    });
    const sk = this.skins[1], col = sk.geo.attributes.color, L = sk.local;
    if (!sk.col0) sk.col0 = new Float32Array(col.array);
    for (let v = 0; v < L.length / 3; v++) {
      const x = L[v * 3];
      const on = x >= 1.9 ? st[L[v * 3 + 2] > 0 ? 1 : 0] : (x < -2.3 ? st[2] : true);
      for (let c = 0; c < 3; c++) col.array[v * 3 + c] = on ? sk.col0[v * 3 + c] : 0.012;
    }
    col.needsUpdate = true;
  }
  // egységes (matt sötét) fényezés bújócskában; null = az eredeti szín
  setPaint(hex) {
    if (this._paint === hex) return;
    this._paint = hex;
    const sk = this.skins[0], col = sk.geo.attributes.color;
    if (!sk.col0) sk.col0 = new Float32Array(col.array);
    if (!sk.colOrig) sk.colOrig = new Float32Array(sk.col0);
    const O = sk.colOrig, B = sk.col0, n = O.length / 3;
    const bc = hcol(this.bodyHex), br = bc.r, bgc = bc.g, bb = bc.b;
    const mc = hex != null ? hcol(hex) : null, mr = mc ? mc.r : 0, mg = mc ? mc.g : 0, mb = mc ? mc.b : 0;
    for (let v = 0; v < n; v++) {
      const isBody = Math.abs(O[v * 3] - br) < 0.004 && Math.abs(O[v * 3 + 1] - bgc) < 0.004 && Math.abs(O[v * 3 + 2] - bb) < 0.004;
      if (mc && isBody) { B[v * 3] = mr; B[v * 3 + 1] = mg; B[v * 3 + 2] = mb; }
      else { B[v * 3] = O[v * 3]; B[v * 3 + 1] = O[v * 3 + 1]; B[v * 3 + 2] = O[v * 3 + 2]; }
    }
    if (!sk.off) sk.off = new Float32Array(sk.local.length);
    this._scuff(sk);
  }
  update(dt) {
    const car = this.car, s = car.spec;
    const X = car.x, Y = car.y, Z = car.z;
    if (this.hidden) { car.dents.length = 0; return; }
    if (this.repairs !== car.repairs) {
      for (const sk of this.skins) if (sk.off) { sk.off.fill(0); if (sk.normals) this._scuff(sk); }
      this.lampOut(0, false); this.lampOut(1, false);
      this.repairs = car.repairs;
    }
    if (car.dents.length) {
      for (const d of car.dents) this._dentFx(d);
      for (const sk of this.skins) this._applyDents(sk, car.dents);
      car.dents.length = 0;
    }
    // sérült motortér füstöl (online: a távoli autó elküldött sérülése alapján)
    const dmg = car.netDamage !== undefined ? car.netDamage : car.damage();
    if (dmg > 0.6 && dt > 0 && typeof Game !== 'undefined' && Game.particles && !car.wrecked) {
      const dense = dmg > 0.85, v = this._v;
      if (Math.random() < (dense ? 0.9 : 0.3)) {
        car.toWorld(-1.3 + Math.random() * 0.6, 0.55, (Math.random() - 0.5) * 0.8, v);
        Game.particles.emit(v[0], v[1], v[2], (Math.random() - 0.5) * 0.6 + car.v[0] * 0.3, 1.2 + Math.random(), (Math.random() - 0.5) * 0.6 + car.v[2] * 0.3,
          dense ? 0x2a2b30 : 0x6a6c72, dense ? 0.9 + Math.random() * 0.6 : 0.5 + Math.random() * 0.3, dense ? 2.2 : 1.6, dense ? 0.5 : 0.25, 1.4, -0.4);
      }
    }
    const cf = car.f, cu = car.u, cr = car.r;
    for (const sk of this.skins) {
      const pa = sk.geo.attributes.position.array, I = sk.idx, Wt = sk.w, OF = sk.off;
      const nv = pa.length / 3;
      for (let v = 0; v < nv; v++) {
        let x = 0, y = 0, z = 0;
        const o = v * 8;
        for (let k = 0; k < 8; k++) { const i = I[o + k], w = Wt[o + k]; x += X[i] * w; y += Y[i] * w; z += Z[i] * w; }
        if (OF) {
          const a = OF[v * 3], b = OF[v * 3 + 1], c = OF[v * 3 + 2];
          if (a || b || c) { x += cf[0] * a + cu[0] * b + cr[0] * c; y += cf[1] * a + cu[1] * b + cr[1] * c; z += cf[2] * a + cu[2] * b + cr[2] * c; }
        }
        pa[v * 3] = x; pa[v * 3 + 1] = y; pa[v * 3 + 2] = z;
      }
      sk.geo.attributes.position.needsUpdate = true;
      if (sk.normals) sk.geo.computeVertexNormals();
    }

    const f = car.f, u = car.u, r = car.r;
    for (const W of this.wheels) {
      const w = W.w, i = w.node;
      let d = Math.min(w.t, s.susLen + s.wheelR) - s.wheelR - (-(s.yb || 0));
      d = Math.max(d, this.dMin);
      const cs = Math.cos(w.steer || 0), sn = Math.sin(w.steer || 0);
      const fx = f[0] * cs + r[0] * sn, fy = f[1] * cs + r[1] * sn, fz = f[2] * cs + r[2] * sn;
      const rx = fy * u[2] - fz * u[1], ry = fz * u[0] - fx * u[2], rz = fx * u[1] - fy * u[0];
      const off = -w.side * 0.06;
      const px = X[i] - u[0] * d + r[0] * off, py = Y[i] - u[1] * d + r[1] * off, pz = Z[i] - u[2] * d + r[2] * off;
      const m = W.grp.matrix;
      m.set(fx, u[0], rx, px, fy, u[1], ry, py, fz, u[2], rz, pz, 0, 0, 0, 1);
      W.grp.matrixWorldNeedsUpdate = true;
      W.angle -= (w.spinRate || 0) * dt;
      W.spin.rotation.z = W.angle;
    }
    const v = this._v;
    for (const h of this.halos) { car.toWorld(h.l[0], h.l[1], h.l[2], v); h.m.position.set(v[0], v[1], v[2]); }
    this._applyLights();
    // fénynyaláb-kúpok
    {
      const st = this.lampState(), boost = this.boostLamps;
      const len = boost ? 26 : 17, ang = boost ? 0.6 : 0.42, rad = Math.tan(ang) * len;
      this.beamMat.opacity = boost ? 0.06 : (this.ping ? 0.08 : 0.018);
      this.beams.forEach((m, k) => {
        m.visible = st[k];
        if (!m.visible) return;
        const sz = k ? 1 : -1;
        car.toWorld(2.1, 0.06, sz * 0.66, v);
        m.position.set(v[0], v[1], v[2]);
        this._q.setFromUnitVectors(this._b.set(0, -1, 0), this._a.set(f[0] - u[0] * 0.09 + r[0] * sz * 0.06, f[1] - u[1] * 0.09 + r[1] * sz * 0.06, f[2] - u[2] * 0.09 + r[2] * sz * 0.06).normalize());
        m.quaternion.copy(this._q);
        m.scale.set(rad, len, rad);
      });
    }
    // két fényszóró, a lámpák helyéről, enyhén kifelé fordítva
    if (this.headlight) this.headlight.forEach((L, k) => {
      const sz = k ? 1 : -1;
      car.toWorld(2.05, 0.06, sz * 0.66, v);
      const dx = f[0] - u[0] * 0.09 + r[0] * sz * 0.06, dy = f[1] - u[1] * 0.09 + r[1] * sz * 0.06, dz = f[2] - u[2] * 0.09 + r[2] * sz * 0.06;
      L.position.set(v[0], v[1], v[2]);
      L.target.position.set(v[0] + dx * 20, v[1] + dy * 20, v[2] + dz * 20);
      L.target.updateMatrixWorld();
    });
    if (s.rocket) {
      for (const j of this.jets) {
        let lvl = j.type === 'boost' ? car.fxBoost : Math.max(car.fxUp, car.fxAtt * 0.35);
        if (lvl < 0.02) { j.m.visible = false; continue; }
        j.m.visible = true;
        car.toWorld(j.l[0], j.l[1], j.l[2], v);
        j.m.position.set(v[0], v[1], v[2]);
        const dir = j.dir === 'b' ? this._a.set(-f[0], -f[1], -f[2]) : this._a.set(-u[0], -u[1], -u[2]);
        this._q.setFromUnitVectors(this._b.set(0, 1, 0), dir);
        j.m.quaternion.copy(this._q);
        const len = (j.type === 'boost' ? 2.2 : 1.5) * Math.min(1.5, lvl) * (0.85 + Math.random() * 0.3);
        j.m.scale.set(1 + lvl * 0.4, len, 1 + lvl * 0.4);
      }
      const on = car.suctionOn && car.contacts > 0;
      const g = this.glow;
      g.material.opacity += ((on && !this.hideGlow ? 0.6 : 0) - g.material.opacity) * Math.min(1, dt * 8);
      g.visible = g.material.opacity > 0.02;
      if (g.visible) {
        car.toWorld(0, -0.34, 0, v);
        g.position.set(v[0] - u[0] * 0.1, v[1] - u[1] * 0.1, v[2] - u[2] * 0.1);
        this._m.makeBasis(this._a.set(f[0], f[1], f[2]), this._b.set(r[0], r[1], r[2]), this._c.set(-u[0], -u[1], -u[2]));
        g.quaternion.setFromRotationMatrix(this._m);
      }
    }
  }
}

// ------------------------------------------------------------
// részecskék (por, gáz, fröccs)
class Particles {
  constructor(scene, max = 2000) {
    this.max = max; this.n = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max); this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.a0 = new Float32Array(max); this.grow = new Float32Array(max); this.grav = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 500 } },
      vertexShader: `attribute float aSize; attribute float aAlpha; attribute vec3 aColor; uniform float uScale;
        varying float vA; varying vec3 vC;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale / max(0.5, -mv.z); vA = aAlpha; vC = aColor; }`,
      fragmentShader: `varying float vA; varying vec3 vC;
        void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard;
          gl_FragColor = vec4(vC, vA * smoothstep(0.5, 0.15, r));
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.geo = g;
  }
  emit(x, y, z, vx, vy, vz, hex, size, life, alpha, grow = 1.5, grav = 0) {
    if (this.n >= this.max) return;
    const i = this.n++, c = hcol(hex);
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
    this.size[i] = size; this.life[i] = this.maxLife[i] = life; this.a0[i] = alpha; this.alpha[i] = alpha;
    this.grow[i] = grow; this.grav[i] = grav;
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const j = --this.n;
        if (i !== j) {
          for (let k = 0; k < 3; k++) { this.pos[i * 3 + k] = this.pos[j * 3 + k]; this.vel[i * 3 + k] = this.vel[j * 3 + k]; this.col[i * 3 + k] = this.col[j * 3 + k]; }
          this.size[i] = this.size[j]; this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j]; this.a0[i] = this.a0[j]; this.grow[i] = this.grow[j]; this.grav[i] = this.grav[j];
        }
        continue;
      }
      const dmp = Math.exp(-dt * 2.2);
      this.vel[i * 3] *= dmp; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dmp - this.grav[i] * dt; this.vel[i * 3 + 2] *= dmp;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = this.a0[i] * Math.min(1, t * 1.6);
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    for (const a of ['position', 'aColor', 'aSize', 'aAlpha']) this.geo.attributes[a].needsUpdate = true;
  }
  clear() { this.n = 0; }
}

// ------------------------------------------------------------
// ég (éjszaka): színátmenet, csillagok, hold, felhők
function buildSky(scene, moonDir) {
  const g = new THREE.SphereGeometry(1800, 48, 24);
  const p = g.attributes.position, cols = [];
  const top = new THREE.Color(PAL.skyTop), hor = new THREE.Color(PAL.skyHor), glow = new THREE.Color(PAL.skyGlow), c = new THREE.Color();
  const md = moonDir.clone().setY(0).normalize();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / 1800, y = p.getY(i) / 1800, z = p.getZ(i) / 1800;
    const t = Math.pow(Math.max(0, y), 0.5);
    c.copy(hor).lerp(top, t);
    const hl = Math.hypot(x, z) || 1;
    const toward = Math.max(0, (x * md.x + z * md.z) / hl);
    c.lerp(glow, Math.pow(toward, 3) * Math.pow(1 - Math.max(0, y), 4) * 0.8);
    if (y < 0) c.copy(hor).multiplyScalar(0.7);
    cols.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const sky = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10;
  scene.add(sky);
  // csillagok
  const rnd = mulberry32(42);
  const sp = [], sc = [];
  for (let i = 0; i < 1800; i++) {
    const u = rnd(), v = rnd() * 0.95 + 0.05;
    const th = u * Math.PI * 2, y = Math.pow(v, 0.7);
    const rr = Math.sqrt(1 - y * y) * 1700;
    sp.push(Math.cos(th) * rr, y * 1700, Math.sin(th) * rr);
    const b = 0.35 + rnd() * rnd() * 1.2, warm = rnd();
    sc.push(b * (0.85 + warm * 0.15), b * 0.92, b * (1.0 - warm * 0.12));
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  sg.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false, transparent: true, toneMapped: false }));
  stars.renderOrder = -9;
  sky.add(stars);
  // hold
  const sun = new THREE.Mesh(new THREE.CircleGeometry(42, 32), new THREE.MeshBasicMaterial({ color: 0xe6ecff, fog: false, toneMapped: false }));
  sky.add(sun);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex('rgba(170,190,255,0.55)', 'rgba(120,140,255,0)'), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
  halo.scale.set(420, 420, 1);
  sun.add(halo);
  // felhők
  const clouds = new THREE.Group();
  const cg = new THREE.IcosahedronGeometry(1, 0);
  const cm = new THREE.MeshLambertMaterial({ color: 0x5b6894, flatShading: true, fog: false, emissive: 0x141a30 });
  for (let i = 0; i < 26; i++) {
    const cl = new THREE.Group();
    const a = rnd() * Math.PI * 2, r = 300 + rnd() * 700, y = 170 + rnd() * 140;
    for (let k = 0; k < 4 + Math.floor(rnd() * 4); k++) {
      const m = new THREE.Mesh(cg, cm);
      const s = 18 + rnd() * 26;
      m.scale.set(s * 1.6, s * 0.6, s);
      m.position.set((rnd() - 0.5) * 70, (rnd() - 0.5) * 10, (rnd() - 0.5) * 40);
      cl.add(m);
    }
    cl.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    cl.userData.sp = 0.7 + rnd() * 0.6;
    clouds.add(cl);
  }
  scene.add(clouds);
  return { sky, sun, clouds, stars };
}
// lassú szél: a felhők sodródnak, a pálya túlsó szélén visszatérnek
const WIND = { x: Math.cos(0.6), z: Math.sin(0.6), v: 4.5 };
function updateClouds(clouds, dt) {
  for (const cl of clouds.children) {
    const k = WIND.v * cl.userData.sp * dt;
    cl.position.x += WIND.x * k; cl.position.z += WIND.z * k;
    const d = Math.hypot(cl.position.x, cl.position.z);
    if (d > 1050) { cl.position.x *= -0.92; cl.position.z *= -0.92; }
  }
}

// ------------------------------------------------------------
// kamerák
const CAM_MODES = ['Üldöző', 'Távoli', 'Pilótafülke', 'Tévékamera', 'Felülnézet'];
class CamCtl {
  constructor(cam, world) {
    this.cam = cam; this.world = world; this.mode = 0;
    this.pos = new THREE.Vector3(); this.look = new THREE.Vector3(); this.yaw = 0; this.tv = -1; this.snap = true;
    this.orb = { drag: false, blend: 0, hold: 0, yaw: 0, pitch: 0.3, dist: 7 };
    this._o1 = new THREE.Vector3(); this._o2 = new THREE.Vector3(); this._o3 = new THREE.Vector3();
    this._v = [0, 0, 0];
  }
  next() { this.mode = (this.mode + 1) % CAM_MODES.length; this.snap = true; this.tv = -1; return CAM_MODES[this.mode]; }
  update(car, dt) {
    const cam = this.cam, W = this.world, c = car.c, f = car.f, u = car.u;
    const v = this._v;
    cam.up.set(0, 1, 0);
    let fov = 62;
    const fl = Math.hypot(f[0], f[2]);
    if (fl > 0.3) {
      const y = Math.atan2(f[2], f[0]);
      if (this.snap) this.yaw = y;
      else { let d = y - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); this.yaw += d * (1 - Math.exp(-dt * 4)); }
    }
    const mode = this.mode;
    if (mode === 0 || mode === 1) {
      const back = mode === 0 ? 7.4 : 14, hgt = mode === 0 ? 2.5 : 5.5;
      // falon / fejjel lefelé: autóhoz kötött nézet
      const wantRel = (car.contacts > 0 && u[1] < 0.72) || (this.rel > 0.5 && car.contacts === 0 && u[1] < 0.3 && car.airTime < 0.4) ? 1 : 0;
      this.rel = (this.rel || 0) + (wantRel - (this.rel || 0)) * Math.min(1, dt * (wantRel ? 3 : 1.6));
      if (car.contacts > 0) car.airTime = 0; else car.airTime = (car.airTime || 0) + dt;
      const k1 = this.rel;
      let tx = c[0] - Math.cos(this.yaw) * back, tz = c[2] - Math.sin(this.yaw) * back;
      let ty = c[1] + hgt;
      if (k1 > 0.001) {
        const rb = back * 0.8, rh = hgt * 0.9;
        tx += (c[0] - f[0] * rb + u[0] * rh - tx) * k1;
        ty += (c[1] - f[1] * rb + u[1] * rh - ty) * k1;
        tz += (c[2] - f[2] * rb + u[2] * rh - tz) * k1;
        cam.up.set(u[0] * k1, 1 - k1 + u[1] * k1, u[2] * k1).normalize();
      }
      if (k1 < 0.5) ty = Math.max(ty, W.heightAt(tx, tz) + 1.0, W.water + 0.8);
      const k = this.snap ? 1 : 1 - Math.exp(-dt * (7 + 16 * k1));
      this.pos.x += (tx - this.pos.x) * k; this.pos.y += (ty - this.pos.y) * k; this.pos.z += (tz - this.pos.z) * k;
      if (k1 < 0.5) this.pos.y = Math.max(this.pos.y, W.heightAt(this.pos.x, this.pos.z) + 0.6);
      const lk = this.snap ? 1 : 1 - Math.exp(-dt * 12);
      this.look.x += (c[0] + car.v[0] * 0.06 - this.look.x) * lk;
      this.look.y += (c[1] + 0.7 * (1 - k1) - this.look.y) * lk;
      this.look.z += (c[2] + car.v[2] * 0.06 - this.look.z) * lk;
      fov = 62 + Math.min(14, car.speed * 0.15);
    } else if (mode === 2) {
      const s = car.spec;
      car.toWorld(-0.1, 0.5, 0, v);
      this.pos.set(v[0], v[1], v[2]);
      this.look.set(v[0] + f[0] * 10, v[1] + f[1] * 10, v[2] + f[2] * 10);
      cam.up.set(u[0], u[1], u[2]);
      fov = 72;
    } else if (mode === 3) {
      let best = -1, bd = Infinity;
      W.tvSpots.forEach((sp, i) => { const d = Math.hypot(sp.x - c[0], sp.y - c[1], sp.z - c[2]); if (d < bd) { bd = d; best = i; } });
      if (this.tv < 0) this.tv = best;
      else {
        const cur = W.tvSpots[this.tv], cd = Math.hypot(cur.x - c[0], cur.y - c[1], cur.z - c[2]);
        if (best !== this.tv && bd < cd * 0.7) this.tv = best;
      }
      const sp = W.tvSpots[this.tv];
      this.pos.set(sp.x, sp.y, sp.z);
      this.look.set(c[0], c[1] + 0.5, c[2]);
      const d = this.pos.distanceTo(this.look);
      fov = Math.max(6, Math.min(60, 2 * Math.atan(9 / d) * 180 / Math.PI));
    } else {
      this.pos.set(c[0] + 0.01, c[1] + 42, c[2] + 18);
      this.look.set(c[0], c[1], c[2]);
      fov = 50;
    }
    this.snap = false;
    // egeres körbenézés: elengedés után 2 mp-ig marad, aztán visszaáll
    const O = this.orb;
    if (O.drag) O.blend = Math.min(1, O.blend + dt * 6);
    else if (O.blend > 0) { O.hold -= dt; if (O.hold <= 0) O.blend = Math.max(0, O.blend - dt * 1.4); }
    if (O.blend > 0) {
      const e = O.blend * O.blend * (3 - 2 * O.blend);
      const tx = c[0], ty = c[1] + 0.4, tz = c[2];
      // negatív "pitch": a kamera lent marad, és felfelé, az égre néz
      const pc = Math.max(0.04, O.pitch), cp = Math.cos(pc);
      let ox = tx + Math.cos(O.yaw) * cp * O.dist, oy = ty + Math.sin(pc) * O.dist, oz = tz + Math.sin(O.yaw) * cp * O.dist;
      oy = Math.max(oy, W.heightAt(ox, oz) + 0.5);
      let lx = tx, ly = ty, lz = tz;
      if (O.pitch < 0.04) {
        const a = Math.min(1.5, 0.04 - O.pitch), hx = tx - ox, hz = tz - oz, hl = Math.hypot(hx, hz) || 1;
        lx = ox + hx / hl * Math.cos(a) * 20; ly = oy + Math.sin(a) * 20; lz = oz + hz / hl * Math.cos(a) * 20;
      }
      this._o1.copy(this.pos).lerp(this._o2.set(ox, oy, oz), e);
      this._o3.copy(this.look).lerp(this._o2.set(lx, ly, lz), e);
      cam.position.copy(this._o1); this._shake(dt);
      if (e > 0.5) cam.up.set(0, 1, 0);
      fov += (62 - fov) * e;
      if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 6); cam.updateProjectionMatrix(); }
      cam.lookAt(this._o3);
      return;
    }
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * (mode === 3 ? 1 : Math.min(1, dt * 4)); cam.updateProjectionMatrix(); }
    cam.position.copy(this.pos); this._shake(dt);
    cam.lookAt(this.look);
  }
  _shake(dt) {
    if (!(this.shake > 0.01)) return;
    const k = this.shake * 0.35;
    this.cam.position.x += (Math.random() - 0.5) * k; this.cam.position.y += (Math.random() - 0.5) * k; this.cam.position.z += (Math.random() - 0.5) * k;
    this.shake *= Math.exp(-dt * 2.5);
  }
  orbitStart(car) {
    const O = this.orb, cam = this.cam;
    if (O.blend <= 0.01) {
      const dx = cam.position.x - car.c[0], dy = cam.position.y - (car.c[1] + 0.4), dz = cam.position.z - car.c[2];
      const d = Math.hypot(dx, dy, dz) || 7;
      O.dist = Math.max(4.5, Math.min(18, d));
      O.yaw = Math.atan2(dz, dx);
      O.pitch = Math.max(-0.05, Math.min(1.3, Math.asin(Math.max(-1, Math.min(1, dy / d)))));
    }
    O.drag = true;
  }
  orbitMove(dx, dy) {
    const O = this.orb;
    O.yaw += dx * 0.008;
    O.pitch = Math.max(-1.5, Math.min(1.35, O.pitch + dy * 0.006));
  }
  orbitZoom(d) { const O = this.orb; O.dist = Math.max(3.5, Math.min(25, O.dist * (d > 0 ? 1.1 : 0.9))); if (!O.drag && O.blend > 0) O.hold = 2; }
  orbitEnd() { const O = this.orb; if (O.drag) { O.drag = false; O.hold = 2; } }
}

// ------------------------------------------------------------
// égi események: Starlink-vonat és Falcon 9 indítás (az éggömbhöz kötve)
class SkyEvents {
  constructor(sky) {
    this.sky = sky; this.R = 1550;
    this.tStar = 20 + Math.random() * 30; this.tRocket = Infinity;
    this.star = null; this.rocket = null;
    const mkPts = (n, color) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aA', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aS', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
      const m = new THREE.ShaderMaterial({
        uniforms: { uC: { value: new THREE.Color(color) }, uPR: { value: 1 } },
        vertexShader: `attribute float aA; attribute float aS; uniform float uPR; varying float vA;
          void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_PointSize = aS * uPR; vA = aA; }`,
        fragmentShader: `uniform vec3 uC; varying float vA; void main(){ float r = length(gl_PointCoord-0.5); if (r>0.5) discard;
          gl_FragColor = vec4(uC, vA * smoothstep(0.5, 0.05, r)); }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      });
      const p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = -8; p.visible = false;
      sky.add(p);
      return p;
    };
    this.trainPts = mkPts(32, 0xf2f6ff);
    this.trailPts = mkPts(260, 0xffe6c4);
    this.trailIdx = 0; this.trailAge = new Float32Array(260).fill(99);
    const spr = (tex, color, s) => {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: 0 }));
      m.scale.set(s, s, 1); m.renderOrder = -7; m.visible = false; sky.add(m); return m;
    };
    this.flame = spr(radialTex('rgba(255,236,200,1)', 'rgba(255,140,60,0)'), 0xffffff, 26);
    this.bflame = spr(radialTex('rgba(255,236,200,1)', 'rgba(255,140,60,0)'), 0xffffff, 14);
    this.booster = null;
    this.jelly = spr(radialTex('rgba(170,215,255,0.8)', 'rgba(120,170,255,0)'), 0xffffff, 60);
  }
  dir(az, el, out) {
    const c = Math.cos(el);
    out[0] = Math.cos(az) * c * this.R; out[1] = Math.sin(el) * this.R; out[2] = Math.sin(az) * c * this.R;
    return out;
  }
  setPR(pr) { this.trainPts.material.uniforms.uPR.value = pr; this.trailPts.material.uniforms.uPR.value = pr; }
  startStarlink() {
    // valódi főkör: a pályasík egy horizontpontból indul, a csúcsán "peak" magasságban jár, a szemközti horizonton nyugszik
    const az = Math.random() * Math.PI * 2, peak = 0.45 + Math.random() * 0.9;
    const e1 = [Math.cos(az), 0, Math.sin(az)], h2 = [-Math.sin(az), 0, Math.cos(az)];
    const e2 = [h2[0] * Math.cos(peak), Math.sin(peak), h2[2] * Math.cos(peak)];
    this.star = { t: 0, dur: 34 + Math.random() * 10, e1, e2, n: 18 + Math.floor(Math.random() * 12) };
    this.trainPts.visible = true;
  }
  startRocket() {
    this.rocket = { t: 0, dur: 55, az: Math.random() * Math.PI * 2, drift: (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.2), emit: 0 };
    this.trailAge.fill(99);
    this.trailPts.visible = true; this.flame.visible = true;
  }
  // gyorsítórakéta: visszafordító égetés, visszatérő égetés, leszálló égetés a horizontnál, majd hangrobbanás
  startBooster(az, el, az0) {
    this.booster = { t: 0, dur: 46, az1: az, el1: el, az0: az0 + (Math.random() - 0.5) * 0.08, emit: 0, boom: false };
    this.bflame.visible = true;
  }
  updateBooster(dt, TP) {
    const B = this.booster; if (!B) return;
    B.t += dt;
    const u = Math.min(1, B.t / B.dur);
    const sm = u * u * (3 - 2 * u);
    const az = B.az1 + (B.az0 - B.az1) * sm;
    const el = 0.012 + (B.el1 - 0.012) * Math.pow(1 - u, 1.5) + Math.sin(Math.PI * Math.min(1, u * 2.2)) * 0.05 * (1 - u);
    const v = this.dir(az, el, [0, 0, 0]);
    this.bflame.position.set(v[0], v[1], v[2]);
    // égetések: visszafordító 0–5 s, visszatérő 20–26 s, leszálló 39–45 s
    const t = B.t;
    let burn = 0, col = 0xffffff, sz = 14;
    if (t < 5) { burn = 0.8; sz = 12; }
    else if (t > 20 && t < 26) { burn = 1; sz = 22; col = 0xffd8a8; }
    else if (t > 39 && t < 45) { burn = 0.9; sz = 16; }
    const flick = 0.85 + Math.random() * 0.15;
    this.bflame.material.opacity = Math.max(burn * flick, t < 45 ? 0.08 : 0);
    this.bflame.material.color.setHex(col);
    this.bflame.scale.set(sz * (burn ? flick : 0.4), sz * (burn ? flick : 0.4), 1);
    B.emit -= dt;
    if (burn && B.emit <= 0) {
      B.emit = 0.2;
      const i = this.trailIdx; this.trailIdx = (i + 1) % 260;
      TP.array[i * 3] = v[0]; TP.array[i * 3 + 1] = v[1]; TP.array[i * 3 + 2] = v[2];
      this.trailAge[i] = 8;
      this.trailPts.visible = true;
    }
    if (t > 47.5 && !B.boom) { B.boom = true; if (typeof Sound !== 'undefined') Sound.boom(); }
    if (t > 50) { this.booster = null; this.bflame.visible = false; }
  }
  update(dt) {
    this.tStar -= dt; this.tRocket -= dt;
    if (this.tStar <= 0 && !this.star) { this.startStarlink(); this.tStar = 80 + Math.random() * 90; }
    if (this.tRocket <= 0 && !this.rocket) { this.startRocket(); this.tRocket = 200 + Math.random() * 160; }
    const v = [0, 0, 0];
    // Starlink: fényes pontok egymás után, egyenes íven
    if (this.star) {
      const S = this.star; S.t += dt;
      const pos = this.trainPts.geometry.attributes.position, A = this.trainPts.geometry.attributes.aA, Sz = this.trainPts.geometry.attributes.aS;
      for (let i = 0; i < 32; i++) {
        const u = S.t / S.dur - i * 0.008;
        if (i >= S.n || u < 0 || u > 1) { A.array[i] = 0; continue; }
        const th = 0.06 + u * (Math.PI - 0.12), c = Math.cos(th), sn = Math.sin(th);
        pos.array[i * 3] = (S.e1[0] * c + S.e2[0] * sn) * this.R; pos.array[i * 3 + 1] = (S.e1[1] * c + S.e2[1] * sn) * this.R; pos.array[i * 3 + 2] = (S.e1[2] * c + S.e2[2] * sn) * this.R;
        const fade = Math.min(1, u * 8, (1 - u) * 8);
        A.array[i] = fade * (0.8 + 0.2 * Math.sin(S.t * 7 + i * 1.7)); Sz.array[i] = 4.4;
      }
      pos.needsUpdate = true; A.needsUpdate = true; Sz.needsUpdate = true;
      if (S.t / S.dur - S.n * 0.011 > 1) { this.star = null; this.trainPts.visible = false; }
    }
    // Falcon 9: lángpont, füstcsík, magasban "medúza" felhő
    const TA = this.trailPts.geometry.attributes.aA, TS = this.trailPts.geometry.attributes.aS, TP = this.trailPts.geometry.attributes.position;
    let anyTrail = false;
    if (this.rocket) {
      const K = this.rocket; K.t += dt;
      const s = Math.min(1, K.t / K.dur);
      const el = 0.01 + 0.62 * (1 - Math.pow(1 - s, 1.8)), az = K.az + K.drift * s * s;
      this.dir(az, el, v);
      const meco = s > 0.55;
      // fokozatleválás: indul a gyorsítórakéta visszatérése
      if (meco && !K.sep) { K.sep = true; this.startBooster(az, el, K.az); }
      this.flame.position.set(v[0], v[1], v[2]);
      const fl = s < 0.03 ? s / 0.03 : (s > 0.93 ? (1 - s) / 0.07 : 1);
      this.flame.material.opacity = fl * (meco ? 0.65 : 1) * (0.85 + Math.random() * 0.15);
      const fs = (meco ? 13 : 26) * (0.9 + Math.random() * 0.2);
      this.flame.scale.set(fs, fs, 1);
      this.flame.material.color.setHex(meco ? 0xbfe0ff : 0xffffff);
      K.emit -= dt;
      if (K.emit <= 0 && s < 0.95) {
        K.emit = 0.18;
        const i = this.trailIdx; this.trailIdx = (i + 1) % 260;
        TP.array[i * 3] = v[0]; TP.array[i * 3 + 1] = v[1]; TP.array[i * 3 + 2] = v[2];
        this.trailAge[i] = 0;
      }
      // medúza: a magasban a napfényben szétterülő kipufogócsóva
      if (s > 0.4) {
        this.jelly.visible = true;
        const j = Math.min(1, (s - 0.4) / 0.35);
        this.jelly.position.set(v[0], v[1], v[2]);
        this.jelly.scale.set(60 + j * 260, 50 + j * 200, 1);
        this.jelly.material.opacity = j * 0.55 * (s > 0.85 ? (1 - s) / 0.15 + 0.3 : 1);
      }
      if (K.t > K.dur + 2) { this.rocket = null; this.flame.visible = false; }
    }
    for (let i = 0; i < 260; i++) {
      const a = this.trailAge[i];
      if (a > 40) { TA.array[i] = 0; continue; }
      this.trailAge[i] = a + dt; anyTrail = true;
      TA.array[i] = Math.max(0, 0.7 * (1 - a / 40)) * (a < 0.5 ? a * 2 : 1);
      TS.array[i] = 4 + a * 0.7;
    }
    if (anyTrail) { TA.needsUpdate = true; TS.needsUpdate = true; TP.needsUpdate = true; }
    else if (!this.rocket) this.trailPts.visible = false;
    this.updateBooster(dt, TP);
    if (!this.rocket && this.jelly.visible) { this.jelly.material.opacity -= dt * 0.05; if (this.jelly.material.opacity <= 0) this.jelly.visible = false; }
  }
}

// ------------------------------------------------------------
// törmelék: kis low-poly darabok, amik leesnek, pattognak és 2 mp után eltűnnek
class Debris {
  constructor(scene, world) {
    this.scene = scene; this.world = world; this.items = [];
    this.geo = new THREE.TetrahedronGeometry(0.16, 0);
    this.mats = new Map();
  }
  mat(hex) { let m = this.mats.get(hex); if (!m) { m = new THREE.MeshLambertMaterial({ color: hex, flatShading: true }); this.mats.set(hex, m); } return m; }
  burst(p, v, n, hex) {
    for (let k = 0; k < n; k++) {
      if (this.items.length > 40) { const o = this.items.shift(); this.scene.remove(o.m); }
      const m = new THREE.Mesh(this.geo, this.mat(k % 3 === 2 ? 0x1a1b1e : hex));
      const s = 0.5 + Math.random() * 0.7; m.scale.set(s, s * (0.4 + Math.random() * 0.6), s);
      m.position.set(p[0], p[1], p[2]); m.castShadow = true;
      this.scene.add(m);
      this.items.push({ m, v: [v[0] * 0.4 + (Math.random() - 0.5) * 8, 2 + Math.random() * 5, v[2] * 0.4 + (Math.random() - 0.5) * 8], w: [(Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18], life: 2, s });
    }
  }
  update(dt) {
    const W = this.world;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const o = this.items[i];
      o.life -= dt;
      if (o.life <= 0) { this.scene.remove(o.m); this.items.splice(i, 1); continue; }
      o.v[1] -= 9.81 * dt;
      const p = o.m.position;
      p.x += o.v[0] * dt; p.y += o.v[1] * dt; p.z += o.v[2] * dt;
      const g = W.heightAt(p.x, p.z) + 0.06;
      if (p.y < g) { p.y = g; o.v[1] = Math.abs(o.v[1]) * 0.3; o.v[0] *= 0.6; o.v[2] *= 0.6; o.w[0] *= 0.6; o.w[1] *= 0.6; o.w[2] *= 0.6; }
      o.m.rotation.x += o.w[0] * dt; o.m.rotation.y += o.w[1] * dt; o.m.rotation.z += o.w[2] * dt;
      if (o.life < 0.4) { const k = o.life / 0.4; o.m.scale.setScalar(o.s * k); }
    }
  }
  clear() { for (const o of this.items) this.scene.remove(o.m); this.items = []; }
}
