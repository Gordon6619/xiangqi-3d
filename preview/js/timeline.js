// 時間軸引擎 — wall-clock choreography with animation events.
// Tracks are positioned by real milliseconds (not frame deltas), so a 600 ms move takes 600 ms even when
// frames drop, and the sound scheduled for an event lands on the same moment as its picture.

/** Shared clock. In manual mode (frame-by-frame capture / tests) time only moves when stepped. */
export const Clock = {
  manual: false, t: 0,
  now() { return this.manual ? this.t : performance.now(); },
  setManual(on) { if (on && !this.manual) this.t = performance.now(); this.manual = on; },
};

export const curves = {
  linear: k => k,
  inOut: k => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2),
  out: k => 1 - Math.pow(1 - k, 3),
  in: k => k * k,
  outBack: k => { const c = 1.7; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); },
};

/**
 * A running sequence.
 *   tracks: [{ at, dur, fn(k, rawK), ease }]   — fn is called every frame while active and once with k=1 at the end
 *   events: [{ at, fn(info), lead }]            — fn fires once; `lead` ms early when it must schedule audio ahead
 *   dur:    total length in ms (promise resolves after it)
 */
export class Timeline {
  constructor() { this.running = []; this.log = []; }
  play({ tracks = [], events = [], dur, name = 'seq' }) {
    const start = Clock.now();
    const total = dur ?? Math.max(0, ...tracks.map(t => t.at + t.dur), ...events.map(e => e.at));
    return new Promise(resolve => {
      const seq = { name, start, total, resolve, tracks: tracks.map(t => ({ ...t, done: false })), events: events.map(e => ({ ...e, fired: false })), avMarks: [] };
      this.running.push(seq);
      this.update();
    });
  }
  /** Cancel everything (e.g. new game, undo). Tracks jump to their end state. */
  finishAll() {
    for (const s of this.running) {
      s.tracks.forEach(t => { if (!t.done) { t.fn(1, 1); t.done = true; } });
      s.events.forEach(e => { if (!e.fired) { e.fired = true; e.fn({ late: 0, start: s.start, skipped: true }); } });
      s.resolve();
    }
    this.running = [];
  }
  update() {
    const now = Clock.now();
    for (let i = this.running.length - 1; i >= 0; i--) {
      const s = this.running[i], t = now - s.start;
      for (const tr of s.tracks) {
        if (tr.done || t < tr.at) continue;
        const raw = Math.min(1, (t - tr.at) / Math.max(1, tr.dur));
        tr.fn((tr.ease || curves.linear)(raw), raw);
        if (raw >= 1) tr.done = true;
      }
      for (const ev of s.events) {
        if (ev.fired || t < ev.at - (ev.lead || 0)) continue;
        ev.fired = true;
        ev.fn({ late: t - ev.at, start: s.start, target: s.start + ev.at });
        if (ev.av) s.avMarks.push({ name: ev.av, target: s.start + ev.at, frame: null });
      }
      // The move counts as finished at `total`; trailing settle motion (armour, carriage) keeps playing in the background.
      if (!s.resolved && t >= s.total && s.events.every(e => e.fired || e.at > s.total)) {
        s.resolved = true;
        this.log.unshift({ name: s.name, planned: s.total, actual: now - s.start, av: s.avMarks });
        this.log.length = Math.min(this.log.length, 10);
        s.resolve();
      }
      if (s.resolved && s.tracks.every(tr => tr.done) && s.events.every(e => e.fired)) this.running.splice(i, 1);
    }
  }
  /** Called right after a frame is drawn: the first frame drawn at/after an AV event's moment is its "contact frame". */
  markFrame(perfNow) {
    const all = this.running.flatMap(s => s.avMarks).concat(this.log.flatMap(l => l.av));
    for (const m of all) if (m.frame == null && perfNow >= m.target) m.frame = perfNow;
  }
}
