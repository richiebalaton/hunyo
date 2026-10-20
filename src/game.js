'use strict';
// ============================================================
//  HUNYÓ – irányítás, hang, menü, játékciklus
// ============================================================

const PHYS_H = 1 / 720;          // fizika lépésköze (s)
const PHYS_MAX_DT = 1 / 20;      // képkockánként legfeljebb ennyi szimulált idő (dt-plafon)
const BG_TICK = 0.05;            // háttérbe tett fülön ennyi időnként lép a játék (online)
// víz alatti zárlat (teljes elmerüléstől mért idő)
const DROWN_WARN = 7, DROWN_OUT = 15, DROWN_DMG = 0.05, DROWN_DMG_MAX = 0.95;

// ---------------- bemenet ----------------
const Input = {
  keys: new Set(), pressed: new Set(), pads: [], padPrev: [],
  init() {
    addEventListener('keydown', e => {
      if (e.target && e.target.tagName === 'INPUT') return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1', 'Tab', 'Slash', 'Backspace'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  },
  poll() {
    const gp = navigator.getGamepads ? navigator.getGamepads() : [];
    this.pads = [];
    for (const p of gp) if (p && p.connected) this.pads.push(p);
  },
  down(c) { return this.keys.has(c); },
  hit(c) { return this.pressed.has(c); },
  padBtn(pi, b) { const p = this.pads[pi]; return p && p.buttons[b] ? p.buttons[b].value : 0; },
  padHit(pi, b) {
    const p = this.pads[pi]; if (!p) return false;
    const key = pi + ':' + b, now = p.buttons[b] && p.buttons[b].pressed;
    const was = this.padPrev[key]; this.padPrev[key] = now;
    return now && !was;
  },
  padAxis(pi, a) { const p = this.pads[pi]; if (!p) return 0; const v = p.axes[a] || 0; return Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85; },
  endFrame() { this.pressed.clear(); }
};
const KEYMAP = {
  solo: { up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
    hb: ['Space'], boost: ['ShiftLeft', 'ShiftRight'], jump: ['KeyE'], suck: ['KeyQ'], reset: ['KeyR'], cam: ['KeyC'], lamp: ['KeyL'] },
  p1: { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], hb: ['Space'], boost: ['ShiftLeft'], jump: ['KeyE'], suck: ['KeyQ'], reset: ['KeyR'], cam: ['KeyC'], lamp: ['KeyF'] },
  p2: { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], hb: ['ControlRight'], boost: ['ShiftRight'],
    jump: ['Enter', 'NumpadEnter', 'Numpad0'], suck: ['Period', 'NumpadDecimal'], reset: ['Backspace'], cam: ['Slash', 'NumpadAdd'], lamp: ['KeyL'] },
};
const anyDown = (l) => l.some(c => Input.down(c));
const anyHit = (l) => l.some(c => Input.hit(c));

const esc = (t) => String(t).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
// ---------------- érintőképernyő ----------------
const IS_TOUCH = (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
const Touch = {
  x: 0, y: 0, gas: 0, brake: 0, boost: 0, jump: 0, hb: 0,
  hits: {},
  none: { x: 0, y: 0, gas: 0, brake: 0, boost: 0, jump: 0, hb: 0, take: () => false },
  take(k) { const v = !!this.hits[k]; this.hits[k] = false; return v; },
  init() {
    const root = document.getElementById('touch');
    if (!IS_TOUCH || !root) return;
    document.body.classList.add('touch');
    // joystick
    const base = document.getElementById('stick'), knob = base.querySelector('i');
    let sid = null, cx = 0, cy = 0;
    const R = () => base.clientWidth * 0.42;
    const moveStick = (e) => {
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const r = R(), l = Math.hypot(dx, dy);
      if (l > r) { dx *= r / l; dy *= r / l; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const ax = dx / r, ay = dy / r;
      this.x = Math.abs(ax) < 0.12 ? 0 : ax; this.y = Math.abs(ay) < 0.25 ? 0 : ay;
    };
    base.addEventListener('pointerdown', e => {
      sid = e.pointerId; base.setPointerCapture(sid);
      const b = base.getBoundingClientRect(); cx = b.left + b.width / 2; cy = b.top + b.height / 2;
      moveStick(e); e.preventDefault();
    });
    base.addEventListener('pointermove', e => { if (e.pointerId === sid) moveStick(e); });
    const endStick = e => { if (e.pointerId !== sid) return; sid = null; this.x = this.y = 0; knob.style.transform = ''; };
    base.addEventListener('pointerup', endStick); base.addEventListener('pointercancel', endStick);
    // gombok
    root.querySelectorAll('[data-k]').forEach(el => {
      const k = el.dataset.k, ids = new Set();
      const on = e => { ids.add(e.pointerId); el.setPointerCapture(e.pointerId); el.classList.add('on'); if (k in this && typeof this[k] === 'number') this[k] = 1; this.hits[k + 'Hit'] = true; e.preventDefault(); Sound.init(); };
      const off = e => { ids.delete(e.pointerId); if (!ids.size) { el.classList.remove('on'); if (k in this && typeof this[k] === 'number') this[k] = 0; } };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('lostpointercapture', off);
    });
    document.getElementById('t-pause').addEventListener('click', () => { if (Game.state === 'play') UI.setPause(!Game.paused); });
    document.getElementById('t-full').addEventListener('click', () => Screen.toggle());
    if (!Screen.canFull()) document.getElementById('t-full').style.display = 'none';
  },
  clear() { this.x = this.y = this.gas = this.brake = this.boost = this.jump = this.hb = 0; this.hits = {}; }
};
// teljes képernyő + fekvő tájolás
const Screen = {
  el: () => document.documentElement,
  canFull() { const d = document.documentElement; return !!(d.requestFullscreen || d.webkitRequestFullscreen); },
  isFull() { return !!(document.fullscreenElement || document.webkitFullscreenElement); },
  async enter() {
    try {
      if (!this.isFull()) { const d = this.el(); await (d.requestFullscreen ? d.requestFullscreen({ navigationUI: 'hide' }) : d.webkitRequestFullscreen()); }
    } catch (e) { }
    try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); } catch (e) { }
  },
  async exit() { try { await (document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen()); } catch (e) { } },
  toggle() { return this.isFull() ? this.exit() : this.enter(); },
  checkRotate() {
    const r = document.getElementById('rotate');
    if (r) r.classList.toggle('hidden', !(IS_TOUCH && innerHeight > innerWidth * 1.05));
  }
};

// ---------------- hang ----------------
const Sound = {
  ctx: null, master: null, muted: false, noiseBuf: null, voices: [],
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = 0.32; this.master.connect(c.destination);
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
  },
  noise() { const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; s.start(); return s; },
  makeVoice(rocket) {
    if (!this.ctx) return null;
    const c = this.ctx, v = { rocket };
    v.out = c.createGain(); v.out.gain.value = 1; v.out.connect(this.master);
    v.o1 = c.createOscillator(); v.o2 = c.createOscillator();
    v.o1.type = rocket ? 'sine' : 'sawtooth'; v.o2.type = rocket ? 'sine' : 'square';
    v.lp = c.createBiquadFilter(); v.lp.type = 'lowpass'; v.lp.frequency.value = rocket ? 5000 : 700;
    v.eg = c.createGain(); v.eg.gain.value = 0;
    v.g1 = c.createGain(); v.g2 = c.createGain(); v.g1.gain.value = 1; v.g2.gain.value = rocket ? 0.25 : 1;
    v.o1.connect(v.g1); v.o2.connect(v.g2); v.g1.connect(v.lp); v.g2.connect(v.lp); v.lp.connect(v.eg); v.eg.connect(v.out);
    if (rocket) {
      // halk inverter-zümmögés harmadik oszcillátorral
      v.o3 = c.createOscillator(); v.o3.type = 'triangle'; v.g3 = c.createGain(); v.g3.gain.value = 0.12;
      v.o3.connect(v.g3); v.g3.connect(v.lp); v.o3.start();
    }
    v.o1.start(); v.o2.start();
    // gáz-sziszegés
    v.jn = this.noise(); v.jf = c.createBiquadFilter(); v.jf.type = 'bandpass'; v.jf.frequency.value = 1800; v.jf.Q.value = 0.6;
    v.jg = c.createGain(); v.jg.gain.value = 0; v.jn.connect(v.jf); v.jf.connect(v.jg); v.jg.connect(v.out);
    // gumicsikorgás
    v.sn = this.noise(); v.sf = c.createBiquadFilter(); v.sf.type = 'bandpass'; v.sf.frequency.value = 1100; v.sf.Q.value = 6;
    v.sg = c.createGain(); v.sg.gain.value = 0; v.sn.connect(v.sf); v.sf.connect(v.sg); v.sg.connect(v.out);
    // szél
    v.wn = this.noise(); v.wf = c.createBiquadFilter(); v.wf.type = 'lowpass'; v.wf.frequency.value = 400;
    v.wg = c.createGain(); v.wg.gain.value = 0; v.wn.connect(v.wf); v.wf.connect(v.wg); v.wg.connect(v.out);
    v.cool = 0;
    this.voices.push(v);
    return v;
  },
  killVoices() {
    for (const v of this.voices) { try { v.out.disconnect(); v.o1.stop(); v.o2.stop(); if (v.o3) v.o3.stop(); v.jn.stop(); v.sn.stop(); v.wn.stop(); } catch (e) { } }
    this.voices = [];
  },
  updateVoice(v, car, dt, vol) {
    if (!v) return;
    const c = this.ctx, t = c.currentTime, s = car.spec, sp = Math.abs(car.fwdSpeed);
    const thr = Math.max(car.ctl.throttle, car.ctl.brake * 0.5);
    let f1, gain;
    if (!v.rocket) {
      const gears = [0, 9, 17, 26, 35, 46];
      let g = 0; while (g < gears.length - 2 && sp > gears[g + 1]) g++;
      const ratio = Math.min(1.2, (sp - gears[g]) / (gears[g + 1] - gears[g]));
      const rpm = 900 + ratio * 4300 + thr * 500 * (car.contacts ? 1 : 2.5);
      f1 = rpm / 60 * 1.5;
      gain = 0.06 + thr * 0.07;
      v.lp.frequency.setTargetAtTime(400 + thr * 900 + ratio * 400, t, 0.05);
      v.o2.frequency.setTargetAtTime(f1 * 0.5, t, 0.03);
    } else {
      // elektromos motor: lágy alaphang + emelkedő süvítés
      const load = Math.min(1, thr + Math.min(0.4, Math.abs(car.ctl.brake) * 0.4));
      f1 = 55 + sp * 4.2;
      gain = (0.012 + load * 0.016 + Math.min(0.012, sp * 0.0003)) * (sp > 0.3 || load > 0.05 ? 1 : 0.25);
      v.o2.frequency.setTargetAtTime(420 + sp * 26, t, 0.04);
      v.o3.frequency.setTargetAtTime(1150 + sp * 41, t, 0.04);
      v.g2.gain.setTargetAtTime(0.2 + load * 0.25, t, 0.08);
      v.g3.gain.setTargetAtTime((0.05 + load * 0.08) * Math.min(1, sp / 6), t, 0.08);
    }
    v.o1.frequency.setTargetAtTime(f1, t, 0.03);
    v.eg.gain.setTargetAtTime(gain * vol, t, 0.05);
    const jet = car.fxBoost * 0.14 + Math.min(1, car.fxUp) * 0.12 + car.fxAtt * 0.035;
    v.jg.gain.setTargetAtTime(jet * vol, t, 0.04);
    let slip = 0;
    for (const w of car.wheels) if (w.contact && (w.surf === SURF.PAD || w.surf === SURF.METAL || w.surf === SURF.ROCK)) slip = Math.max(slip, w.slip);
    v.sg.gain.setTargetAtTime(Math.min(0.05, slip * 0.06) * vol * (car.speed > 3 ? 1 : 0), t, 0.05);
    v.wg.gain.setTargetAtTime(Math.min(0.045, car.speed * car.speed * 0.000012) * vol, t, 0.1);
    v.cool -= dt;
    if (car.impact > 3.5 && v.cool <= 0) { this.crash(Math.min(1, car.impact / 18) * vol); v.cool = 0.18; }
  },
  crash(k) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500 + k * 1500;
    const g = c.createGain(); g.gain.setValueAtTime(0.28 * k, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35 + k * 0.3);
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(35, t + 0.3);
    const og = c.createGain(); og.gain.setValueAtTime(0.32 * k, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    s.connect(f); f.connect(g); g.connect(this.master); o.connect(og); og.connect(this.master);
    s.start(t, Math.random()); s.stop(t + 0.8); o.start(t); o.stop(t + 0.35);
  },
  // a leszálló gyorsítórakéta kettős hangrobbanása, halkan, a távolból
  // indítási dübörgés, a távolsággal halkul
  rumble(k) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.28 * k, t + 1.5); g.gain.linearRampToValueAtTime(0.18 * k, t + 9); g.gain.exponentialRampToValueAtTime(0.001, t + 22);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t + 23);
  },
  boom() {
    if (!this.ctx) return;
    const c = this.ctx;
    for (const dly of [0, 0.32]) {
      const t = c.currentTime + dly;
      const s = c.createBufferSource(); s.buffer = this.noiseBuf;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 160;
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.35, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
      s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + 1.2);
    }
  },
  zap() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(1800, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.9);
    f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1.5;
    g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
    o.connect(f); f.connect(g); g.connect(this.master); o.start(t); o.stop(t + 1.05);
  },
  blip(freq = 660, dur = 0.06) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.035, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  },
  // ---- távoli autók: térhatású (PannerNode) motorhang + gáz-sziszegés, kb. 35 m hallótáv
  makeRemoteVoice() {
    if (!this.ctx) return null;
    const c = this.ctx, v = {};
    v.pan = c.createPanner();
    v.pan.panningModel = 'HRTF'; v.pan.distanceModel = 'linear';
    v.pan.refDistance = 4; v.pan.maxDistance = 35; v.pan.rolloffFactor = 1;
    v.pan.connect(this.master);
    v.o1 = c.createOscillator(); v.o1.type = 'sine';
    v.o2 = c.createOscillator(); v.o2.type = 'triangle';
    v.g2 = c.createGain(); v.g2.gain.value = 0.25;
    v.eg = c.createGain(); v.eg.gain.value = 0;
    v.o1.connect(v.eg); v.o2.connect(v.g2); v.g2.connect(v.eg); v.eg.connect(v.pan);
    v.o1.start(); v.o2.start();
    v.jn = this.noise(); v.jf = c.createBiquadFilter(); v.jf.type = 'bandpass'; v.jf.frequency.value = 1800; v.jf.Q.value = 0.6;
    v.jg = c.createGain(); v.jg.gain.value = 0; v.jn.connect(v.jf); v.jf.connect(v.jg); v.jg.connect(v.pan);
    return v;
  },
  updateRemoteVoice(v, car, dt, vol) {
    if (!v || !this.ctx) return;
    const t = this.ctx.currentTime, sp = car.speed || 0;
    const P = v.pan;
    if (P.positionX) { P.positionX.setTargetAtTime(car.c[0], t, 0.03); P.positionY.setTargetAtTime(car.c[1], t, 0.03); P.positionZ.setTargetAtTime(car.c[2], t, 0.03); }
    else P.setPosition(car.c[0], car.c[1], car.c[2]);
    // álló autó néma
    const moving = sp > 0.6 ? Math.min(1, (sp - 0.6) / 3) : 0;
    v.o1.frequency.setTargetAtTime(55 + sp * 4.2, t, 0.05);
    v.o2.frequency.setTargetAtTime(420 + sp * 26, t, 0.05);
    v.eg.gain.setTargetAtTime((0.05 + Math.min(0.05, sp * 0.0015)) * moving * vol, t, 0.08);
    const jet = (car.fxBoost || 0) * 0.3 + Math.min(1, car.fxUp || 0) * 0.26 + (car.fxAtt ? 0.06 : 0);
    v.jg.gain.setTargetAtTime(jet * vol, t, 0.05);
  },
  killVoice(v) { try { v.pan.disconnect(); v.o1.stop(); v.o2.stop(); v.jn.stop(); } catch (e) { } },
  // a hallgató a kamera helyén
  setListener(cam) {
    if (!this.ctx || !cam) return;
    const L = this.ctx.listener, p = cam.position, t = this.ctx.currentTime;
    const f = this._lf || (this._lf = new THREE.Vector3()); cam.getWorldDirection(f);
    const u = this._lu || (this._lu = new THREE.Vector3()); u.set(0, 1, 0).applyQuaternion(cam.quaternion);
    if (L.positionX) {
      L.positionX.setTargetAtTime(p.x, t, 0.02); L.positionY.setTargetAtTime(p.y, t, 0.02); L.positionZ.setTargetAtTime(p.z, t, 0.02);
      L.forwardX.setTargetAtTime(f.x, t, 0.02); L.forwardY.setTargetAtTime(f.y, t, 0.02); L.forwardZ.setTargetAtTime(f.z, t, 0.02);
      L.upX.setTargetAtTime(u.x, t, 0.02); L.upY.setTargetAtTime(u.y, t, 0.02); L.upZ.setTargetAtTime(u.z, t, 0.02);
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
  },
  toggleMute() { this.muted = !this.muted; if (this.master) this.master.gain.value = this.muted ? 0 : 0.32; return this.muted; }
};

// ---------------- játék ----------------
const $ = (id) => document.getElementById(id);
const Game = {
  state: 'menu', paused: false,
  cfg: { players: 1, car: ['raketa', 'raketa'], map: 'classic', seed: '' },
  world: null, worldView: null, worldKey: '',
  cars: [], views: [], cams: [], ctls: [], voices: [],
  init() {
    const canvas = $('c');
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio, IS_TOUCH ? 1.5 : 2));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.3;
    const sc = this.scene = new THREE.Scene();
    sc.fog = new THREE.Fog(PAL.fog, 40, 430);
    sc.background = new THREE.Color(PAL.fog);
    // éjszaka: hold, halvány égbolt-fény
    this.sunDir = new THREE.Vector3(-0.5, 0.42, -0.75).normalize();
    this.sky = buildSky(sc, this.sunDir);
    this.hemi = new THREE.HemisphereLight(0x3a4a8c, 0x0b0c12, 0.75); sc.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(0x9db2ff, 0.75);
    // fényszórók (előre létrehozva, hogy ne forduljon újra a shader)
    this.flashes = [0, 1].map(() => { const L = new THREE.PointLight(0x9fdcff, 0, 60, 1.6); sc.add(L); return L; });
    // autónként két fényszóró (bal, jobb)
    this.headlights = [0, 1].map(() => [0, 1].map(() => {
      const L = new THREE.SpotLight(0xeaf1ff, 0, 120, 0.46, 0.55, 1.5);
      sc.add(L); sc.add(L.target);
      return L;
    }));
    sun.castShadow = true;
    sun.shadow.mapSize.set(IS_TOUCH ? 1024 : 2048, IS_TOUCH ? 1024 : 2048);
    const sh = sun.shadow.camera; sh.left = -55; sh.right = 55; sh.top = 55; sh.bottom = -55; sh.near = 1; sh.far = 400;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
    sc.add(sun); sc.add(sun.target);
    this.sky.sun.position.copy(this.sunDir).multiplyScalar(1700);
    this.sky.sun.lookAt(0, 0, 0);
    this.particles = new Particles(sc);
    this.debris = null;
    this.skyEvents = new SkyEvents(this.sky.sky);
    this.skyEvents.setPR(r.getPixelRatio());
    this.cams = [new THREE.PerspectiveCamera(62, 1, 0.1, 8000), new THREE.PerspectiveCamera(62, 1, 0.1, 8000)];
    this.menuCam = new THREE.PerspectiveCamera(50, 1, 0.1, 8000);
    Input.init();
    UI.init();
    Touch.init();
    Screen.checkRotate();
    addEventListener('resize', () => Screen.checkRotate());
    document.addEventListener('fullscreenchange', () => { this.resize(); if (this.state === 'menu') UI.buildMenu(); });
    this.cfg.seed = randomSeed();
    this.ensureWorld();
    addEventListener('resize', () => this.resize());
    // egeres körbenézés
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('pointerdown', e => {
      if (this.state !== 'play' || this.paused) return;
      const idx = this.cars.length === 2 && e.clientY > innerHeight / 2 ? 1 : 0;
      this.orbitIdx = idx;
      this.ctls[idx].orbitStart(this.cars[idx]);
      canvas.setPointerCapture(e.pointerId);
      this._px = e.clientX; this._py = e.clientY;
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointermove', e => {
      if (this.orbitIdx === undefined || this.orbitIdx < 0 || !this.ctls[this.orbitIdx]) return;
      this.ctls[this.orbitIdx].orbitMove(e.clientX - this._px, e.clientY - this._py);
      this._px = e.clientX; this._py = e.clientY;
    });
    const end = () => { if (this.orbitIdx >= 0 && this.ctls[this.orbitIdx]) this.ctls[this.orbitIdx].orbitEnd(); this.orbitIdx = -1; canvas.style.cursor = ''; };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', e => {
      if (this.state !== 'play') return;
      const idx = this.cars.length === 2 && e.clientY > innerHeight / 2 ? 1 : 0;
      if (this.ctls[idx]) this.ctls[idx].orbitZoom(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    this.orbitIdx = -1;
    this.resize();
    this.last = performance.now();
    this.menuT = 0;
    this.startBgTicker();
    requestAnimationFrame(t => this.loop(t));
  },
  worldCfgKey() { return this.cfg.map === 'classic' ? 'classic' : 'gen:' + this.cfg.seed; },
  ensureWorld() {
    const key = this.worldCfgKey();
    if (key === this.worldKey) return;
    if (this.worldView) this.worldView.dispose();
    this.world = new World({ mode: this.cfg.map, seed: this.cfg.seed });
    this.worldView = new WorldView(this.scene, this.world);
    if (this.debris) this.debris.clear();
    this.debris = new Debris(this.scene, this.world);
    this.worldKey = key;
    this.particles.clear();
  },
  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.menuCam.aspect = w / h; this.menuCam.updateProjectionMatrix();
  },
  start() {
    Sound.init();
    if (IS_TOUCH) Screen.enter();
    this.ensureWorld();
    this.world.resetDynamic(); this.worldView.resetTrees();
    this.clearCars();
    const online = Net.active;
    const n = online ? 1 : this.cfg.players;
    for (let i = 0; i < n; i++) {
      const spec = SPECS[this.cfg.car[i]];
      const car = new Car(spec, this.world);
      const st = this.spawnFor(i);
      car.reset(st.x, st.z, st.yaw);
      this.cars.push(car);
      this.headlights[i].forEach(L => L.intensity = 850);
      this.views.push(new CarView(this.scene, car, online ? Net.myId : i, this.headlights[i]));
      const cc = new CamCtl(this.cams[i], this.world);
      this.ctls.push(cc);
      this.voices.push(Sound.makeVoice(spec.rocket));
    }
    this.state = 'play'; this.paused = false;
    Input.keys.clear(); Input.pressed.clear(); Touch.clear();
    UI.showGame(n);
    Net.afterStart();
    UI.toast(0, online ? (Net.host ? 'Szoba kódja: ' + Net.code : 'Csatlakoztál: ' + Net.code) : 'HUNYO.EXE betöltve');
    if (n > 1) UI.toast(1, 'HUNYO.EXE betöltve');
  },
  clearCars() {
    if (typeof Tag !== 'undefined') Tag.clearMarkers();
    if (typeof Hide !== 'undefined') Hide.clearSprites();
    this.freeze = false;
    if (this.flashes) this.flashes.forEach(f => f.intensity = 0);
    [0, 1].forEach(i => { UI.wreck(i, false); UI.drown(i, false); });
    for (const v of this.views) v.dispose();
    Sound.killVoices();
    this.cars = []; this.views = []; this.ctls = []; this.voices = [];
  },
  toMenu() {
    if (Net.active) Net.leave();
    this.clearCars();
    this.state = 'menu'; this.paused = false;
    UI.showMenu();
  },
  // 100% sérülés: zárlat, robbanás, rövid szünet, aztán megjavítva újraindul
  wreck(i) {
    const car = this.cars[i];
    car.wrecked = true; car.wreckT = 6; car.wrecks = (car.wrecks || 0) + 1;
    car.frame();
    const c = car.c;
    for (let k = 0; k < 16; k++) {
      const dx = car.x[k] - c[0], dy = car.y[k] - c[1], dz = car.z[k] - c[2], l = Math.hypot(dx, dy, dz) || 1;
      car.vx[k] += dx / l * 3 + (Math.random() - 0.5) * 2; car.vy[k] += 7 + dy / l * 3; car.vz[k] += dz / l * 3 + (Math.random() - 0.5) * 2;
    }
    car.suctionOn = false;
    const P = this.particles;
    for (let k = 0; k < 120; k++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2, sp = 6 + Math.random() * 14;
      P.emit(c[0], c[1] + 0.3, c[2], Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 3, Math.sin(a) * Math.cos(e) * sp,
        k % 3 === 0 ? 0xffb347 : (k % 3 === 1 ? 0x9fe8ff : 0xffffff), 0.16 + Math.random() * 0.12, 0.6 + Math.random() * 0.8, 1, 0, 9);
    }
    for (let k = 0; k < 40; k++) P.emit(c[0] + (Math.random() - 0.5) * 2, c[1] + 0.5, c[2] + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 3, 0x2a2c33, 1.2 + Math.random(), 2.5 + Math.random() * 1.5, 0.6, 2.2, -0.6);
    this.flashes[i].intensity = 5000;
    this.ctls[i].shake = 1.2;
    Sound.crash(1); Sound.zap();
    UI.wreck(i, true);
  },
  updateWreck(i, dt) {
    const car = this.cars[i];
    const fl = this.flashes[i];
    if (fl.intensity > 1) { fl.intensity *= Math.exp(-dt * 5); car.frame(); fl.position.set(car.c[0], car.c[1] + 1.2, car.c[2]); }
    if (!car.wrecked) {
      if (car.damage() >= 0.999 && this.state === 'play') this.wreck(i);
      return;
    }
    car.wreckT -= dt;
    // füst és szikrák, amíg ég
    const P = this.particles, c = car.c;
    if (Math.random() < 0.8) P.emit(c[0] + (Math.random() - 0.5), c[1] + 0.6, c[2] + (Math.random() - 0.5), (Math.random() - 0.5) * 0.8, 1.8 + Math.random(), (Math.random() - 0.5) * 0.8, 0x23252c, 1 + Math.random() * 0.8, 2.5, 0.55, 1.6, -0.5);
    if (Math.random() < 0.25) { P.emit(c[0], c[1] + 0.3, c[2], (Math.random() - 0.5) * 6, 3 + Math.random() * 4, (Math.random() - 0.5) * 6, 0x9fe8ff, 0.14, 0.5, 1, 0, 9); fl.intensity = Math.max(fl.intensity, 1500 + Math.random() * 2500); }
    UI.wreck(i, true, Math.ceil(car.wreckT));
    if (car.wreckT <= 0) {
      car.wrecked = false;
      // vissza a kezdőpontra
      const st = this.spawnFor(i);
      car.reset(st.x, st.z, st.yaw);
      this.ctls[i].snap = true;
      car.suctionOn = true;
      UI.wreck(i, false);
      UI.toast(i, 'Új autó a startnál · totálkár: ' + car.wrecks);
    }
  },
  // kezdőpont az i. helyi autónak (online: a saját azonosító sávja); a foglalt helyet elkerüli
  spawnFor(i) {
    const avoid = this.cars.filter((c, k) => k !== i);
    if (Net.active) for (const [id, r] of Net.remotes) if (!Room.spectator(id)) avoid.push(r.car);
    return spawnPoint(this.world, Net.active ? Net.myId : i, avoid);
  },
  // mi történik 15 mp teljes elmerülés után: 'none' (fogócska), 'out' (bújócska-kör: kiesés), 'restart'
  waterRule(i) {
    if (!Net.active) return 'restart';
    if (Room.mode === 'tag') return 'none';
    if (Room.amSpectator()) return 'none';
    if (Room.mode === 'hide' && Room.phase === 'game' && Hide.active(Net.myId) && (Hide.phase === 'hide' || Hide.phase === 'seek')) return 'out';
    if (Room.mode === 'hide' && Room.phase === 'game') return 'none';   // visszaszámlálás / eredménytábla
    return 'restart';
  },
  // víz alatti zárlat: az óra a teljes elmerüléstől indul; 7 mp-től figyelmeztetés és fogy az életerő
  updateWater(i, dt) {
    const car = this.cars[i];
    const rule = this.waterRule(i);
    if (car.wrecked || rule === 'none' || car.submerged < 1) {
      car.drownT = 0; car._outSent = 0; UI.drown(i, false);
      return;
    }
    const prev = car.drownT || 0;
    car.drownT = prev + dt;
    const t = car.drownT;
    if (t >= DROWN_WARN) {
      if (prev < DROWN_WARN) { UI.toast(i, 'Víz alatti zárlat közeleg! Gyere ki a vízből!'); }
      if (Math.floor(t) !== Math.floor(prev)) Sound.blip(t > DROWN_OUT - 3 ? 1100 : 820, 0.07);
      if (car.damage() < DROWN_DMG_MAX) car.dmgExtra += DROWN_DMG * dt;
      UI.drown(i, true, Math.max(0, Math.ceil(DROWN_OUT - t)), rule === 'out' ? 'kiesés' : 'újraindulás');
    }
    if (t < DROWN_OUT) return;
    if (rule === 'restart') {
      const st = this.spawnFor(i);
      car.reset(st.x, st.z, st.yaw);
      car.drownT = 0; car.suctionOn = true;
      this.ctls[i].snap = true;
      UI.drown(i, false);
      Sound.zap();
      UI.toast(i, 'Zárlat a víz alatt · új autó a startnál');
    } else if (rule === 'out' && i === 0) {
      // a házigazda dönt; amíg nem erősíti meg, másodpercenként újra jelezzük
      if (!(car._outSent > 0)) {
        car._outSent = 1;
        if (Net.host) Hide.eliminate(Net.myId); else Net.sendHost({ t: 'out' });
      } else car._outSent -= dt;
    }
  },
  readControls(i, dt) {
    const car = this.cars[i], ct = car.ctl, solo = this.cfg.players === 1;
    const K0 = solo ? KEYMAP.solo : (i === 0 ? KEYMAP.p1 : KEYMAP.p2), pi0 = solo ? 0 : i;
    // lámpa ki/be (minden módban; bújócskában a kereső lámpája nem kapcsolható ki)
    if (anyHit(K0.lamp) || Input.padHit(pi0, 13) || (i === 0 && Touch.take('lampHit'))) {
      if (i === 0 && Net.active && Hide.on() && Hide.isSeeker(Net.myId)) { UI.toast(i, 'Keresőként nem kapcsolhatod le a lámpát'); }
      else { car.lampsOff = !car.lampsOff; UI.toast(i, car.lampsOff ? 'Lámpa: KI' : 'Lámpa: BE'); Sound.blip(car.lampsOff ? 380 : 760, 0.05); }
    }
    // fagyasztás (bújócska visszaszámlálás / elbújási idő a keresőnek) és néző
    if (i === 0 && (this.freeze || Room.amSpectator())) {
      Object.assign(ct, { throttle: 0, brake: 0, steer: 0, handbrake: 1, boost: 0, up: 0, upPressed: false, pitch: 0, roll: 0 });
      if (Room.amSpectator() && (anyHit(K0.cam) || Input.padHit(pi0, 3) || Touch.take('camHit'))) { this.specIdx = (this.specIdx || 0) + 1; }
      return;
    }
    if (car.wrecked) { Object.assign(ct, { throttle: 0, brake: 0, steer: 0, handbrake: 0, boost: 0, up: 0, upPressed: false, pitch: 0, roll: 0 }); return; }
    const K = solo ? KEYMAP.solo : (i === 0 ? KEYMAP.p1 : KEYMAP.p2);
    const pi = solo ? 0 : i;
    const thrK = anyDown(K.up) ? 1 : 0, brkK = anyDown(K.down) ? 1 : 0;
    let steer = (anyDown(K.right) ? 1 : 0) - (anyDown(K.left) ? 1 : 0);
    const T = i === 0 ? Touch : Touch.none;
    const padThr = Math.max(Input.padBtn(pi, 7), T.gas), padBrk = Math.max(Input.padBtn(pi, 6), T.brake);
    const padX = Math.max(-1, Math.min(1, Input.padAxis(pi, 0) + T.x)), padY = Math.max(-1, Math.min(1, Input.padAxis(pi, 1) + T.y));
    const kb = (ct._kbThr || 0) + ((thrK - (ct._kbThr || 0)) * Math.min(1, dt * 7));
    ct._kbThr = kb;
    ct.throttle = Math.min(1, Math.max(kb, padThr));
    ct.brake = Math.min(1, Math.max(brkK, padBrk));
    steer = Math.max(-1, Math.min(1, steer + padX));
    ct.steer = steer;
    ct.handbrake = Math.max(anyDown(K.hb) ? 1 : 0, Input.padBtn(pi, 1), T.hb);
    ct.boost = Math.max(anyDown(K.boost) ? 1 : 0, Input.padBtn(pi, 2), Input.padBtn(pi, 5), T.boost);
    ct.up = Math.max(anyDown(K.jump) ? 1 : 0, Input.padBtn(pi, 0), T.jump);
    if (anyHit(K.jump) || Input.padHit(pi, 0) || T.take('jumpHit')) ct.upPressed = true;
    // levegőben csak a felszállás UTÁN lenyomott irányok forgatnak (ne bukjon előre, ha gázt tartva ugrasz)
    const air = car.contacts < 2;
    const L = ct._latch || (ct._latch = { w: 0, s: 0, a: 0, d: 0, px: 0, py: 0 });
    const kA = anyDown(K.left) ? 1 : 0, kD = anyDown(K.right) ? 1 : 0;
    if (!air) { L.w = thrK; L.s = brkK; L.a = kA; L.d = kD; L.px = padX !== 0 ? 1 : 0; L.py = padY !== 0 ? 1 : 0; }
    else {
      if (!thrK) L.w = 0; if (!brkK) L.s = 0; if (!kA) L.a = 0; if (!kD) L.d = 0;
      if (Math.abs(padX) < 0.2) L.px = 0; if (Math.abs(padY) < 0.2) L.py = 0;
    }
    const pw = L.w ? 0 : thrK, ps = L.s ? 0 : brkK, ra = L.a ? 0 : kA, rd = L.d ? 0 : kD;
    ct.pitch = Math.max(-1, Math.min(1, pw - ps - (L.py ? 0 : padY)));
    ct.roll = Math.max(-1, Math.min(1, rd - ra + (L.px ? 0 : padX)));
    if (anyHit(K.suck) || Input.padHit(pi, 4) || T.take('suckHit')) {
      if (car.spec.rocket) { car.suctionOn = !car.suctionOn; UI.toast(i, car.suctionOn ? 'Szívás: BE' : 'Szívás: KI'); Sound.blip(car.suctionOn ? 880 : 440); }
    }
    if (anyHit(K.reset) || Input.padHit(pi, 8) || T.take('resetHit')) this.uprightCar(i);
    if (anyHit(K.cam) || Input.padHit(pi, 3) || T.take('camHit')) { UI.toast(i, 'Kamera: ' + this.ctls[i].next()); }
  },
  // fix lépésköz (1/720 s) akkumulátorral; képkockánként legfeljebb PHYS_MAX_DT szimulált idő
  // futó fogócska-/bújócska-körben részt vesz-e a saját autó (ilyenkor nincs menekülő eszköz)
  inRound() { return Net.active && Room.phase === 'game' && (Room.mode === 'tag' || Room.mode === 'hide') && Room.part.includes(Net.myId) && !Room.amSpectator(); },
  // visszaállítás: kerékre állítás helyben, csak (majdnem) álló autóval; körben várakozási idővel
  uprightCar(i) {
    const car = this.cars[i], now = performance.now() / 1000;
    if (car.speed > 3) { UI.toast(i, 'Kerékre állítás csak álló autóval'); return; }
    const cd = this.inRound() ? 10 : 1, left = (car._uprightAt || -1e9) + cd - now;
    if (left > 0) { UI.toast(i, 'Kerékre állítás ' + Math.ceil(left) + ' mp múlva'); return; }
    if (!car.uprightHere()) { UI.toast(i, 'Nincs talaj az autó alatt'); return; }
    car._uprightAt = now;
    UI.toast(i, 'Kerékre állítva');
  },
  physics(dt) {
    const cars = this.cars;
    this._acc = Math.min((this._acc || 0) + dt, PHYS_MAX_DT);
    const n = Math.floor(this._acc / PHYS_H + 1e-6);
    if (n <= 0) return;
    this._acc = Math.max(0, this._acc - n * PHYS_H);
    const sim = n * PHYS_H;
    for (const c of cars) c.beginFrame(sim);
    const me = cars[0];
    for (let k = 0; k < n; k++) {
      for (const c of cars) c.substepA(PHYS_H);
      if (cars.length === 2) carCarCollide(cars[0], cars[1]);
      // a frissen visszaállított autó és a teleportáló távoli autó rövid ideig nem ütközik (elavult szellem)
      if (Net.active && !Room.amSpectator() && !(me.spawnGuard > 0)) for (const [rid, r] of Net.remotes) if (!Room.spectator(rid) && !(r.guard > 0)) carPushFrom(me, r.car, rid);
      if (k === 0 && this.worldView.launch) for (const c of cars) this.worldView.launch.blast(c, sim);
      for (const c of cars) c.substepB(PHYS_H);
    }
  },
  effects(dt) {
    const P = this.particles, W = this.world;
    for (const car of this.cars) {
      car.frame();
      for (const w of car.wheels) {
        if (!w.contact) continue;
        const sp = car.speed;
        if (sp < 2.5) continue;
        let hex = null, rate = 0;
        if (w.hy < W.water - 0.6) continue;   // a mederben nincs fröccs
        if (w.hy < W.water + 0.1) { hex = 0xe8f4ff; rate = sp * 0.5; }
        else if (w.surf === SURF.GRASS) { hex = 0x9b8a62; rate = (sp - 6) * 0.06 + w.slip * 3; }
        else if (w.surf === SURF.SAND) { hex = 0xd8c48f; rate = sp * 0.18 + w.slip * 4; }
        else if (w.surf === SURF.SNOW) { hex = 0xffffff; rate = sp * 0.22 + w.slip * 4; }
        else if (w.surf === SURF.PAD || w.surf === SURF.ROCK) { hex = 0xd9d4ca; rate = w.slip * 6; }
        if (!hex || rate <= 0) continue;
        let cnt = rate * dt * 10;
        while (cnt > 0) {
          if (Math.random() < cnt) {
            const up = w.hy < W.water + 0.1 ? 3 : 1.2;
            P.emit(w.hx + (Math.random() - 0.5) * 0.4, w.hy + 0.15, w.hz + (Math.random() - 0.5) * 0.4,
              -car.v[0] * 0.15 + (Math.random() - 0.5) * 1.5, up + Math.random() * 1.5, -car.v[2] * 0.15 + (Math.random() - 0.5) * 1.5,
              hex, 0.5 + Math.random() * 0.4, 0.7 + Math.random() * 0.8, 0.45, 1.8, w.hy < W.water + 0.1 ? 6 : 0.3);
          }
          cnt -= 1;
        }
      }
      if (car.spec.rocket) {
        const v = [0, 0, 0];
        if (car.fxBoost > 0.05) for (const lz of EXH_Z) {
          car.toWorld(-2.6, -0.11, lz, v);
          for (let k = 0; k < 1; k++) P.emit(v[0], v[1], v[2], -car.f[0] * 14 + car.v[0] * 0.8 + (Math.random() - 0.5) * 2, -car.f[1] * 14 + car.v[1] * 0.8 + (Math.random() - 0.5) * 2, -car.f[2] * 14 + car.v[2] * 0.8 + (Math.random() - 0.5) * 2, 0xeef8ff, 0.4, 0.45, 0.35, 3.5, -0.5);
        }
        const upL = Math.max(car.fxUp, car.fxAtt * 0.4);
        if (upL > 0.05) for (const [lx, lz] of [[1.75, 0.55], [1.75, -0.55], [-1.75, 0.55], [-1.75, -0.55]]) {
          if (Math.random() > upL) continue;
          car.toWorld(lx, -0.4, lz, v);
          P.emit(v[0], v[1], v[2], -car.u[0] * 10 + car.v[0] * 0.8, -car.u[1] * 10 + car.v[1] * 0.8, -car.u[2] * 10 + car.v[2] * 0.8, 0xeef8ff, 0.45, 0.5, 0.3, 4, -0.5);
        }
      }
      if (car.treeHit) {
        const t = car.treeHit; car.treeHit = null;
        if (Net.active) Net.noteTree(t);
        for (let k = 0; k < 26; k++) P.emit(t.x + (Math.random() - 0.5) * 2, t.y + 1 + Math.random() * t.h * 0.7, t.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 5, Math.random() * 3, (Math.random() - 0.5) * 5, k % 3 ? 0x4f8d45 : 0x8a6a45, 0.35 + Math.random() * 0.3, 1.2 + Math.random(), 0.8, 0.6, 2.5);
        Sound.crash(0.35);
      }
      // ütközési por
      if (car.impact > 6) for (let k = 0; k < 8; k++) P.emit(car.c[0] + (Math.random() - 0.5) * 3, car.c[1] - 0.3, car.c[2] + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4, 0xbfb29a, 0.8, 1.2, 0.4, 2.5, 0.3);
      if (car.inWater > 0.05 && car.speed > 3 && Math.random() < 0.6) P.emit(car.c[0] + (Math.random() - 0.5) * 3, W.water + 0.1, car.c[2] + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, 3 + Math.random() * 3, (Math.random() - 0.5) * 3, 0xf2f8ff, 0.6, 0.9, 0.55, 2, 7);
    }
    P.update(dt);
  },
  loop(now) {
    requestAnimationFrame(t => this.loop(t));
    this._rafAt = performance.now();
    this.step(now, true);
  },
  // háttérbe tett fülön a requestAnimationFrame leáll; online módban egy Worker-órajel lépteti tovább
  // a játékot (rajzolás nélkül), hogy a házigazda logikája (megtalálás, kör vége, lobbi) és a hálózat fusson
  startBgTicker() {
    const tick = () => {
      const now = performance.now();
      if (this.state === 'play' && Net.active && now - (this._rafAt || 0) > 300) this.step(now, false);
    };
    try {
      const url = URL.createObjectURL(new Blob(['setInterval(function(){postMessage(0)},' + Math.round(BG_TICK * 1000) + ')'], { type: 'text/javascript' }));
      this._bgWorker = new Worker(url);
      this._bgWorker.onmessage = tick;
    } catch (e) { setInterval(tick, BG_TICK * 1000); }
  },
  step(now, draw) {
    let dtReal = (now - this.last) / 1000; this.last = now;
    if (!(dtReal > 0)) dtReal = 1 / 60;
    dtReal = Math.min(dtReal, 1);           // játéklogika (órák, fogóidő): valós idő, max. 1 mp
    const dt = Math.min(dtReal, PHYS_MAX_DT);  // szimuláció
    Input.poll();
    UI.frame(dt);
    // online módban a szünet nem állítja meg a világot
    if (this.state === 'play' && (!this.paused || Net.active)) {
      // szünetben / háttérben az autó áll (kézifék; a fék álló autónál tolatás volna)
      for (let i = 0; i < this.cars.length; i++) { if (this.paused || !draw) Object.assign(this.cars[i].ctl, { throttle: 0, brake: 0, steer: 0, handbrake: 1, boost: 0, up: 0, upPressed: false, pitch: 0, roll: 0 }); else this.readControls(i, dt); }
      for (let i = 0; i < this.cars.length; i++) { this.updateWreck(i, dt); this.updateWater(i, dtReal); }
      this.physics(dt);
      this.effects(dt);
    }
    if (this.state === 'play' && Net.active) {
      const me = this.cars[0];
      if (me) for (const d of me.dents) Net.noteDent(d);
      Net.flushEvents();
      Net.update(dtReal, me);
    }
    if (this.state === 'play') {
      Room.update(dtReal);
      Tag.update(dtReal);
      Hide.update(dtReal);
      // kész jelzés a lobbiban: Enter / gamepad D-pad fel / a lobbi gombja
      if (Net.active && Room.phase === 'lobby' && !this.paused && (Input.hit('Enter') || Input.hit('NumpadEnter') || Input.padHit(0, 12))) Room.toggleReady();
    }
    if (this.state === 'play') {
      const spect = Net.active && Room.amSpectator();
      this.cars.forEach((c, i) => {
        c.frame();
        if (i === 0) this.views[0].setVisible(!spect);
        this.views[i].update(this.paused ? 0 : dt);
        this.ctls[i].update(i === 0 ? this.camTarget() : c, dt);
        Sound.updateVoice(this.voices[i], c, dt, this.paused || (i === 0 && spect) ? 0 : 1);
        UI.hud(i, c);
      });
      if (Net.active) Sound.setListener(this.cams[0]);
    }
    if (draw) {
      this.skyEvents.update(dt);
      if (this.debris) this.debris.update(dt);
      updateClouds(this.sky.clouds, dt);
      this.worldView.update(dt, this.cars, this.particles);
      this.render(dt);
    }
    Input.endFrame();
  },
  // a kamera célpontja: saját autó, vagy nézőként egy játékban lévő játékos autója
  camTarget() {
    const me = this.cars[0];
    if (!Net.active || !Room.amSpectator()) return me;
    const ids = Room.part.filter(id => Net.remotes.has(id) && !Room.spectator(id));
    if (!ids.length) return me;
    const id = ids[(this.specIdx || 0) % ids.length];
    this.specName = Net.remotes.get(id).name;
    return Net.remotes.get(id).car;
  },
  placeSun(x, y, z) {
    const s = this.sun;
    s.target.position.set(x, y, z);
    s.position.set(x + this.sunDir.x * 180, y + this.sunDir.y * 180, z + this.sunDir.z * 180);
    s.target.updateMatrixWorld();
  },
  renderView(cam, x, y, w, h, focus) {
    const r = this.renderer;
    cam.aspect = w / h; cam.updateProjectionMatrix();
    r.setViewport(x, y, w, h); r.setScissor(x, y, w, h);
    this.placeSun(focus[0], focus[1], focus[2]);
    this.sky.sky.position.copy(cam.position);
    this.particles.mat.uniforms.uScale.value = h * r.getPixelRatio() / (2 * Math.tan(cam.fov * Math.PI / 360));
    r.render(this.scene, cam);
  },
  render(dt) {
    const W = innerWidth, H = innerHeight, r = this.renderer;
    r.setScissorTest(true);
    if (this.state === 'menu') {
      this.menuT += dt;
      const Z = this.world.zone, rr = this.world.ramps[0];
      const a = this.menuT * 0.06 + 2.2, d = 70;
      const cx = rr.x + 8, cz = rr.z + 10;
      this.menuCam.position.set(cx + Math.cos(a) * d, Z.h + 22 + Math.sin(this.menuT * 0.2) * 4, cz + Math.sin(a) * d);
      this.menuCam.lookAt(cx, Z.h + 8, cz);
      this.renderView(this.menuCam, 0, 0, W, H, [cx, Z.h, cz]);
    } else if (this.cars.length === 1) {
      this.renderView(this.cams[0], 0, 0, W, H, this.camTarget().c);
    } else {
      const h2 = Math.floor(H / 2);
      this.renderView(this.cams[0], 0, H - h2, W, h2, this.cars[0].c);
      this.renderView(this.cams[1], 0, 0, W, H - h2, this.cars[1].c);
    }
    r.setScissorTest(false);
  }
};
function randomSeed() {
  const ch = 'abcdefghjkmnpqrstuvwxyz23456789'; let s = '';
  for (let i = 0; i < 6; i++) s += ch[Math.floor(Math.random() * ch.length)];
  return s;
}

// ---------------- felület ----------------
const UI = {
  sel: 0, toasts: [[], []],
  init() {
    this.menu = $('menu'); this.list = $('menu-list'); this.help = $('help'); this.pause = $('pause');
    this.huds = [$('hud0'), $('hud1')];
    this.buildMenu();
    addEventListener('keydown', e => this.key(e));
    $('help-close').onclick = () => this.toggleHelp(false);
    this.pauseItems = [...this.pause.querySelectorAll('[data-act]')];
    this.pauseItems.forEach((el, i) => { el.onclick = () => this.pauseAct(el.dataset.act); el.onmouseenter = () => { this.psel = i; this.drawPause(); }; });
    this.psel = 0;
    this.padNav = 0;
  },
  rows() {
    const c = Game.cfg;
    const carName = (id) => SPECS[id].name;
    const rows = [
      { id: 'start', label: 'JÁTÉK INDÍTÁSA', big: true },
      { id: 'players', label: 'Játékosok', val: c.players === 1 ? '1 játékos' : '2 játékos · osztott képernyő' },
    ];
    rows.push({ id: 'online', label: 'Online játék (max 6 fő)', btn: true });
    rows.push({ id: 'map', label: 'Pálya', val: c.map === 'classic' ? 'Klasszikus' : 'Generált' });
    if (c.map === 'gen') rows.push({ id: 'seed', label: 'Seed', seed: true }, { id: 'newseed', label: 'Új véletlen seed', btn: true });
    if (Screen.canFull()) rows.push({ id: 'full', label: Screen.isFull() ? 'Kilépés a teljes képernyőből' : 'Teljes képernyő', btn: true });
    rows.push({ id: 'help', label: 'Irányítás', btn: true });
    return rows;
  },
  buildMenu() {
    const rows = this.rows();
    this.cur = rows;
    if (this.sel >= rows.length) this.sel = rows.length - 1;
    this.list.innerHTML = '';
    rows.forEach((r, i) => {
      const el = document.createElement('div');
      el.className = 'row' + (r.big ? ' big' : '') + (i === this.sel ? ' sel' : '');
      if (r.seed) {
        el.innerHTML = `<span class="lab">${r.label}</span><span class="val"><input id="seed-input-row" spellcheck="false" maxlength="16"></span>`;
      } else if (r.val !== undefined) {
        el.innerHTML = `<span class="lab">${r.label}</span><span class="val"><b class="arr" data-d="-1">◄</b> ${r.val} <b class="arr" data-d="1">►</b></span>`;
      } else el.innerHTML = `<span class="lab">${r.label}</span>`;
      el.onmouseenter = () => { if (this.sel !== i) { this.sel = i; this.highlight(); } };
      el.onclick = (e) => {
        const d = e.target.dataset && e.target.dataset.d ? +e.target.dataset.d : 1;
        this.sel = i; this.activate(r, d);
      };
      this.list.appendChild(el);
    });
    const si = $('seed-input-row');
    if (si) {
      si.value = Game.cfg.seed;
      si.addEventListener('input', () => { Game.cfg.seed = si.value.trim().slice(0, 16) || 'terep'; this.schedulePreview(); });
      si.addEventListener('keydown', e => {
        e.stopPropagation();
        if (['Enter', 'Escape', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
          si.blur();
          if (e.key === 'ArrowDown') this.move(1); if (e.key === 'ArrowUp') this.move(-1);
          if (e.key === 'Enter') Game.start();
          e.preventDefault();
        }
      });
      si.addEventListener('focus', () => { this.sel = this.cur.findIndex(r => r.seed); this.highlight(); });
    }
    const info = $('map-info');
    const W = Game.world;
    info.textContent = W ? (Game.cfg.map === 'classic' ? 'Klasszikus pálya · tó, havas csúcs, a nagy rámpa' : `Generált pálya · seed: ${Game.cfg.seed}`) : '';
  },
  highlight() { [...this.list.children].forEach((el, i) => el.classList.toggle('sel', i === this.sel)); },
  move(d) { this.sel = (this.sel + d + this.cur.length) % this.cur.length; this.highlight(); Sound.blip(520, 0.03); },
  schedulePreview() {
    clearTimeout(this._pt);
    this._pt = setTimeout(() => { Game.ensureWorld(); this.buildMenu(); const si = $('seed-input-row'); if (si && this.cur[this.sel] && this.cur[this.sel].seed) { si.focus(); si.setSelectionRange(si.value.length, si.value.length); } }, 450);
  },
  activate(r, d) {
    const c = Game.cfg, cars = ['raketa', 'terep'];
    Sound.init();
    switch (r.id) {
      case 'start': Game.start(); return;
      case 'players': c.players = c.players === 1 ? 2 : 1; break;
      case 'car0': c.car[0] = cars[(cars.indexOf(c.car[0]) + 1) % 2]; break;
      case 'car1': c.car[1] = cars[(cars.indexOf(c.car[1]) + 1) % 2]; break;
      case 'map': c.map = c.map === 'classic' ? 'gen' : 'classic'; Game.ensureWorld(); break;
      case 'seed': { const si = $('seed-input-row'); if (si) si.focus(); return; }
      case 'newseed': c.seed = randomSeed(); Game.ensureWorld(); break;
      case 'help': this.toggleHelp(true); return;
      case 'online': this.netOpen(); return;
      case 'full': Screen.toggle().then(() => this.buildMenu()); return;
    }
    Sound.blip(760, 0.04);
    this.buildMenu();
  },
  key(e) {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (!$('online').classList.contains('hidden')) { if (e.code === 'Escape') $('online').classList.add('hidden'); return; }
    if (e.code === 'F1' || (e.code === 'KeyH' && Game.state !== 'play')) { this.toggleHelp(); e.preventDefault(); return; }
    if (e.code === 'KeyM') { const m = Sound.toggleMute(); if (Game.state === 'play') this.toast(0, m ? 'Hang: KI' : 'Hang: BE'); return; }
    if (!this.help.classList.contains('hidden')) { if (e.code === 'Escape' || e.code === 'Enter') this.toggleHelp(false); return; }
    if (Game.state === 'menu') {
      if (e.code === 'ArrowDown' || e.code === 'KeyS') this.move(1);
      else if (e.code === 'ArrowUp' || e.code === 'KeyW') this.move(-1);
      else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { const r = this.cur[this.sel]; if (r.val !== undefined) this.activate(r, -1); }
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') { const r = this.cur[this.sel]; if (r.val !== undefined) this.activate(r, 1); }
      else if (e.code === 'Enter' || e.code === 'Space') { this.activate(this.cur[this.sel], 1); e.preventDefault(); }
    } else if (Game.state === 'play') {
      if (e.code === 'Escape') { this.setPause(!Game.paused); return; }
      if (Game.paused) {
        if (e.code === 'ArrowDown') { this.psel = (this.psel + 1) % this.pauseItems.length; this.drawPause(); }
        if (e.code === 'ArrowUp') { this.psel = (this.psel + this.pauseItems.length - 1) % this.pauseItems.length; this.drawPause(); }
        if (e.code === 'Enter') this.pauseAct(this.pauseItems[this.psel].dataset.act);
      }
    }
  },
  frame(dt) {
    // gamepad menü-navigáció
    const pads = Input.pads.length;
    if (!pads) return;
    const ay = Input.padAxis(0, 1), ax = Input.padAxis(0, 0);
    const up = Input.padHit(0, 12) || (ay < -0.6 && this.padNav <= 0), dn = Input.padHit(0, 13) || (ay > 0.6 && this.padNav <= 0);
    const lf = Input.padHit(0, 14) || (ax < -0.6 && this.padNav <= 0), rt = Input.padHit(0, 15) || (ax > 0.6 && this.padNav <= 0);
    this.padNav = Math.abs(ay) > 0.6 || Math.abs(ax) > 0.6 ? (this.padNav <= 0 ? 0.28 : this.padNav - dt) : 0;
    const a = Input.padHit(0, 0), b = Input.padHit(0, 1), start = Input.padHit(0, 9) || (Input.pads[1] && Input.padHit(1, 9));
    if (Game.state === 'menu') {
      if (!this.help.classList.contains('hidden')) { if (a || b) this.toggleHelp(false); return; }
      if (up) this.move(-1); if (dn) this.move(1);
      const r = this.cur[this.sel];
      if ((lf || rt) && r.val !== undefined) this.activate(r, rt ? 1 : -1);
      if (a || start) this.activate(r, 1);
    } else if (Game.state === 'play') {
      if (start) this.setPause(!Game.paused);
      else if (Game.paused) {
        if (up) { this.psel = (this.psel + this.pauseItems.length - 1) % this.pauseItems.length; this.drawPause(); }
        if (dn) { this.psel = (this.psel + 1) % this.pauseItems.length; this.drawPause(); }
        if (a) this.pauseAct(this.pauseItems[this.psel].dataset.act);
        if (b) this.setPause(false);
      }
    }
  },
  toggleHelp(v) {
    const show = v === undefined ? this.help.classList.contains('hidden') : v;
    this.help.classList.toggle('hidden', !show);
  },
  setPause(p) {
    Game.paused = p; this.pause.classList.toggle('hidden', !p); this.psel = 0; this.drawPause();
    Sound.blip(p ? 440 : 660, 0.05);
  },
  drawPause() {
    this.pauseItems = [...this.pause.querySelectorAll('[data-act]')].filter(el => el.offsetParent !== null || !el.classList.contains('hostonly'));
    this.pauseItems.forEach((el, i) => { el.onclick = () => this.pauseAct(el.dataset.act); el.onmouseenter = () => { this.psel = i; this.drawPause(); }; });
    if (this.psel >= this.pauseItems.length) this.psel = 0;
    [...this.pause.querySelectorAll('[data-act]')].forEach(el => el.classList.remove('sel'));
    this.pauseItems.forEach((el, i) => el.classList.toggle('sel', i === this.psel));
    const pm = $('p-mode'), pl = $('p-len');
    if (pm) pm.textContent = ROOM_MODE_NAME[Room.mode];
    if (pl) { pl.textContent = Math.round(Room.len / 60) + ' perc'; pl.parentNode.style.visibility = Room.mode === 'free' ? 'hidden' : ''; }
  },
  flash(col) { const f = $('flash'); f.style.background = col; f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); },
  tagHud(T) {
    const h = $('taghud'), big = $('tagbig'), res = $('tagres');
    if (!T) { if (!h.classList.contains('hidden')) { h.classList.add('hidden'); big.classList.add('hidden'); if (!this._hideRes) res.classList.add('hidden'); } return; }
    h.classList.remove('hidden');
    const now = T.now(), rem = Math.max(0, T.endAt - now), fmt = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
    const my = T.times[Net.myId] || 0;
    let tt = 'FOGÓCSKA', ti = '', tm = '';
    if (T.phase === 'wait' || T.phase === 'off') { tt = 'FOGÓCSKA'; ti = 'Várakozás játékosokra (min. 2 fő)'; }
    else if (T.phase === 'count') { tt = 'FOGÓCSKA · KÖR INDUL'; ti = 'Fogó: <b>' + esc(T.name(T.it)) + '</b>'; }
    else if (T.phase === 'play') { tt = 'FOGÓCSKA · ' + fmt(rem); ti = T.it === Net.myId ? '<b>TE VAGY A FOGÓ!</b>' : 'Fogó: <b>' + esc(T.name(T.it)) + '</b>'; tm = 'Fogóidőd: ' + my.toFixed(1) + ' mp'; }
    else if (T.phase === 'res') { tt = 'FOGÓCSKA · KÖR VÉGE'; ti = 'Új kör ' + Math.ceil(rem) + ' mp múlva'; }
    const key = tt + '|' + ti + '|' + tm;
    if (h._k !== key) { h._k = key; h.querySelector('.tt').textContent = tt; h.querySelector('.ti').innerHTML = ti; h.querySelector('.tm').textContent = tm; }
    h.classList.toggle('me', T.phase === 'play' && T.it === Net.myId);
    if (T.phase === 'count') { big.classList.remove('hidden'); const n = String(Math.max(1, Math.ceil(rem))); if (big.textContent !== n) { big.textContent = n; Sound.blip(660, 0.08); } }
    else if (!big.classList.contains('hidden')) { big.classList.add('hidden'); big.textContent = ''; if (T.phase === 'play') Sound.blip(1320, 0.18); }
    if (T.phase === 'res' && T.results) {
      res.classList.remove('hidden');
      const rk = JSON.stringify(T.results);
      if (res._k !== rk) {
        res._k = rk;
        res.querySelector('h2').textContent = 'FOGÓCSKA · EREDMÉNY';
        $('tagres-t').innerHTML = T.results.map((r, i) => `<tr class="${i === 0 ? 'win1' : ''}"><td>${i + 1}.</td><td><i style="display:inline-block;width:9px;height:9px;margin-right:6px;background:${NET_COLORS_CSS[r.id % 6]}"></i>${esc(r.name)}${r.id === Net.myId ? ' (te)' : ''}${i === 0 ? ' · NYERT' : ''}</td><td class="t">${r.t.toFixed(1)} mp</td></tr>`).join('');
      }
      $('tagres-n').textContent = 'Fogóként töltött idő. Új kör ' + Math.ceil(rem) + ' mp múlva.';
    } else res.classList.add('hidden');
  },
  // ---- lobbi: játékosok, kész jelzés; nézőnek "várj a kör végéig"
  lobby(R) {
    const el = $('lobby');
    const show = R && Net.active && (R.phase === 'lobby' || R.amSpectator());
    if (!show) { if (!el.classList.contains('hidden')) el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const ps = [...Net.players.values()].sort((a, b) => a.id - b.id), me = Net.myId;
    let body, btn = '';
    if (R.phase === 'lobby') {
      const n = ps.length, nr = ps.filter(p => R.ready.has(p.id)).length;
      body = ps.map(p => `<div class="lp${R.ready.has(p.id) ? ' rd' : ''}"><i style="background:${NET_COLORS_CSS[p.id % 6]}"></i>${esc(p.name)}${p.id === me ? ' (te)' : ''}<span>${R.ready.has(p.id) ? 'KÉSZ' : 'vár'}</span></div>`).join('')
        + `<div class="lh">${n < 2 ? 'Legalább 2 játékos kell.' : nr === n ? 'Mindenki kész, indul!' : 'A kör indul, ha mindenki kész (' + nr + '/' + n + ').'}</div>`;
      const mine = R.ready.has(me);
      btn = `<div class="lbtn${mine ? ' on' : ''}" id="lobby-rdy">${mine ? 'KÉSZ ✓ (visszavonás)' : 'KÉSZ VAGYOK'}</div><div class="lk">${IS_TOUCH ? '' : 'Enter · gamepad: D-pad fel'}</div>`;
    } else {
      const head = R.isOut(me) ? 'Kiestél: zárlat a víz alatt. Várd meg a kör végét.' : 'Kör folyamatban. A kör végén beszállhatsz.';
      body = `<div class="lh">${head}<br>Nézőként követed: <b>${esc(Game.specName || '?')}</b></div><div class="lk">${IS_TOUCH ? 'KAMERA gomb: másik játékos' : 'C: másik játékos'}</div>`;
    }
    const head = `LOBBI · ${ROOM_MODE_NAME[R.mode].toUpperCase()} · ${Math.round(R.len / 60)} PERC`;
    const key = head + body + btn;
    if (el._k !== key) {
      el._k = key;
      el.innerHTML = `<div class="lt">${head}</div>${body}${btn}`;
      const b = $('lobby-rdy'); if (b) b.onclick = () => Room.toggleReady();
    }
  },
  // ---- bújócska: HUD, fekete kép a keresőnek, fényben-jelzés, eredménytábla
  hideHud(H, vig) {
    const h = $('hidehud'), black = $('hideblack'), v = $('hidevig'), res = $('tagres');
    if (!H) {
      if (!h.classList.contains('hidden')) { h.classList.add('hidden'); black.classList.add('hidden'); v.style.opacity = 0; if (this._hideRes) { res.classList.add('hidden'); this._hideRes = false; } }
      return;
    }
    h.classList.remove('hidden');
    const my = Net.myId, part = H.active(my), seeker = H.isSeeker(my);
    const rem = Math.max(0, H.endAt - H.now()), fmt = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
    const left = H.hidersLeft();
    let tt = 'BÚJÓCSKA', ti = '', tm = '';
    const roleTxt = !part ? 'NÉZŐ' : seeker ? 'KERESŐ' : 'BÚJÓ';
    if (H.phase === 'count') { tt = 'BÚJÓCSKA · KÖR INDUL'; ti = 'Szereped: <b>' + roleTxt + '</b>'; }
    else if (H.phase === 'hide') { tt = 'BÚJÓCSKA · ELBÚJÁS ' + fmt(rem); ti = 'Szereped: <b>' + roleTxt + '</b>'; tm = !part ? 'Nézőként figyelsz' : seeker ? 'Várj, amíg a többiek elbújnak' : (IS_TOUCH ? 'Bújj el! (LÁMPA gomb)' : 'Bújj el! Lámpa: L'); }
    else if (H.phase === 'seek') { tt = 'BÚJÓCSKA · ' + fmt(rem); ti = 'Szereped: <b>' + roleTxt + '</b> · bújók: ' + left; tm = 'Következő ping: ' + Math.ceil(H.nextPing()) + ' mp'; }
    else if (H.phase === 'res') { tt = 'BÚJÓCSKA · KÖR VÉGE'; ti = 'Vissza a lobbiba ' + Math.ceil(rem) + ' mp múlva'; }
    const key = tt + '|' + ti + '|' + tm;
    if (h._k !== key) { h._k = key; h.querySelector('.tt').textContent = tt; h.querySelector('.ti').innerHTML = ti; h.querySelector('.tm').textContent = tm; }
    h.classList.toggle('me', part && seeker);
    // a kereső képe fekete az elbújás alatt
    const bl = part && seeker && H.phase === 'hide';
    black.classList.toggle('hidden', !bl);
    if (bl) { const t = 'Te vagy a KERESŐ. A többiek most bújnak el.|' + Math.ceil(rem); if (black._k !== t) { black._k = t; black.innerHTML = '<b>' + Math.ceil(rem) + '</b><span>Te vagy a KERESŐ. A többiek most bújnak el.</span>'; } }
    // visszaszámlálás nagy számokkal
    const big = $('tagbig');
    if (H.phase === 'count') { big.classList.remove('hidden'); const n = String(Math.max(1, Math.ceil(rem))); if (big.textContent !== n) { big.textContent = n; Sound.blip(660, 0.08); } }
    else if (!big.classList.contains('hidden') && Room.mode === 'hide') { big.classList.add('hidden'); big.textContent = ''; Sound.blip(1320, 0.18); }
    // fényben-jelzés a bújónak (pirosodó képszél)
    v.style.opacity = (vig || 0).toFixed(2);
    if (H.phase === 'res' && H.results) {
      res.classList.remove('hidden'); this._hideRes = true;
      const rk = 'h' + JSON.stringify(H.results);
      if (res._k !== rk) {
        res._k = rk;
        res.querySelector('h2').textContent = 'BÚJÓCSKA · EREDMÉNY';
        $('tagres-t').innerHTML = H.results.map((r, i) => `<tr class="${r.w ? 'win1' : ''}"><td>${i + 1}.</td><td><i style="display:inline-block;width:9px;height:9px;margin-right:6px;background:${NET_COLORS_CSS[r.id % 6]}"></i>${esc(r.name)}${r.id === my ? ' (te)' : ''}${r.w ? ' · NYERT' : ''}</td><td class="t">${r.s === 'k' ? 'kereső' : r.s === 'a' ? 'túlélte' : r.s === 'x' ? 'zárlat · ' + r.t.toFixed(1) + ' mp' : r.t.toFixed(1) + ' mp'}${r.o ? ' · zárlat' : ''}</td></tr>`).join('');
      }
      const why = { all: 'Mindenkit megtaláltak; az utolsó megtalált nyert.', time: 'Lejárt az idő; minden túlélő nyert.',
        drown: 'Az utolsó bújók is vízbe fulladtak (zárlat); a keresők nyertek.', nosk: 'Nem maradt kereső; a túlélők nyertek.' }[H.why] || '';
      $('tagres-n').textContent = why + ' Túlélési idő a keresés kezdetétől. Lobbi ' + Math.ceil(rem) + ' mp múlva.';
    } else if (this._hideRes) { res.classList.add('hidden'); this._hideRes = false; }
  },
  pauseAct(a) {
    if (a === 'resume') this.setPause(false);
    else if (a === 'restart') {
      this.setPause(false);
      // futó fogócska-/bújócska-körben nem lehet a startra menekülni (teleport + javítás)
      if (Game.inRound()) this.toast(0, 'Kör közben nem indulhatsz újra');
      else if (Net.active) { const st = Game.spawnFor(0); Game.cars[0].reset(st.x, st.z, st.yaw); }
      else Game.start();
    }
    else if (a === 'menu') { this.setPause(false); Game.toMenu(); }
    else if (a === 'help') this.toggleHelp(true);
    else if (a === 'tagmode' && Net.host) { const m = ROOM_MODES[(ROOM_MODES.indexOf(Room.mode) + 1) % ROOM_MODES.length]; Room.hostSetup(m, ROOM_DEF[m]); this.drawPause(); this.netList(); }
    else if (a === 'taglen' && Net.host && Room.mode !== 'free') { const L = Room.lens(), i = L.indexOf(Room.len); Room.hostSetup(Room.mode, L[(i + 1) % L.length]); this.drawPause(); }
  },
  showMenu() {
    document.body.classList.remove('playing');
    $('netinfo').classList.add('hidden');
    this.menu.classList.remove('hidden');
    this.huds.forEach(h => h.classList.add('hidden'));
    document.body.classList.remove('split');
    this.buildMenu();
  },
  showGame(n) {
    document.body.classList.add('playing');
    this.menu.classList.add('hidden');
    document.body.classList.toggle('split', n === 2);
    this.huds.forEach((h, i) => {
      h.classList.toggle('hidden', i >= n);
      if (i < n) {
        const car = Game.cars[i];
        h.querySelector('.name').textContent = (n === 2 ? (i + 1) + '. játékos · ' : '') + car.spec.name;
        h.querySelector('.rocket').style.display = car.spec.rocket ? '' : 'none';
      }
    });
    $('seedtag').textContent = Game.cfg.map === 'classic' ? 'Klasszikus pálya' : 'seed: ' + Game.cfg.seed;
  },
  wreck(i, on, sec, title, msg) {
    const h = this.huds[i]; if (!h) return;
    const w = h.querySelector('.wreck');
    w.classList.toggle('on', on);
    if (on) {
      w.querySelector('b').textContent = title || 'TOTÁLKÁR';
      w.querySelector('span').textContent = msg || (sec ? 'akkumulátor-zárlat · újraindulás ' + sec + ' mp' : 'akkumulátor-zárlat');
    }
  },
  // víz alatti zárlat figyelmeztetés (7 mp teljes elmerülés után)
  drown(i, on, sec, what) {
    const h = this.huds[i]; if (!h) return;
    const d = h.querySelector('.drown');
    if (!on) { if (d.classList.contains('on')) d.classList.remove('on'); return; }
    d.classList.add('on');
    const t = 'zárlat ' + sec + ' mp múlva · ' + what + ' · gyere ki a vízből!';
    const sp = d.querySelector('span'); if (sp.textContent !== t) sp.textContent = t;
  },
  // ---- online panel
  netOpen(msg, err) {
    const P = $('online');
    P.classList.remove('hidden');
    const ni = $('net-name');
    if (!ni.value) { let n = ''; try { n = localStorage.getItem('t30name') || ''; } catch (e) { } ni.value = n || ('Pilóta' + Math.floor(10 + Math.random() * 89)); }
    $('net-map').textContent = Game.cfg.map === 'classic' ? 'Klasszikus pálya' : 'Generált pálya · seed: ' + Game.cfg.seed;
    this.netStatus(msg || '', err);
    if (!this._netInit) {
      this._netInit = true;
      Net.onStatus = (m, e) => this.netStatus(m, e);
      const name = () => { const v = ($('net-name').value || '').trim().slice(0, 16) || 'Pilóta'; try { localStorage.setItem('t30name', v); } catch (e) { } return v; };
      const busy = (b) => { $('net-host').disabled = b; $('net-join').disabled = b; };
      $('net-host').onclick = async () => { Sound.init(); busy(true); const ok = await Net.hostRoom(name(), $('net-mode').value, +$('net-len').value); busy(false); if (ok) { P.classList.add('hidden'); Game.cfg.players = 1; Game.start(); } };
      const syncLen = () => {
        const m = $('net-mode').value, L = ROOM_LENS[m], sel = $('net-len');
        sel.style.display = L ? '' : 'none';
        if (L) sel.innerHTML = L.map(v => `<option value="${v}"${v === ROOM_DEF[m] ? ' selected' : ''}>${v / 60} perc</option>`).join('');
        $('net-modehint').style.display = L ? '' : 'none';
        $('net-modehint').textContent = m === 'tag' ? 'Fogócska: aki fogó, annak a kocsija hozzáérve átadja a szerepet. Az nyer, aki a legkevesebb ideig volt fogó.'
          : 'Bújócska: 40 mp elbújás után a kereső fénykúppal keres; akit 1,5 mp-ig fényben tart (vagy megérint), az is kereső lesz. A túlélők nyernek.';
      };
      $('net-mode').onchange = syncLen; syncLen();
      $('net-join').onclick = async () => {
        Sound.init(); busy(true);
        const ok = await Net.joinRoom($('net-code').value, name()); busy(false);
        if (ok) { const w = Net._welcome; Game.cfg.map = w.map; Game.cfg.seed = w.seed; Game.cfg.players = 1; Game.ensureWorld(); P.classList.add('hidden'); Game.start(); }
      };
      $('net-close').onclick = () => P.classList.add('hidden');
      $('net-code').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') $('net-join').click(); });
      $('net-name').addEventListener('keydown', e => e.stopPropagation());
      $('net-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); });
    }
  },
  netStatus(m, err) { const s = $('net-status'); s.textContent = m || ''; s.classList.toggle('err', !!err); },
  netList() {
    const el = $('netinfo');
    if (!Net.active) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const ps = [...Net.players.values()].sort((a, b) => a.id - b.id);
    document.body.classList.toggle('nethost', Net.host);
    el.innerHTML = `<b>SZOBA ${Net.code}</b> · ${ps.length}/${NET_MAX}` + (Room.mode !== 'free' ? ' · ' + ROOM_MODE_NAME[Room.mode].toUpperCase() : '') + ps.map(p => `<div><i style="background:${NET_COLORS_CSS[p.id % 6]}"></i>${p.name.replace(/[<>&]/g, '')}${p.id === Net.myId ? ' (te)' : ''}${p.id === 0 ? ' ★' : ''}${Room.isOut(p.id) ? ' · kiesett' : Room.spectator(p.id) ? ' · vár' : ''}</div>`).join('');
  },
  toast(i, msg) {
    const h = this.huds[i]; if (!h) return;
    const t = h.querySelector('.toast');
    t.textContent = msg; t.classList.remove('fade'); void t.offsetWidth; t.classList.add('fade');
  },
  hud(i, car) {
    const h = this.huds[i];
    if (!h._els) h._els = { spd: h.querySelector('.spd'), dmg: h.querySelector('.dmg'), tank: h.querySelector('.tankbar i'), tankv: h.querySelector('.tankv'), suck: h.querySelector('.suck'), surf: h.querySelector('.surf') };
    const E = h._els;
    const kmh = Math.round(Math.abs(car.fwdSpeed) * 3.6);
    const s = String(Math.min(999, kmh)).padStart(3, '0');
    if (E.spd.textContent !== s) E.spd.textContent = s;
    const d = 'sérülés ' + Math.round(car.damage() * 100) + '%';
    if (E.dmg.textContent !== d) E.dmg.textContent = d;
    let sf = '—';
    for (const w of car.wheels) if (w.contact) { sf = w.hy < Game.world.water ? 'víz' : SURF_NAME[w.surf]; break; }
    if (!car.contacts) sf = car.inWater > 0.1 ? 'víz' : (car.u[1] < 0.4 && car.speed < 2 ? 'felborult · R' : 'levegő');
    if (E.surf.textContent !== sf) E.surf.textContent = sf;
    if (car.spec.rocket) {
      const p = car.tank / car.spec.tank;
      E.tank.style.width = (p * 100).toFixed(1) + '%';
      E.tank.classList.toggle('low', p < 0.2);
      const tv = Math.round(car.tank) + ' l';
      if (E.tankv.textContent !== tv) E.tankv.textContent = tv;
      E.suck.classList.toggle('on', car.suctionOn);
      E.suck.textContent = car.suctionOn ? 'SZÍVÁS BE' : 'SZÍVÁS KI';
    }
  }
};

// mobilon ne nagyítson bele a dupla koppintás vagy a csípés
(function () {
  let last = 0;
  document.addEventListener('touchend', e => {
    const now = Date.now();
    if (now - last < 350 && !(e.target && e.target.tagName === 'INPUT')) e.preventDefault();
    last = now;
  }, { passive: false });
  document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, e => e.preventDefault(), { passive: false });
  document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
})();
addEventListener('load', () => {
  try { Game.init(); }
  catch (e) { console.error(e); document.body.insertAdjacentHTML('beforeend', '<pre style="position:fixed;inset:20px;color:#ff5555;z-index:99;font:14px monospace;white-space:pre-wrap">Hiba: ' + e.message + '\n' + (e.stack || '') + '</pre>'); }
});
