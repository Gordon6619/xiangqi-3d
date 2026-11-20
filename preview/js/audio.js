// 程序化音效引擎 — all sounds are synthesized in real time with WebAudio (no external files).
// Every piece type has its own movement voice; captures have layered impact + debris + type-specific accents.

export class SFX {
  constructor() {
    this.ctx = null; this.master = null; this.enabled = true; this.volume = 0.8;
    this.musicOn = false; this._musicTimer = null;
  }
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.attach(new AC({ latencyHint: 'interactive' }));
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  /** Build the mixing graph on a context (a live AudioContext, or an OfflineAudioContext for tests). */
  attach(ctx) {
    {
      this.ctx = ctx;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      // gentle room reverb
      this.comp = this.ctx.createDynamicsCompressor();
      this.comp.threshold.value = -14; this.comp.ratio.value = 4;
      this.reverb = this.ctx.createConvolver();
      this.reverb.buffer = this._impulse(1.8, 2.5);
      this.revGain = this.ctx.createGain(); this.revGain.gain.value = 0.22;
      this.master.connect(this.comp);
      this.master.connect(this.reverb); this.reverb.connect(this.revGain); this.revGain.connect(this.comp);
      this.comp.connect(this.ctx.destination);
      this.dry = this.ctx.createGain(); this.dry.gain.value = this.volume; this.dry.connect(this.comp); // no reverb send
      this._noise = this._noiseBuf(2);
      this._last = {};
    }
    return this.ctx;
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; if (this.dry) this.dry.gain.value = v; }

  _impulse(sec, decay) {
    const c = this.ctx, len = c.sampleRate * sec, buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
  _noiseBuf(sec) {
    const c = this.ctx, buf = c.createBuffer(1, c.sampleRate * sec, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  get now() { return this.ctx.currentTime; }

  // ---------- primitives ----------
  env(g, t, a, peak, d, sustain = 0.0001) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), t + a + d);
  }
  tone({ t = 0, type = 'sine', f = 440, f2 = null, dur = 0.3, a = 0.005, vol = 0.5, pan = 0, detune = 0, vib = 0, vibRate = 6, dest = null }) {
    const c = this.ctx, T = this.now + t;
    const o = c.createOscillator(), g = c.createGain(), p = c.createStereoPanner ? c.createStereoPanner() : null;
    o.type = type; o.frequency.setValueAtTime(f, T); o.detune.value = detune;
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, T + dur);
    if (vib) {
      const l = c.createOscillator(), lg = c.createGain();
      l.frequency.value = vibRate; lg.gain.value = vib; l.connect(lg); lg.connect(o.frequency);
      l.start(T); l.stop(T + dur + 0.1);
    }
    this.env(g, T, a, vol, dur);
    o.connect(g);
    if (p) { p.pan.value = pan; g.connect(p); p.connect(dest || this.master); } else g.connect(dest || this.master);
    o.start(T); o.stop(T + a + dur + 0.05);
    return o;
  }
  noise({ t = 0, dur = 0.2, a = 0.003, vol = 0.4, type = 'bandpass', f = 1000, f2 = null, q = 1, pan = 0, rate = 1, dest = null }) {
    const c = this.ctx, T = this.now + t;
    const s = c.createBufferSource(); s.buffer = this._noise; s.playbackRate.value = rate;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, T); fl.Q.value = q;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, T + dur);
    const g = c.createGain(); this.env(g, T, a, vol, dur);
    s.connect(fl); fl.connect(g);
    if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(dest || this.master); }
    else g.connect(dest || this.master);
    s.start(T, Math.random() * 1.5); s.stop(T + a + dur + 0.05);
  }
  metal({ t = 0, f = 900, vol = 0.25, dur = 0.6 }) {
    // inharmonic partials = metallic ring
    [1, 2.76, 5.4, 8.93].forEach((k, i) => this.tone({ t, type: 'sine', f: f * k, dur: dur / (1 + i * 0.6), vol: vol / (1 + i), a: 0.001 }));
    this.noise({ t, dur: 0.05, vol: vol * 0.8, type: 'highpass', f: 4000 });
  }
  thud({ t = 0, f = 90, vol = 0.6, dur = 0.25 }) {
    this.tone({ t, type: 'sine', f: f * 1.8, f2: f * 0.6, dur, vol, a: 0.002 });
    this.noise({ t, dur: dur * 0.5, vol: vol * 0.5, type: 'lowpass', f: 600, f2: 120 });
  }
  wood({ t = 0, f = 1200, vol = 0.4 }) {
    this.tone({ t, type: 'triangle', f, f2: f * 0.7, dur: 0.07, vol, a: 0.001 });
    this.tone({ t, type: 'sine', f: f * 2.3, dur: 0.04, vol: vol * 0.4, a: 0.001 });
    this.noise({ t, dur: 0.03, vol: vol * 0.5, type: 'bandpass', f: f * 2, q: 4 });
  }
  step({ t = 0, vol = 0.3, armor = false, pitch = 1 }) {
    this.noise({ t, dur: 0.09, vol, type: 'lowpass', f: 900 * pitch, f2: 200 });
    this.tone({ t, type: 'sine', f: 120 * pitch, f2: 60, dur: 0.08, vol: vol * 0.6 });
    if (armor) this.metal({ t: t + 0.01, f: 1800 + Math.random() * 400, vol: vol * 0.25, dur: 0.18 });
  }

  // ================= 改版音效：綁在動畫事件上的短音 (event-bound cues) =================
  // Each cue has 3 variants; the same variant never plays twice in a row.
  // `perfTarget` is the performance.now() moment the matching picture appears; output latency is subtracted
  // so the sound reaches the speaker on that frame.
  offsetFor(perfTarget) {
    const c = this.ctx;
    if (perfTarget == null || typeof perfTarget !== 'number') return 0;
    if (c.getOutputTimestamp) {
      const ts = c.getOutputTimestamp();
      if (ts && ts.performanceTime > 0) return Math.max(0, ts.contextTime + (perfTarget - ts.performanceTime) / 1000 - c.currentTime);
    }
    const lat = (c.outputLatency || 0) + (c.baseLatency || 0);
    return Math.max(0, (perfTarget - performance.now()) / 1000 - lat);
  }
  pick(name, n = 3) {
    const last = this._last[name];
    let i; do { i = Math.floor(Math.random() * n); } while (n > 1 && i === last);
    this._last[name] = i;
    return i;
  }
  /** Play an event cue. `at` = performance.now() target (live) or seconds offset when `rawT` is set (offline tests). */
  cue(name, at = null, { rawT = false, variant = null } = {}) {
    if (!this.ctx && !this.ensure()) return;
    if (!this.enabled) return;
    const t = rawT ? at : this.offsetFor(at);
    const v = variant ?? this.pick(name);
    const fn = this['cue_' + name];
    if (fn) fn.call(this, t, v);
    return { t, v };
  }
  // 炮身壓低：短機括 — a latch click + short ratchet, bright enough for phone speakers
  cue_mech(t, v) {
    const P = [{ f: 2400, r: 3, c: 320 }, { f: 2100, r: 2, c: 290 }, { f: 2750, r: 3, c: 350 }][v];
    this.noise({ t, dur: 0.012, a: 0.001, vol: 1.0, type: 'bandpass', f: P.f, q: 6, dest: this.dry });
    this.tone({ t: t + 0.004, type: 'triangle', f: P.c * 1.6, f2: P.c, dur: 0.05, vol: 0.4, a: 0.001, dest: this.dry });
    for (let j = 0; j < P.r; j++) this.noise({ t: t + 0.022 + j * 0.021, dur: 0.008, a: 0.001, vol: 0.42, type: 'bandpass', f: P.f * 0.8, q: 8, dest: this.dry });
  }
  // 命中：厚實的撞擊 — sub body + 400–500 Hz knock (what a phone speaker reproduces) + 2 kHz crack
  cue_impact(t, v) {
    const P = [{ b: 150, m: 470, c: 2200 }, { b: 135, m: 430, c: 1900 }, { b: 165, m: 520, c: 2500 }][v];
    this.tone({ t, type: 'sine', f: P.b * 1.5, f2: P.b * 0.5, dur: 0.24, vol: 0.9, a: 0.001 });
    this.tone({ t, type: 'triangle', f: P.m, f2: P.m * 0.6, dur: 0.1, vol: 0.5, a: 0.001 });
    this.noise({ t, dur: 0.05, a: 0.001, vol: 0.65, type: 'bandpass', f: P.c, q: 1.2 });
    this.noise({ t, dur: 0.2, a: 0.002, vol: 0.45, type: 'lowpass', f: 1100, f2: 180 });
    this.wood({ t: t + 0.09, f: 1100 + v * 120, vol: 0.12 });
  }
  // 占格：較輕的木質落盤
  cue_place(t, v) {
    const f = [880, 780, 960][v];
    this.tone({ t, type: 'triangle', f, f2: f * 0.74, dur: 0.06, vol: 0.34, a: 0.001, dest: this.dry });
    this.tone({ t, type: 'sine', f: f * 2.4, dur: 0.03, vol: 0.12, a: 0.001, dest: this.dry });
    this.noise({ t, dur: 0.02, a: 0.001, vol: 0.22, type: 'bandpass', f: f * 2.2, q: 4, dest: this.dry });
  }
  // 普通步：一聲乾淨的腳步 — dry, short, duller than the wooden placement
  cue_step(t, v) {
    const P = [{ f: 1100, p: 120 }, { f: 950, p: 105 }, { f: 1250, p: 135 }][v];
    this.noise({ t, dur: 0.055, a: 0.002, vol: 0.8, type: 'lowpass', f: P.f, f2: P.f * 0.4, dest: this.dry });
    this.noise({ t, dur: 0.03, a: 0.001, vol: 0.32, type: 'bandpass', f: P.f * 1.5, q: 1.4, dest: this.dry }); // scuff: carries on phone speakers
    this.tone({ t, type: 'sine', f: P.p, f2: P.p * 0.6, dur: 0.05, vol: 0.5, a: 0.002, dest: this.dry });
    this.noise({ t: t + 0.004, dur: 0.012, a: 0.001, vol: 0.15, type: 'highpass', f: 2500, dest: this.dry });
  }
  // 將軍：一記短鼓
  cue_drum(t, v) {
    const f = [150, 138, 162][v];
    this.tone({ t, type: 'sine', f: f * 1.6, f2: f, dur: 0.2, vol: 0.62, a: 0.001 });
    this.tone({ t, type: 'triangle', f: f * 2.2, f2: f * 1.5, dur: 0.05, vol: 0.18, a: 0.001 });
    this.noise({ t, dur: 0.06, a: 0.001, vol: 0.3, type: 'bandpass', f: 380, q: 1 });
  }
  // 馬蹄（前後蹄兩拍各一聲）
  cue_hoof(t, v) {
    const f = [520, 470, 565][v];
    this.wood({ t, f, vol: 0.3 });
    this.noise({ t, dur: 0.04, a: 0.001, vol: 0.12, type: 'lowpass', f: 700, dest: this.dry });
  }
  // 車輪滾動 + 煞停
  cue_roll(t, v) {
    const d = [0.22, 0.26, 0.2][v];
    this.noise({ t, dur: d, a: 0.03, vol: 0.28, type: 'lowpass', f: 260, q: 3 });
    for (let i = 0; i < 4; i++) this.wood({ t: t + i * d / 4, f: 320 + v * 30 + i * 15, vol: 0.06 });
  }
  cue_brake(t, v) { this.noise({ t, dur: 0.14, a: 0.005, vol: 0.13, type: 'bandpass', f: [1400, 1250, 1550][v], f2: 600, q: 2 }); }
  cue_stomp(t, v) { this.thud({ t, f: [60, 55, 66][v], vol: 0.45, dur: 0.3 }); }

  // ---------- UI ----------
  select() { if (!this.ensure() || !this.enabled) return; this.wood({ f: 1500, vol: 0.35 }); }
  deny() { if (!this.ensure() || !this.enabled) return; this.tone({ type: 'square', f: 180, f2: 120, dur: 0.15, vol: 0.08 }); }
  place() { if (!this.ensure() || !this.enabled) return; this.wood({ f: 700, vol: 0.55 }); this.thud({ f: 110, vol: 0.25, dur: 0.12 }); }

  // ---------- per-piece movement voices ----------
  // duration (s) is how long the piece travels so the sound matches the animation
  move(type, dur = 0.8, theme = 'warrior') {
    if (!this.ensure() || !this.enabled) return;
    const fn = {
      K: () => this.moveGeneral(dur), A: () => this.moveAdvisor(dur), B: () => this.moveElephant(dur),
      N: () => this.moveHorse(dur), R: () => this.moveChariot(dur), C: () => this.moveCannon(dur), P: () => this.moveSoldier(dur),
    }[type];
    fn && fn();
  }
  // 帥/將: heavy armored stride + war drum + armor clank
  moveGeneral(dur) {
    this.tone({ type: 'sine', f: 70, f2: 45, dur: 0.5, vol: 0.55 });
    this.noise({ dur: 0.35, vol: 0.25, type: 'lowpass', f: 300 });
    const n = Math.max(2, Math.round(dur / 0.32));
    for (let i = 0; i < n; i++) this.step({ t: 0.12 + i * dur / n, vol: 0.45, armor: true, pitch: 0.8 });
    this.metal({ t: dur * 0.5, f: 620, vol: 0.12, dur: 0.9 });
  }
  // 仕/士: silk robe swish + light steps + jade pendant tinkle
  moveAdvisor(dur) {
    this.noise({ dur: dur * 0.8, a: 0.15, vol: 0.12, type: 'bandpass', f: 2500, f2: 5000, q: 0.7 });
    const n = Math.max(2, Math.round(dur / 0.25));
    for (let i = 0; i < n; i++) this.step({ t: i * dur / n, vol: 0.18, pitch: 1.4 });
    [2093, 2637, 3136].forEach((f, i) => this.tone({ t: 0.1 + i * 0.09, f, dur: 0.5, vol: 0.06 }));
  }
  // 相/象: elephant trumpet + ground-shaking stomps
  moveElephant(dur) {
    this.tone({ type: 'sawtooth', f: 330, f2: 520, dur: 0.55, vol: 0.11, a: 0.06, vib: 18, vibRate: 9 });
    this.tone({ type: 'square', f: 335, f2: 500, dur: 0.5, vol: 0.05, a: 0.08, vib: 14, vibRate: 11 });
    this.noise({ dur: 0.5, a: 0.05, vol: 0.06, type: 'bandpass', f: 1500, q: 2 });
    const n = Math.max(2, Math.round(dur / 0.38));
    for (let i = 0; i < n; i++) this.thud({ t: 0.25 + i * dur / n, f: 55, vol: 0.55, dur: 0.35 });
  }
  // 傌/馬: four-beat gallop + whinny
  moveHorse(dur) {
    const beats = Math.max(2, Math.round(dur / 0.28));
    for (let b = 0; b < beats; b++) {
      const t0 = b * dur / beats;
      [0, 0.05, 0.12, 0.16].forEach((o, k) => this.wood({ t: t0 + o, f: 520 + k * 60 + Math.random() * 40, vol: 0.28 }));
    }
    // whinny: FM-ish downward vibrato
    this.tone({ t: 0.02, type: 'sawtooth', f: 900, f2: 600, dur: 0.55, vol: 0.06, a: 0.04, vib: 70, vibRate: 15 });
    this.tone({ t: 0.02, type: 'triangle', f: 1350, f2: 800, dur: 0.5, vol: 0.04, a: 0.04, vib: 90, vibRate: 15 });
  }
  // 俥/車: rumbling wheels + rattling frame
  moveChariot(dur) {
    this.noise({ dur, a: 0.08, vol: 0.4, type: 'lowpass', f: 220, f2: 140, q: 3 });
    this.noise({ dur, a: 0.1, vol: 0.12, type: 'bandpass', f: 800, q: 6, rate: 0.5 });
    const n = Math.round(dur / 0.07);
    for (let i = 0; i < n; i++) this.wood({ t: i * 0.07 + Math.random() * 0.02, f: 300 + Math.random() * 200, vol: 0.08 });
    this.tone({ type: 'sawtooth', f: 48, dur, vol: 0.06, a: 0.1, vib: 4, vibRate: 13 });
  }
  // 炮/砲: wooden wheel creak + heavy bronze barrel
  moveCannon(dur) {
    this.tone({ type: 'sawtooth', f: 260, f2: 190, dur: dur * 0.6, vol: 0.05, a: 0.05, vib: 25, vibRate: 7 });
    this.noise({ dur, a: 0.1, vol: 0.3, type: 'lowpass', f: 300 });
    this.metal({ t: dur * 0.9, f: 260, vol: 0.18, dur: 1.1 });
    this.thud({ t: dur * 0.95, f: 70, vol: 0.4 });
  }
  // 兵/卒: marching boots + spear tap + short drum roll
  moveSoldier(dur) {
    const n = Math.max(3, Math.round(dur / 0.18));
    for (let i = 0; i < n; i++) this.step({ t: i * dur / n, vol: 0.28, pitch: 1.15, armor: i % 2 === 0 });
    this.tone({ t: 0.0, type: 'triangle', f: 200, f2: 150, dur: 0.1, vol: 0.2 });
    this.tone({ t: 0.08, type: 'triangle', f: 200, f2: 150, dur: 0.1, vol: 0.2 });
    this.wood({ t: dur, f: 900, vol: 0.3 });
  }

  // ---------- quiet ambient sounds for idle behaviours ----------
  idle(kind) {
    if (!this.ensure() || !this.enabled) return;
    const q = 0.45, pan = (Math.random() - 0.5) * 0.8;
    switch (kind) {
      case 'clink': this.metal({ f: 1500 + Math.random() * 400, vol: 0.08 * q * 2, dur: 0.7 }); break;
      case 'thud': this.thud({ f: 90, vol: 0.3 * q }); this.metal({ t: 0.01, f: 900, vol: 0.05, dur: 0.3 }); break;
      case 'whoosh': this.noise({ dur: 0.18, a: 0.08, vol: 0.12 * q, type: 'bandpass', f: 700, f2: 2400, q: 2, pan }); break;
      case 'tap': this.wood({ f: 500, vol: 0.18 * q }); break;
      case 'creak': this.tone({ type: 'sawtooth', f: 240, f2: 180, dur: 0.35, vol: 0.03, a: 0.05, vib: 30, vibRate: 9 }); break;
      case 'hoof': this.wood({ f: 480, vol: 0.25 * q }); this.noise({ dur: 0.08, vol: 0.06, type: 'lowpass', f: 700 }); break;
      case 'neigh': this.tone({ type: 'sawtooth', f: 950, f2: 550, dur: 0.6, vol: 0.035, a: 0.05, vib: 80, vibRate: 15 }); this.tone({ type: 'triangle', f: 1400, f2: 800, dur: 0.5, vol: 0.02, a: 0.05, vib: 90, vibRate: 15 }); break;
      case 'snort': this.noise({ dur: 0.25, a: 0.02, vol: 0.12 * q, type: 'bandpass', f: 500, f2: 250, q: 1.5, pan }); this.noise({ t: 0.12, dur: 0.2, vol: 0.08 * q, type: 'bandpass', f: 600, q: 2, pan }); break;
      case 'trumpet': this.tone({ type: 'sawtooth', f: 360, f2: 560, dur: 0.7, vol: 0.06, a: 0.08, vib: 20, vibRate: 9 }); this.tone({ type: 'square', f: 365, f2: 540, dur: 0.6, vol: 0.025, a: 0.1, vib: 16, vibRate: 11 }); break;
      case 'stomp': this.thud({ f: 50, vol: 0.4 * q, dur: 0.4 }); break;
    }
  }

  // ---------- capture (tension + impact) ----------
  windup(type) {
    if (!this.ensure() || !this.enabled) return;
    // rising tension swell
    this.noise({ dur: 0.45, a: 0.4, vol: 0.18, type: 'bandpass', f: 300, f2: 3000, q: 1.5 });
    this.tone({ type: 'sawtooth', f: 80, f2: 160, dur: 0.45, a: 0.4, vol: 0.06 });
    if (type === 'B') this.tone({ type: 'sawtooth', f: 400, f2: 700, dur: 0.7, a: 0.08, vol: 0.12, vib: 25, vibRate: 10 }); // angry trumpet
    if (type === 'N') this.tone({ type: 'sawtooth', f: 1100, f2: 700, dur: 0.7, vol: 0.07, a: 0.03, vib: 110, vibRate: 17 }); // rearing neigh
    if (type === 'K' || type === 'P' || type === 'A') this.metal({ t: 0.1, f: 1400, vol: 0.12, dur: 0.5 }); // blade drawn
    if (type === 'C') { this.noise({ dur: 0.6, vol: 0.12, type: 'highpass', f: 5000 }); } // fuse sizzle
  }
  impact(attType, victimType) {
    if (!this.ensure() || !this.enabled) return;
    // whoosh
    this.noise({ dur: 0.18, a: 0.12, vol: 0.3, type: 'bandpass', f: 600, f2: 2500, q: 2 });
    const t = 0.12;
    if (attType === 'C') {               // 炮 — cannon shot explosion
      this.thud({ t: 0, f: 60, vol: 0.9, dur: 0.6 });
      this.noise({ t: 0, dur: 0.25, vol: 0.6, type: 'lowpass', f: 3000, f2: 200 });
      this.noise({ t: t + 0.25, dur: 1.4, vol: 0.7, type: 'lowpass', f: 1800, f2: 60 });
      this.thud({ t: t + 0.25, f: 40, vol: 1.0, dur: 1.0 });
    } else {
      this.thud({ t, f: 70, vol: 0.9, dur: 0.45 });
      this.noise({ t, dur: 0.35, vol: 0.55, type: 'lowpass', f: 2500, f2: 150 });
      if (attType === 'K' || attType === 'P' || attType === 'A' || attType === 'R') this.metal({ t, f: 700 + Math.random() * 300, vol: 0.35, dur: 1.0 });
      if (attType === 'B') this.thud({ t: t + 0.12, f: 45, vol: 0.9, dur: 0.6 });
      if (attType === 'N') [0, 0.06].forEach(o => this.wood({ t: t + o, f: 450, vol: 0.5 }));
    }
    // victim cry
    if (victimType === 'N') this.tone({ t: t + 0.05, type: 'sawtooth', f: 1000, f2: 400, dur: 0.6, vol: 0.06, vib: 80, vibRate: 18 });
    else if (victimType === 'B') this.tone({ t: t + 0.05, type: 'sawtooth', f: 500, f2: 200, dur: 0.8, vol: 0.09, vib: 20, vibRate: 9 });
    else this.tone({ t: t + 0.05, type: 'triangle', f: 330, f2: 120, dur: 0.35, vol: 0.12 });
    // debris / disc bouncing on wood
    for (let i = 0; i < 6; i++) this.wood({ t: t + 0.35 + i * (0.16 - i * 0.018), f: 900 + Math.random() * 600, vol: 0.25 / (1 + i * 0.5) });
    // dramatic low drum hit
    this.tone({ t: t + 0.02, type: 'sine', f: 55, f2: 40, dur: 1.2, vol: 0.5 });
  }
  check() {
    if (!this.ensure() || !this.enabled) return;
    // 將軍 — gong crash
    [1, 1.48, 2.11, 2.9, 3.7].forEach((k, i) => this.tone({ type: 'sine', f: 150 * k, dur: 2.2 / (1 + i * 0.3), vol: 0.22 / (1 + i * 0.4), a: 0.003, vib: 2 + i, vibRate: 3 }));
    this.noise({ dur: 1.5, vol: 0.18, type: 'bandpass', f: 1800, q: 0.8 });
  }
  win() {
    if (!this.ensure() || !this.enabled) return;
    const notes = [392, 440, 523, 587, 659, 784, 880, 1047];
    notes.forEach((f, i) => { this.pluck(f, i * 0.12, 0.35); });
    [523, 659, 784].forEach(f => this.tone({ t: 1.0, type: 'triangle', f, dur: 1.5, vol: 0.1, a: 0.02 }));
    this.check();
  }
  lose() {
    if (!this.ensure() || !this.enabled) return;
    [392, 349, 311, 262].forEach((f, i) => this.pluck(f, i * 0.28, 0.35));
  }
  pluck(f, t = 0, vol = 0.25) { // guzheng-like pluck
    this.tone({ t, type: 'triangle', f, dur: 1.2, vol, a: 0.002, vib: 3, vibRate: 5 });
    this.tone({ t, type: 'sine', f: f * 2, dur: 0.6, vol: vol * 0.4, a: 0.002 });
    this.noise({ t, dur: 0.02, vol: vol * 0.4, type: 'highpass', f: 3000 });
  }
  // ambient pentatonic guzheng music
  setMusic(on) {
    this.musicOn = on;
    clearTimeout(this._musicTimer);
    if (!on || !this.ensure()) return;
    const scale = [293.66, 329.63, 369.99, 440, 493.88, 587.33, 659.25, 739.99, 880];
    let prev = 4;
    const tick = () => {
      if (!this.musicOn) return;
      prev = Math.max(0, Math.min(scale.length - 1, prev + Math.round((Math.random() - 0.5) * 4)));
      this.pluck(scale[prev], 0, 0.07);
      if (Math.random() < 0.3) this.pluck(scale[Math.max(0, prev - 3)] / 2, 0.02, 0.05);
      this._musicTimer = setTimeout(tick, 350 + Math.random() * 900);
    };
    tick();
  }
}
