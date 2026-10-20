'use strict';
// ============================================================
//  HUNYÓ – online szoba: játékmód, kör hossza, lobbi, "kész" jelzés
//  A házigazda dönt mindenről, és 'g' üzenetben szétküldi (benne a futó játék állapotával).
//  Szabad játékban nincs lobbi. Fogócskában és bújócskában a kör akkor indul,
//  ha mindenki kész (min. 2 fő); a kör végén mindenki visszakerül a lobbiba.
//  Kör közben belépő játékos a lobbiban vár: nem vesz részt, nézőként követ valakit.
// ============================================================
const ROOM_LENS = { tag: [120, 180, 300], hide: [180, 240, 360] };
const ROOM_DEF = { tag: 180, hide: 240 };
const ROOM_MODES = ['free', 'tag', 'hide'];
const ROOM_MODE_NAME = { free: 'Szabad játék', tag: 'Fogócska', hide: 'Bújócska' };

const Room = {
  mode: 'free', len: 180,
  phase: 'off',        // off (szabad játék) | lobby | game
  ready: new Set(), part: [], syncT: 0,

  game() { return this.mode === 'tag' ? Tag : this.mode === 'hide' ? Hide : null; },
  lens() { return ROOM_LENS[this.mode] || []; },
  inGame(id) { return this.phase === 'game' && this.part.includes(id); },
  // néző: kör közben belépett, a kör végéig vár
  spectator(id) { return Net.active && this.phase === 'game' && !this.part.includes(id); },
  amSpectator() { return this.spectator(Net.myId); },

  // ---- házigazda
  hostSetup(mode, len) {
    const G = this.game(); if (G) G.stop();
    this.mode = ROOM_MODES.includes(mode) ? mode : 'free';
    const L = ROOM_LENS[this.mode];
    this.len = L ? (L.includes(len) ? len : ROOM_DEF[this.mode]) : 180;
    this.phase = this.mode === 'free' ? 'off' : 'lobby';
    this.ready.clear(); this.part = [];
    this.broadcast();
  },
  setReady(id, v) {
    if (!Net.host || this.phase !== 'lobby' || !Net.players.has(id)) return;
    if (v) this.ready.add(id); else this.ready.delete(id);
    this.broadcast();
  },
  hostTick(dt) {
    if (!Net.host) return;
    if (this.phase === 'lobby') {
      for (const id of [...this.ready]) if (!Net.players.has(id)) this.ready.delete(id);
      const n = Net.players.size;
      if (n >= 2 && this.ready.size === n) this.startRound();
    } else if (this.phase === 'game') {
      this.syncT -= dt;
      if (this.syncT <= 0) { this.syncT = 1; this.broadcast(); }
    }
  },
  startRound() {
    this.part = [...Net.players.keys()].sort((a, b) => a - b);
    this.ready.clear();
    this.phase = 'game';
    this.game().start(this.part);
    this.broadcast();
  },
  toLobby() {
    const G = this.game(); if (G) G.stop();
    this.phase = this.mode === 'free' ? 'off' : 'lobby';
    this.ready.clear(); this.part = [];
    this.broadcast();
  },
  onJoin(id) { this.broadcast(); },
  onLeave(id) {
    this.ready.delete(id);
    if (this.phase === 'game' && this.part.includes(id)) {
      const G = this.game();
      if (G) G.onLeave(id);
      this.part = this.part.filter(i => i !== id);
      if (this.phase === 'game' && this.part.filter(i => Net.players.has(i)).length < 2) {
        UI.toast(0, 'Túl kevesen maradtatok · vissza a lobbiba');
        this.toLobby();
        return;
      }
    }
    this.broadcast();
  },
  snapshot() {
    return { t: 'g', m: this.mode, l: this.len, ph: this.phase, rd: [...this.ready], pt: this.part,
      tg: this.mode === 'tag' ? Tag.snapshot() : undefined, hd: this.mode === 'hide' ? Hide.snapshot() : undefined };
  },
  broadcast() { if (Net.active && Net.host) { Net._broadcast(this.snapshot()); if (typeof UI !== 'undefined' && UI.netList) UI.netList(); } },

  // ---- kliens
  apply(d) {
    const oldMode = this.mode, oldPh = this.phase;
    if (oldMode !== d.m) { const G = this.game(); if (G) G.stop(); }
    this.mode = d.m; this.len = d.l; this.phase = d.ph;
    this.ready = new Set(d.rd || []); this.part = d.pt || [];
    if (d.tg) Tag.apply(d.tg); else if (this.mode !== 'tag' || this.phase !== 'game') Tag.stop();
    if (d.hd) Hide.apply(d.hd); else if (this.mode !== 'hide' || this.phase !== 'game') Hide.stop();
    if (oldPh === 'game' && this.phase !== 'game') this.onBackToLobby();
  },
  // saját "kész" kapcsoló
  toggleReady() {
    if (!Net.active || this.phase !== 'lobby') return;
    const v = !this.ready.has(Net.myId);
    Sound.blip(v ? 990 : 440, 0.06);
    if (Net.host) this.setReady(Net.myId, v);
    else { if (v) this.ready.add(Net.myId); else this.ready.delete(Net.myId); Net.sendHost({ t: 'rdy', v: v ? 1 : 0 }); }
  },
  onBackToLobby() { if (typeof Hide !== 'undefined') Hide.restoreLocal(); },
  reset() { this.mode = 'free'; this.len = 180; this.phase = 'off'; this.ready.clear(); this.part = []; Tag.reset(); Hide.reset(); },

  update(dt) {
    if (!Net.active) { UI.lobby(null); return; }
    const wasGame = this._ph === 'game';
    this.hostTick(dt);
    if (Net.host && wasGame && this.phase !== 'game') this.onBackToLobby();
    this._ph = this.phase;
    UI.lobby(this);
  }
};
