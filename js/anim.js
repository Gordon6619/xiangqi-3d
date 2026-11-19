// 擬真動作系統 — procedural pose animation for rigs, tweens, particles and cinematic capture choreography.
import * as THREE from 'three';

export const ease = {
  linear: t => t,
  inOut: t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  out: t => 1 - Math.pow(1 - t, 3),
  in: t => t * t * t,
  back: t => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
};

/* ------------------------------ tweens ------------------------------ */
export class Tweener {
  constructor() { this.list = []; this.timeScale = 1; }
  add(dur, fn, e = ease.inOut) {
    return new Promise(res => this.list.push({ t: 0, dur: Math.max(dur, 0.0001), fn, e, res }));
  }
  wait(dur) { return this.add(dur, () => {}); }
  update(dt) {
    dt *= this.timeScale;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const tw = this.list[i];
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.fn(tw.e(k), k);
      if (k >= 1) { this.list.splice(i, 1); tw.res(); }
    }
  }
}

/* ------------------------------ rig posing ------------------------------ */
// state: { mode: idle|walk|gallop|windup|strike|cheer|hit|guard, walk: phase, act: 0..1 }
// While idle every figure runs its own role-specific behaviour scheduler (擬真待機動作).
let idleHook = () => {};
/** main.js registers a hook for idle side-effects: (kind, object3D, rig) kind = dust|smoke|sound:<name> */
export function setIdleHook(fn) { idleHook = fn; }

const TAU = Math.PI * 2;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hold = (p, i = 0.18, o = 0.82) => smooth(0, i, p) * (1 - smooth(o, 1, p)); // ease in, hold, ease out
const rnd = (a, b) => a + Math.random() * (b - a);

function scheduler(rig, time, list) {
  const s = rig.idle ??= { cur: null, start: 0, dur: 0, next: time + rnd(0.5, 3.5), fired: {} };
  if (s.cur && time - s.start >= s.dur) { s.cur = null; s.next = time + rnd(1.2, 4.5); }
  if (!s.cur && time >= s.next && list.length) {
    let pick; do { pick = list[Math.floor(Math.random() * list.length)]; } while (list.length > 1 && pick[0] === s.last);
    s.cur = pick[0]; s.last = pick[0]; s.start = time; s.dur = pick[1] * rnd(0.85, 1.2); s.fired = {};
  }
  if (!s.cur) return null;
  const p = (time - s.start) / s.dur;
  return { name: s.cur, p, env: hold(p), once: k => (s.fired[k] ? false : (s.fired[k] = true)) };
}
function resetIdle(rig) { if (rig.idle) { rig.idle.cur = null; rig.idle.next = 0; } }

function blink(rig, time) {
  if (!rig.eyes) return;
  rig.nextBlink ??= time + rnd(1, 4);
  let sy = 1;
  if (time > rig.nextBlink) { const k = (time - rig.nextBlink) / 0.14; if (k >= 1) rig.nextBlink = time + rnd(1.5, 5); else sy = Math.max(0.08, Math.abs(1 - 2 * k)); }
  rig.eyes.forEach(e => { e.scale.y = sy; });
}

export function poseRig(rig, st, time) {
  if (!rig) return;
  rig.seed ??= Math.random() * 10;
  if (st.mode !== 'idle') resetIdle(rig);
  const br = Math.sin(time * 2.2 + rig.seed);
  blink(rig, time);
  switch (rig.kind) {
    case 'biped': poseBiped(rig, st, br, time); break;
    case 'quad': poseQuad(rig, st, br, time); break;
    case 'cannon': poseCannon(rig, st, time); break;
    case 'catapult': poseCatapult(rig, st, time); break;
    case 'chariot': poseChariot(rig, st, time); break;
  }
}

/* ============================== humans ============================== */
const REST = {
  default: { a0: 0.08, a1: 0.08, f0: -0.15, f1: -0.15, a0z: -0.1, a1z: 0.1, weapX: 0 },
  marshal: { a0: -0.25, f0: -1.7, a0z: -0.75, a1: 0.1, f1: -0.35, a1z: 0.12, weapX: 0.95 },
  marshalFlag: { a0: -0.25, f0: -1.7, a0z: -0.75, a1: -0.35, f1: -0.9, a1z: 0.1, weapX: 1.25 },
  official: { a0: -0.55, f0: -1.1, a0z: 0.45, a1: -0.55, f1: -1.1, a1z: -0.45, weapX: 0 },
  strategist: { a0: 0.35, f0: -1.3, a0z: 0.3, a1: -0.4, f1: -1.5, a1z: -0.25, weapX: 1.6 },
  chancellor: { a0: -0.6, f0: -1.25, a0z: 0.5, a1: -0.6, f1: -1.25, a1z: -0.5, weapX: 1.85 },
  guard: { a0: 0.05, f0: -0.2, a1: -0.1, f1: -0.6, a1z: 0.1, weapX: 0.7 },
  spearman: { a0: -0.3, f0: -1.0, a0z: 0.15, a1: -0.1, f1: -0.6, a1z: 0.1, weapX: 0.7 },
  swordsman: { a0: -0.45, f0: -1.1, a0z: 0.35, a1: -0.15, f1: -0.5, a1z: 0.12, weapX: 1.25 },
  archer: { a0: 0.05, f0: -0.3, a1: 0.05, f1: -0.3 },
  rider: { a0: -0.7, f0: -0.6, a0z: 0.2, a1: -0.35, f1: -0.85, weapX: 1.2 },
  mahout: { a0: -0.6, f0: -0.6, a0z: 0.2, a1: -0.6, f1: -0.6, a1z: -0.2 },
  gunner: { a0: -0.2, f0: -0.6, a1: -0.2, f1: -0.6 },
  loader: { a0: 0.05, f0: -0.3, a1: 0.05, f1: -0.3 },
  driver: { a0: -0.75, f0: -0.5, a0z: 0.25, a1: -0.75, f1: -0.5, a1z: -0.25 },
  charioteer: { a0: -0.6, f0: -0.6, a0z: 0.2, a1: -0.1, f1: -0.6, a1z: 0.1, weapX: 0.7 },
};
function restPose(role) {
  return { hipsY: 0.36, hipsZ: 0, chestX: 0, chestY: 0, chestZ: 0, headX: 0, headY: 0, headZ: 0, l0: 0, l1: 0, l0z: 0, l1z: 0, k0: 0.04, k1: 0.04,
    a0y: 0, a1y: 0, fan: 0, beard: 0, ...REST.default, ...(REST[role] || {}) };
}
const look = (P, p, amt = 0.75) => { P.headY += Math.sin(p * TAU) * amt; P.chestY += Math.sin(p * TAU) * amt * 0.25; };
const shift = (P, e) => { P.hipsZ += 0.05 * e; P.chestZ -= 0.06 * e; P.l0z -= 0.08 * e; P.l1 += 0.1 * e; P.headZ += 0.05 * e; };

const BIPED_IDLE = {
  marshal: [['look', 3.2], ['raiseSword', 2.6], ['command', 2.4], ['plant', 3.0], ['shift', 2.4], ['capeSwirl', 2.0]],
  marshalFlag: [['look', 3.2], ['wave', 2.6], ['command', 2.4], ['shift', 2.4]],
  official: [['look', 3], ['read', 3.5], ['bow', 2.4], ['nod', 1.6], ['shift', 2.4]],
  strategist: [['fan', 3.2], ['strokeBeard', 3.0], ['ponder', 3.0], ['look', 3], ['fanPoint', 2.2]],
  chancellor: [['bow', 2.8], ['strokeBeard', 3.0], ['look', 3], ['nod', 1.6], ['adjustHat', 2.2]],
  guard: [['thump', 1.8], ['look', 3], ['shift', 2.4], ['drill', 2.4]],
  spearman: [['drill', 2.4], ['attention', 2.0], ['look', 3], ['shieldUp', 2.2], ['shift', 2.4]],
  swordsman: [['practice', 2.2], ['shieldTap', 2.2], ['look', 3], ['stretch', 2.6], ['shift', 2.4]],
  archer: [['draw', 3.0], ['look', 3], ['shift', 2.4], ['checkArrow', 2.2]],
  rider: [['look', 3], ['raiseSpear', 2.4], ['patHorse', 2.4]],
  mahout: [['look', 3], ['wave', 2.4]],
  gunner: [['wipe', 3.0], ['look', 3], ['crouch', 2.4]],
  loader: [['lift', 3.2], ['look', 3], ['wipeBrow', 2.4]],
  driver: [['reins', 1.6], ['look', 3]],
  charioteer: [['drill', 2.4], ['look', 3], ['raiseSpear', 2.4]],
};
function applyBipedIdle(P, a, r) {
  const { p, env: e } = a;
  switch (a.name) {
    case 'look': look(P, p); break;
    case 'shift': shift(P, e); break;
    case 'nod': P.headX += Math.max(0, Math.sin(p * TAU * 2)) * 0.35 * e; break;
    case 'raiseSword': // inspect the blade
      P.a1 = -2.3 * e + P.a1 * (1 - e); P.f1 = -0.5 * e + P.f1 * (1 - e); P.weapX = P.weapX * (1 - e) + (-0.9) * e; P.headX -= 0.35 * e; P.chestX -= 0.1 * e;
      if (p > 0.45 && a.once('clink')) idleHook('sound:clink', r.weapon, r); break;
    case 'command': { // point forward, commanding the troops
      const k = smooth(0.1, 0.3, p) * (1 - smooth(0.75, 1, p));
      P.a1 = P.a1 * (1 - k) - 1.45 * k; P.f1 = P.f1 * (1 - k) - 0.05 * k; P.weapX = P.weapX * (1 - k) + 0.1 * k; P.chestX += 0.12 * k; P.l1 -= 0.25 * k; P.l0 += 0.2 * k;
      if (r.flag) r.flagBoost = k; break;
    }
    case 'plant': // both hands rest on the sword pommel
      P.a0 = P.a0 * (1 - e) - 0.5 * e; P.f0 = P.f0 * (1 - e) - 0.8 * e; P.a0z = P.a0z * (1 - e) + 0.5 * e;
      P.a1 = P.a1 * (1 - e) - 0.5 * e; P.f1 = P.f1 * (1 - e) - 0.8 * e; P.a1z = P.a1z * (1 - e) - 0.5 * e; P.weapX = P.weapX * (1 - e) + 2.1 * e;
      P.headX += 0.1 * e; break;
    case 'capeSwirl': if (r.cape) r.capeBoost = e; look(P, p, 0.4); break;
    case 'wave': // wave flag / hand
      P.a1 = P.a1 * (1 - e) + (-2.4 + Math.sin(p * TAU * 3) * 0.45) * e; P.f1 = P.f1 * (1 - e) - 0.2 * e; P.weapX = P.weapX * (1 - e) + 0.6 * e; P.headX -= 0.15 * e;
      if (r.flag) r.flagBoost = e; break;
    case 'read': // unroll and read the memorial scroll
      P.a0 = P.a0 * (1 - e) - 0.8 * e; P.a1 = P.a1 * (1 - e) - 0.8 * e; P.a0z += 0.25 * e; P.a1z -= 0.25 * e; P.headX += 0.35 * e; P.headY += Math.sin(p * TAU * 2) * 0.15 * e; break;
    case 'bow': // 拱手作揖 bow
      P.chestX += 0.55 * e; P.headX += 0.25 * e; P.a0 = P.a0 * (1 - e) - 0.9 * e; P.a1 = P.a1 * (1 - e) - 0.9 * e; P.hipsY -= 0.015 * e; break;
    case 'fan': // gently fanning with the feather fan
      P.a1 = P.a1 * (1 - e) - 0.7 * e; P.f1 = P.f1 * (1 - e) - 1.7 * e; P.fan = Math.sin(p * TAU * 4) * 0.6 * e; P.headY += 0.2 * e; break;
    case 'fanPoint': // point the fan at the battlefield
      P.a1 = P.a1 * (1 - e) - 1.4 * e; P.f1 = P.f1 * (1 - e) - 0.2 * e; P.weapX = P.weapX * (1 - e) + 0.4 * e; P.chestX += 0.08 * e; P.headX += 0.1 * e; break;
    case 'strokeBeard': // left hand strokes the beard
      P.a0 = P.a0 * (1 - e) - 1.1 * e; P.f0 = P.f0 * (1 - e) - 1.75 * e; P.a0z = P.a0z * (1 - e) + 0.55 * e;
      P.f0 += Math.sin(p * TAU * 3) * 0.15 * e; P.beard = Math.sin(p * TAU * 3) * 0.12 * e; P.headX -= 0.15 * e; P.headZ += 0.08 * e; break;
    case 'ponder': P.headX -= 0.3 * e; P.headZ += 0.15 * e; P.headY += 0.3 * Math.sin(p * Math.PI) * e; break;
    case 'adjustHat': P.a0 = P.a0 * (1 - e) - 2.6 * e; P.f0 = P.f0 * (1 - e) - 0.6 * e; P.a0z = P.a0z * (1 - e) + 0.25 * e; P.headX -= 0.1 * e; if (r.wings) r.wingWobble = e; break;
    case 'thump': { // lift halberd and strike the butt on the ground
      const up = smooth(0, 0.4, p) * (1 - smooth(0.45, 0.55, p));
      P.a1 -= 0.5 * up; P.hipsY += 0.005 * up; P.chestX -= 0.05 * up;
      if (p > 0.53 && a.once('thud')) { idleHook('dust', r.weapon, r); idleHook('sound:thud', r.weapon, r); }
      break;
    }
    case 'drill': { // spear thrust drill: two thrusts with lunge
      const t = Math.max(0, Math.sin(p * TAU * 2)) * e;
      P.a1 = P.a1 * (1 - e) - 1.3 * e - 0.3 * t; P.f1 = P.f1 * (1 - e) - 0.25 * e + 0.25 * t; P.weapX = P.weapX * (1 - e) + 1.55 * e;
      P.chestX += 0.25 * t; P.l0 -= 0.45 * t; P.k0 += 0.5 * t; P.l1 += 0.3 * t; P.hipsY -= 0.025 * t;
      if (t > 0.9 && a.once('t' + Math.floor(p * 2))) idleHook('sound:whoosh', r.weapon, r);
      break;
    }
    case 'attention': P.chestX -= 0.08 * e; P.headX -= 0.08 * e; P.a1 -= 0.1 * e; P.hipsY += 0.008 * e; break;
    case 'shieldUp': P.a0 = P.a0 * (1 - e) - 1.3 * e; P.f0 = P.f0 * (1 - e) - 0.9 * e; P.headX += 0.05 * e; P.chestX += 0.1 * e; P.l1 -= 0.2 * e; break;
    case 'practice': { // broadsword practice swing
      const sw = Math.sin(p * TAU * 1.5);
      P.a1 = P.a1 * (1 - e) + (-1.6 + sw * 1.1) * e; P.f1 = P.f1 * (1 - e) - 0.3 * e; P.a1z += sw * 0.3 * e; P.chestY += sw * 0.25 * e; P.weapX = P.weapX * (1 - e) + 0.2 * e;
      if (Math.abs(sw) > 0.95 && a.once('s' + Math.round(p * 3))) idleHook('sound:whoosh', r.weapon, r);
      break;
    }
    case 'shieldTap': {
      const tap = Math.max(0, Math.sin(p * TAU * 3));
      P.a1 = P.a1 * (1 - e) - 0.9 * e - 0.2 * tap; P.a1z -= 0.6 * e; P.f1 -= 0.4 * e; P.a0 = P.a0 * (1 - e) - 0.9 * e;
      if (tap > 0.95 && a.once('k' + Math.floor(p * 3))) idleHook('sound:tap', r.weapon, r);
      break;
    }
    case 'stretch': P.chestX -= 0.2 * e; P.chestY += Math.sin(p * TAU) * 0.4 * e; P.headX -= 0.2 * e; break;
    case 'draw': { // nock and draw the bow
      const d = smooth(0.15, 0.45, p) * (1 - smooth(0.8, 0.95, p));
      P.a1 = P.a1 * (1 - d) - 1.5 * d; P.a1z += 0.2 * d; P.f1 = P.f1 * (1 - d) - 0.05 * d; P.a0 = P.a0 * (1 - d) - 1.4 * d; P.f0 = P.f0 * (1 - d) - 1.4 * d; P.a0z += 0.6 * d;
      P.chestY -= 0.35 * d; P.headY -= 0.2 * d; break;
    }
    case 'checkArrow': P.a0 = P.a0 * (1 - e) - 2.2 * e; P.a0z -= 0.3 * e; P.headY -= 0.5 * e; P.headX -= 0.1 * e; break;
    case 'raiseSpear': P.a1 = P.a1 * (1 - e) - 2.6 * e; P.f1 = P.f1 * (1 - e) - 0.1 * e; P.weapX = P.weapX * (1 - e) + 0.2 * e; P.headX -= 0.15 * e; break;
    case 'patHorse': P.a0 = P.a0 * (1 - e) - 0.4 * e; P.f0 = P.f0 * (1 - e) - 0.2 * e + Math.sin(p * TAU * 3) * 0.2 * e; P.chestX += 0.25 * e; P.headX += 0.3 * e; break;
    case 'wipe': { // cleaning the cannon barrel
      const c = p * TAU * 3;
      P.chestX += 0.35 * e; P.a0 = P.a0 * (1 - e) + (-1.0 + Math.sin(c) * 0.25) * e; P.a1 = P.a1 * (1 - e) + (-1.0 + Math.cos(c) * 0.25) * e; P.headX += 0.2 * e; break;
    }
    case 'crouch': P.hipsY -= 0.07 * e; P.l0 -= 0.75 * e; P.l1 -= 0.75 * e; P.k0 += 1.3 * e; P.k1 += 1.3 * e; P.chestX += 0.35 * e; P.headX -= 0.1 * e; break;
    case 'lift': { // bend down, lift a stone overhead into the bucket
      const down = smooth(0, 0.35, p) * (1 - smooth(0.4, 0.6, p)), up = smooth(0.45, 0.65, p) * (1 - smooth(0.8, 1, p));
      P.chestX += 0.7 * down; P.hipsY -= 0.07 * down; P.l0 -= 0.75 * down; P.l1 -= 0.75 * down; P.k0 += 1.3 * down; P.k1 += 1.3 * down;
      P.a0 = P.a0 * (1 - down - up) - 1.3 * down - 2.8 * up; P.a1 = P.a1 * (1 - down - up) - 1.3 * down - 2.8 * up; P.a0z += 0.3 * up; P.a1z -= 0.3 * up;
      if (p > 0.6 && a.once('load')) idleHook('sound:creak', r.root, r);
      break;
    }
    case 'wipeBrow': P.a1 = P.a1 * (1 - e) - 2.2 * e; P.f1 = P.f1 * (1 - e) - 1.6 * e + Math.sin(p * TAU * 2) * 0.15 * e; P.a1z -= 0.4 * e; P.headX -= 0.15 * e; break;
    case 'reins': { const s = Math.max(0, Math.sin(p * TAU * 2)); P.a0 -= 0.4 * s * e; P.a1 -= 0.4 * s * e; P.chestX += 0.1 * s * e; break; }
  }
}

function poseBiped(r, st, br, time) {
  const P = restPose(r.role), mode = st.mode, w = st.walk || 0, a = st.act || 0;
  const twoHanded = r.role === 'official' || r.role === 'chancellor' || r.seated;
  r.flagBoost = 0; r.capeBoost = 0; r.wingWobble = 0;
  if (mode === 'walk' || mode === 'gallop') {
    // natural gait: hip swing + knee flex in swing phase, double bob per cycle, pelvis sway, counter-twist, arm swing
    const s = Math.sin(w), c = Math.cos(w), amp = st.amp ?? 1, spd = st.speed ?? 0.6;
    const hipAmp = (0.32 + 0.22 * spd) * amp;
    P.l0 = -s * hipAmp; P.l1 = s * hipAmp;
    P.k0 = 0.08 + Math.max(0, c) * (0.75 + 0.35 * spd) * amp; P.k1 = 0.08 + Math.max(0, -c) * (0.75 + 0.35 * spd) * amp;
    P.hipsY += (Math.cos(2 * w) * 0.012 - 0.008) * amp;
    P.hipsZ = s * 0.035 * amp; P.headZ = -P.hipsZ * 0.8;
    P.chestY = s * 0.1 * amp; P.headY = -P.chestY * 0.6;
    P.chestX = (0.04 + 0.1 * spd) * amp;
    if (!twoHanded) {
      if (r.role !== 'marshal' && r.role !== 'marshalFlag') { P.a0 = s * 0.45 * amp; P.f0 = -0.25 - Math.max(0, -s) * 0.3; }
      if (P.weapX === 0 || r.role === 'archer' || r.role === 'loader') { P.a1 = -s * 0.45 * amp; P.f1 = -0.25 - Math.max(0, s) * 0.3; }
      else P.a1 += -s * 0.12 * amp;
    }
    if (r.skirt) P.k0 = P.k1 = 0.04;
  } else if (mode === 'windup') {
    P.a1 = -2.6 * a; P.f1 = -0.6 * a; P.a1z = -0.3 * a; P.chestX = -0.25 * a; P.l0 = 0.3 * a; P.l1 = -0.25 * a;
    P.a0 = 0.6 * a; P.headX = -0.15 * a; P.weapX *= (1 - a);
  } else if (mode === 'strike') {
    P.a1 = -2.6 + 3.6 * a; P.f1 = -0.6 + 0.5 * a; P.a1z = -0.3; P.chestX = -0.25 + 0.75 * a; P.weapX = 0;
    P.l0 = -0.3 - 0.4 * a; P.k0 = 0.3 + 0.5 * a; P.l1 = 0.25 + 0.35 * a; P.hipsY -= 0.05 * a; P.a0 = 0.6 - 0.9 * a;
  } else if (mode === 'cheer') {
    const b = Math.sin(time * 8) * 0.1;
    P.a1 = -2.9 + b; P.a0 = -0.4; P.f1 = -0.2; P.chestX = -0.1; P.hipsY += Math.abs(Math.sin(time * 8)) * 0.03; P.weapX = 0.3;
    if (r.flag) r.flagBoost = 1;
  } else if (mode === 'hit') {
    P.chestX = -0.7 * a; P.headX = -0.5 * a; P.a0 = -1.6 * a; P.a1 = -1.6 * a; P.a0z = 0.9 * a; P.a1z = -0.9 * a; P.l0 = 0.5 * a; P.l1 = -0.3 * a;
  } else if (mode === 'guard') {
    if (!twoHanded) { P.a0 = -1.0; P.f0 = -1.2; P.a1 = -0.9; P.f1 = -0.9; P.weapX = 1.2; }
    P.chestX = 0.1; P.l0 = 0.2; P.l1 = -0.15; P.headX = -0.05;
  } else { // idle — breathing sway + role behaviour
    P.headY += Math.sin(time * 0.37 + r.seed) * 0.12;
    P.chestZ += Math.sin(time * 0.5 + r.seed) * 0.015;
    const act = scheduler(r, time, BIPED_IDLE[r.role] || [['look', 3], ['shift', 2.4]]);
    if (act) applyBipedIdle(P, act, r);
  }
  if (r.seated) { P.hipsY = 0.36; P.l0 = -1.25; P.l1 = -1.25; P.l0z = -0.42; P.l1z = 0.42; P.k0 = P.k1 = 1.15; P.hipsZ = 0; }
  const [L, Rl] = r.legs, [LA, RA] = r.arms;
  r.hips.position.y = P.hipsY + br * 0.004;
  r.hips.rotation.z = P.hipsZ;
  r.chest.rotation.set(P.chestX, P.chestY, P.chestZ);
  r.chest.scale.set(1 + br * 0.012, 1 + br * 0.012, 1 + br * 0.02);
  r.head.rotation.set(P.headX, P.headY, P.headZ);
  L.rotation.set(P.l0, 0, P.l0z); Rl.rotation.set(P.l1, 0, P.l1z);
  if (r.knees) { r.knees[0].rotation.x = P.k0; r.knees[1].rotation.x = P.k1; }
  LA.sh.rotation.set(P.a0, P.a0y, P.a0z); RA.sh.rotation.set(P.a1, P.a1y, P.a1z);
  LA.fore.rotation.x = P.f0; RA.fore.rotation.x = P.f1;
  if (r.weapon) r.weapon.rotation.x = P.weapX;
  if (r.fan) r.fan.rotation.z = P.fan;
  if (r.beard) r.beard.rotation.x = P.beard;
  if (r.skirt) r.skirt.rotation.x = -P.chestX * 0.3 + (mode === 'walk' ? Math.sin(w) * 0.06 : 0);
  if (r.cape) r.cape.rotation.x = 0.15 + (mode === 'walk' || mode === 'gallop' ? 0.45 : 0) + Math.sin(time * 3 + r.seed) * 0.05 + (mode === 'strike' ? 0.6 * a : 0) + r.capeBoost * (0.5 + Math.sin(time * 9) * 0.25);
  if (r.plume) r.plume.rotation.x = Math.sin(time * 4 + r.seed) * 0.08 + (mode === 'walk' ? 0.2 : 0);
  if (r.flag) r.flag.rotation.y = Math.sin(time * 3 + r.seed) * 0.35 + r.flagBoost * Math.sin(time * 14) * 0.6;
  if (r.wings) r.wings.rotation.z = Math.sin(time * 3 + r.seed) * 0.02 + r.wingWobble * Math.sin(time * 18) * 0.06;
}

/* ============================== horses & elephants ============================== */
const QUAD_IDLE = {
  horse: [['tailSwish', 2.0], ['paw', 2.2], ['headToss', 1.8], ['graze', 4.0], ['earTwitch', 1.4], ['restLeg', 3.2], ['snort', 1.2], ['look', 3]],
  drafthorse: [['tailSwish', 2.0], ['paw', 2.2], ['headToss', 1.8], ['earTwitch', 1.4], ['snort', 1.2]],
  elephant: [['trunkCurl', 3.2], ['trunkRaise', 2.8], ['stomp', 2.0], ['tailSwish', 2.0], ['earFlap', 2.4], ['dustBath', 3.0], ['sway', 4.0]],
};
function poseQuad(r, st, br, time) {
  const mode = st.mode, w = st.walk || 0, a = st.act || 0;
  const elephant = r.role === 'elephant';
  const P = { bodyX: 0, bodyY: r.H, bodyZ: 0, neckX: 0, headX: 0, headY: Math.sin(time * 0.4 + r.seed) * 0.15, headZ: 0,
    tailX: 0, tailY: Math.sin(time * 1.8 + r.seed) * 0.25, legs: [[0, 0], [0, 0], [0, 0], [0, 0]], ear: 0, earL: 0, earR: 0, trunk: 0, trunkWave: 1, earFlap: 0 };
  if (mode === 'walk') {
    const ph = [0, Math.PI, Math.PI, 0];
    r.legs.forEach((l, i) => { const s = Math.sin(w + ph[i]); P.legs[i] = [s * 0.5, Math.max(0, -Math.cos(w + ph[i])) * (l.front ? -0.6 : 0.6)]; });
    P.bodyY += Math.abs(Math.sin(w)) * 0.015; P.neckX = Math.sin(w * 2) * 0.08; P.headX = -Math.sin(w * 2) * 0.05; P.tailY = Math.sin(w) * 0.5; P.headY = 0; P.bodyZ = Math.sin(w) * 0.02;
    if (elephant) { P.bodyZ = Math.sin(w) * 0.04; P.earFlap = 0.3; }
  } else if (mode === 'gallop') {
    const ph = [0, 0.4, Math.PI, Math.PI + 0.4];
    r.legs.forEach((l, i) => { const s = Math.sin(w + ph[i]); P.legs[i] = [s * 0.85, Math.max(0, Math.cos(w + ph[i])) * (l.front ? -1.0 : 0.9)]; });
    P.bodyX = Math.sin(w) * 0.12; P.bodyY += Math.max(0, Math.sin(w)) * 0.07; P.neckX = -Math.sin(w) * 0.2; P.headY = 0; P.tailX = -0.5;
  } else if (mode === 'windup') { // rear up
    P.bodyX = -0.75 * a * (elephant ? 0.6 : 1); P.bodyY += 0.08 * a; P.neckX = -0.3 * a; P.headY = 0;
    P.legs = [[-1.1 * a, -0.9 * a], [-0.8 * a, -1.1 * a], [0.6 * a, 0.2 * a], [0.6 * a, 0.2 * a]]; P.tailY = 0;
    P.trunk = -1.2 * a; P.earFlap = 0.8 * a;
  } else if (mode === 'strike') {
    P.bodyX = (-0.75 + 0.95 * a) * (elephant ? 0.6 : 1); P.bodyY += 0.08 - 0.12 * a; P.neckX = -0.3 + 0.9 * a; P.headY = 0;
    P.legs = [[-1.1 + 1.6 * a, -0.9 + 0.9 * a], [-0.8 + 1.3 * a, -1.1 + 1.1 * a], [0.6 - 0.9 * a, 0.2], [0.6 - 0.9 * a, 0.2]];
    P.trunk = -1.2 + 2.0 * a;
  } else if (mode === 'cheer') {
    const b = Math.sin(time * 7);
    P.bodyX = -0.2 - Math.abs(b) * 0.25; P.neckX = -0.4; P.headY = b * 0.3; P.tailY = b * 0.8;
    P.legs = [[-0.5 - Math.abs(b) * 0.4, -0.5], [-0.5 - Math.abs(b) * 0.4, -0.5], [0.2, 0], [0.2, 0]];
    P.trunk = -1.6; P.earFlap = 0.6;
  } else if (mode === 'hit') {
    P.bodyX = 0.5 * a; P.neckX = 0.8 * a; P.legs = P.legs.map((_, i) => [(i % 2 ? 1 : -1) * 0.8 * a, 0.5 * a]);
  } else if (mode === 'guard') {
    P.neckX = -0.15; P.headY = 0; P.earL = P.earR = -0.4; P.trunk = -0.3; P.earFlap = 0.5;
  } else {
    // idle: continuous natural motion
    if (elephant) { P.bodyZ = Math.sin(time * 0.7 + r.seed) * 0.02; P.earFlap = 0.15; }
    const act = scheduler(r, time, QUAD_IDLE[r.role] || QUAD_IDLE.horse);
    if (act) applyQuadIdle(P, act, r, time);
  }
  // apply
  r.body.position.y = P.bodyY + br * 0.003;
  r.body.rotation.set(P.bodyX, 0, P.bodyZ);
  r.body.scale.set(1 + br * 0.015, 1 + br * 0.018, 1);
  r.legs.forEach((l, i) => { l.hp.rotation.x = P.legs[i][0]; l.knee.rotation.x = P.legs[i][1]; });
  r.neckBase ??= r.neck.rotation.x;
  r.neck.rotation.x = r.neckBase + P.neckX;
  r.headBase ??= r.head.rotation.x;
  r.head.rotation.set(r.headBase + P.headX, P.headY, P.headZ);
  if (r.tail) r.tail.rotation.set((r.tailBase ??= r.tail.rotation.x) + P.tailX, P.tailY, 0);
  if (r.mane) r.mane.rotation.z = Math.sin(time * 2 + r.seed) * 0.04 + P.headZ * 0.5;
  if (r.trunkSegs) r.trunkSegs.forEach((s, i) => {
    s.rotation.x = (i ? 0.15 : -0.15) + Math.sin(time * 1.4 + i * 0.55 + r.seed) * 0.1 * P.trunkWave + P.trunk / r.trunkSegs.length * (1 + i * 0.25);
    s.rotation.z = Math.sin(time * 0.9 + i * 0.4 + r.seed) * 0.05 * P.trunkWave;
  });
  r.ears.forEach(ep => {
    const sd = ep.userData.side;
    if (elephant) ep.rotation.y = sd * (1.25 - (Math.sin(time * (2 + P.earFlap * 6) + r.seed) * 0.5 + 0.5) * (0.25 + P.earFlap * 0.9));
    else ep.rotation.x = (sd < 0 ? P.earL : P.earR) + Math.sin(time * 1.3 + sd + r.seed) * 0.05;
  });
  if (r.flag) r.flag.rotation.y = Math.sin(time * 3 + r.seed) * 0.35;
  if (r.rider) { r.rider.seated = true; poseRig(r.rider, { mode: mode === 'gallop' || mode === 'walk' ? 'guard' : mode === 'windup' || mode === 'strike' ? mode : mode === 'cheer' ? 'cheer' : mode === 'hit' ? 'hit' : 'idle', walk: w, act: a, speed: st.speed, amp: st.amp }, time); }
}
function applyQuadIdle(P, act, r, time) {
  const { p, env: e } = act;
  switch (act.name) {
    case 'tailSwish': P.tailY = Math.sin(p * TAU * 3) * 0.9 * e; P.tailX = 0.4 * e; break;
    case 'paw': { // paw the ground with a front hoof
      const k = Math.max(0, Math.sin(p * TAU * 2));
      P.legs[1] = [-0.7 * k * e, -1.4 * k * e]; P.neckX += 0.15 * e; P.headX += 0.1 * e;
      if (k < 0.05 && p > 0.2 && act.once('d' + Math.round(p * 2))) { idleHook('dust', r.legs[1].knee, r); idleHook('sound:hoof', r.legs[1].knee, r); }
      break;
    }
    case 'headToss': P.neckX -= 0.45 * e; P.headY = Math.sin(p * TAU * 3) * 0.35 * e; P.headZ = Math.sin(p * TAU * 3) * 0.2 * e; if (p > 0.3 && act.once('n')) idleHook('sound:neigh', r.head, r); break;
    case 'graze': P.neckX += 1.0 * e; P.headX += 0.4 * e + Math.sin(time * 9) * 0.04 * e; P.headY *= 1 - e; break;
    case 'earTwitch': P.earL = -0.6 * Math.max(0, Math.sin(p * TAU * 2)); P.earR = 0.4 * Math.max(0, Math.sin(p * TAU * 2 + 1.5)); break;
    case 'restLeg': P.legs[3] = [0.15 * e, 0.6 * e]; P.bodyZ -= 0.03 * e; P.bodyY -= 0.006 * e; P.headX += 0.15 * e; break;
    case 'snort': P.headX += Math.sin(p * TAU * 2) * 0.15 * e; P.neckX -= 0.1 * e; if (p > 0.3 && act.once('s')) { idleHook('sound:snort', r.head, r); idleHook('breath', r.head, r); } break;
    case 'look': P.headY += Math.sin(p * TAU) * 0.6 * e; P.neckX -= 0.1 * e; break;
    case 'trunkCurl': P.trunk = -2.6 * e; P.trunkWave = 1 - e * 0.5; P.headX -= 0.1 * e; break;
    case 'trunkRaise': // raise trunk and trumpet
      P.trunk = -4.2 * e; P.neckX -= 0.25 * e; P.headX -= 0.2 * e; P.earFlap = 0.9 * e; P.trunkWave = 1 - e;
      if (p > 0.35 && act.once('t')) idleHook('sound:trumpet', r.head, r); break;
    case 'stomp': {
      const up = smooth(0, 0.4, p) * (1 - smooth(0.45, 0.55, p));
      P.legs[0] = [-0.6 * up, -0.7 * up]; P.bodyX -= 0.05 * up; P.bodyZ += 0.03 * up;
      if (p > 0.55 && act.once('s')) { idleHook('dust', r.legs[0].knee, r); idleHook('sound:stomp', r.legs[0].knee, r); }
      break;
    }
    case 'earFlap': P.earFlap = 0.9 * e; break;
    case 'dustBath': { // toss dust over the back with the trunk
      const toss = smooth(0.4, 0.6, p);
      P.trunk = (1.2 * (1 - toss) - 3.6 * toss) * e; P.neckX += 0.25 * e * (1 - toss);
      if (p > 0.58 && act.once('d')) idleHook('dustUp', r.head, r);
      break;
    }
    case 'sway': P.bodyZ += Math.sin(p * TAU * 2) * 0.05 * e; P.headY += Math.sin(p * TAU * 2) * 0.15 * e; break;
  }
}

/* ============================== war machines ============================== */
function poseCannon(r, st, time) {
  const mode = st.mode, w = st.walk || 0, a = st.act || 0;
  r.wheels.forEach(wh => { wh.rotation.x = -(st.dist || 0) / (r.wheelR * (st.scale || 1.5)); });
  let recoil = 0, pitch = -0.25, yaw = 0;
  if (mode === 'windup') pitch = -0.25 - 0.25 * a;
  else if (mode === 'strike') { recoil = Math.sin(a * Math.PI) * 0.1; pitch = -0.5 + 0.25 * a; }
  else if (mode === 'idle') {
    const act = scheduler(r, time, [['aim', 3.5], ['traverse', 3.0], ['smoke', 2.0]]);
    if (act?.name === 'aim') pitch += -0.25 * act.env + Math.sin(act.p * TAU * 2) * 0.04 * act.env;
    if (act?.name === 'traverse') yaw = Math.sin(act.p * TAU) * 0.25 * act.env;
    if (act?.name === 'smoke' && act.once('s')) idleHook('smoke', r.fuse, r);
    if (act && (act.name === 'aim' || act.name === 'traverse') && act.once('c')) idleHook('sound:creak', r.root, r);
  }
  r.barrel.position.z = -recoil; r.barrel.rotation.x = pitch; r.body.rotation.y = yaw;
  r.body.position.y = 0.12 + (mode === 'strike' ? Math.sin(a * Math.PI) * 0.03 : 0);
  if (r.flag) r.flag.rotation.y = Math.sin(time * 3 + r.seed) * 0.3;
  poseRig(r.crew, { mode: mode === 'strike' ? 'guard' : mode === 'walk' ? 'walk' : mode === 'cheer' ? 'cheer' : mode === 'idle' ? 'idle' : 'guard', walk: w, act: a, speed: st.speed, amp: st.amp }, time);
}
function poseCatapult(r, st, time) {
  const mode = st.mode, w = st.walk || 0, a = st.act || 0;
  r.wheels.forEach(wh => { wh.rotation.x = -(st.dist || 0) / (r.wheelR * (st.scale || 1.5)); });
  let arm = 0.55;
  if (mode === 'windup') arm = 0.55 + 0.4 * a;
  else if (mode === 'strike') arm = 0.95 - 2.3 * Math.min(1, a * 1.4);
  else if (mode === 'idle') {
    const act = scheduler(r, time, [['creak', 2.2], ['load', 3.2], ['test', 2.6]]);
    if (act?.name === 'creak') arm += Math.sin(act.p * TAU * 3) * 0.04 * act.env;
    if (act?.name === 'load') arm += 0.12 * act.env;
    if (act?.name === 'test') arm -= 0.35 * Math.sin(act.p * Math.PI);
    if (act && act.once('c')) idleHook('sound:creak', r.root, r);
  }
  r.arm.rotation.x = arm;
  r.stone.visible = !(mode === 'strike' && a > 0.25) && !r.stoneFired;
  if (mode === 'idle') r.stoneFired = false;
  if (r.flag) r.flag.rotation.y = Math.sin(time * 3 + r.seed) * 0.3;
  poseRig(r.crew, { mode: mode === 'walk' ? 'walk' : mode === 'cheer' ? 'cheer' : mode === 'idle' ? 'idle' : 'guard', walk: w, act: a, speed: st.speed, amp: st.amp }, time);
}
function poseChariot(r, st, time) {
  const mode = st.mode, w = st.walk || 0, a = st.act || 0;
  r.wheels.forEach(wh => { wh.rotation.x = -(st.dist || 0) / (r.wheelR * (st.scale || 1.5)); });
  let rock = 0;
  if (mode === 'idle') {
    const act = scheduler(r, time, [['rock', 2.4], ['still', 3]]);
    if (act?.name === 'rock') rock = Math.sin(act.p * TAU * 2) * 0.15 * act.env;
    r.wheels.forEach(wh => { wh.rotation.x += rock; });
  }
  r.body.position.y = 0.17 + (mode === 'walk' || mode === 'gallop' ? Math.abs(Math.sin(w * 2)) * 0.012 : 0);
  r.body.rotation.x = mode === 'windup' ? -0.12 * a : mode === 'strike' ? -0.12 + 0.25 * a : rock * 0.05;
  if (r.flag) r.flag.rotation.y = Math.sin(time * 3 + r.seed) * 0.3 + (mode === 'walk' || mode === 'gallop' ? 0.6 : 0);
  const crewMode = mode === 'walk' || mode === 'gallop' ? (r.horse ? 'idle' : 'guard') : mode;
  if (r.crew) poseRig(r.crew, { mode: crewMode, walk: w, act: a, speed: st.speed, amp: st.amp }, time);
  if (r.horse) poseRig(r.horse, { mode: mode === 'walk' || mode === 'gallop' ? 'gallop' : mode, walk: w, act: a, speed: st.speed, amp: st.amp }, time);
}

/* ------------------------------ particles ------------------------------ */
export class Particles {
  constructor(scene) {
    this.scene = scene; this.items = [];
    this.geo = new THREE.SphereGeometry(1, 6, 4);
    this.chipGeo = new THREE.BoxGeometry(1, 0.4, 0.7);
  }
  burst(pos, { count = 30, color = 0xffaa33, speed = 3, size = 0.04, life = 0.9, gravity = 6, emissive = true, chips = false, up = 1 } = {}) {
    for (let i = 0; i < count; i++) {
      const mat = emissive ? new THREE.MeshBasicMaterial({ color, transparent: true }) : new THREE.MeshStandardMaterial({ color, roughness: 0.8, transparent: true });
      const m = new THREE.Mesh(chips ? this.chipGeo : this.geo, mat);
      const s = size * (0.5 + Math.random());
      m.scale.setScalar(s); m.position.copy(pos);
      m.castShadow = !emissive;
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * up + 0.2, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random()));
      this.scene.add(m);
      this.items.push({ m, v: dir, life, t: 0, g: gravity, spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10), s });
    }
  }
  smoke(pos, { count = 14, color = 0x9a9590, life = 1.8, size = 0.12 } = {}) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.geo, new THREE.MeshStandardMaterial({ color, roughness: 1, transparent: true, opacity: 0.55, depthWrite: false }));
      m.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.2, Math.random() * 0.1, (Math.random() - 0.5) * 0.2));
      m.scale.setScalar(size * (0.5 + Math.random() * 0.6));
      this.scene.add(m);
      this.items.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.4 + Math.random() * 0.5, (Math.random() - 0.5) * 0.6), life, t: 0, g: -0.2, grow: 1.8, s: m.scale.x, smoke: true });
    }
  }
  ring(pos, color = 0xfff0c0) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.28, 48), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.copy(pos); m.position.y += 0.02;
    this.scene.add(m);
    this.items.push({ m, v: new THREE.Vector3(), life: 0.6, t: 0, g: 0, ring: true, s: 1 });
  }
  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.t += dt;
      const k = p.t / p.life;
      if (k >= 1) { this.scene.remove(p.m); p.m.material.dispose(); this.items.splice(i, 1); continue; }
      if (p.ring) { p.m.scale.setScalar(1 + k * 5); p.m.material.opacity = 1 - k; continue; }
      p.v.y -= p.g * dt;
      p.m.position.addScaledVector(p.v, dt);
      if (!p.smoke && p.m.position.y < 0.01) { p.m.position.y = 0.01; p.v.y *= -0.35; p.v.x *= 0.6; p.v.z *= 0.6; }
      if (p.spin) { p.m.rotation.x += p.spin.x * dt; p.m.rotation.y += p.spin.y * dt; }
      if (p.grow) p.m.scale.setScalar(p.s * (1 + k * p.grow));
      p.m.material.opacity = p.smoke ? 0.55 * (1 - k) : 1 - Math.pow(k, 3);
    }
  }
}
