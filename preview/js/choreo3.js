// 改版第二版編排 — 放慢節奏、真人多步行走、駿馬慢速奔馳、電影鏡頭與慢動作。
// 每一步棋都是一條以真實時間計時的時間軸；聲音由時間軸事件觸發，對準畫面上的接觸瞬間。
import * as THREE from 'three';
import { Clock, curves } from './timeline.js';

export const TUNE3_DEFAULTS = {
  stepSec: 0.5,     // 真人每一步的秒數
  horseRun: 1.7,    // 馬奔馳段（不含蓄勢與落地）的秒數
  slowmo: 0.35,     // 慢動作時其餘畫面的時間倍率
};
const INTENSITY = {
  fast: { time: 0.55, camera: false, slow: false, fx: 0 },
  standard: { time: 1, camera: false, slow: true, fx: 1 },
  cinematic: { time: 1, camera: true, slow: true, fx: 2 },
};

const yawTo = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** 梯形速度曲線：前 acc、後 dec 比例加減速，回傳 0..1 的位移比例 */
function trapezoid(acc, dec) {
  const vmax = 1 / (1 - acc / 2 - dec / 2);
  return k => {
    if (k < acc) return vmax * k * k / (2 * acc);
    if (k > 1 - dec) return 1 - vmax * (1 - k) * (1 - k) / (2 * dec);
    return vmax * (acc / 2 + (k - acc));
  };
}
/** 求位移曲線 f 到達 target 時的時間比例（二分搜尋） */
function invert(f, target) { let lo = 0, hi = 1; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (f(m) < target) lo = m; else hi = m; } return (lo + hi) / 2; }

function setOpacity(obj, a) {
  obj.traverse(m => {
    if (!m.isMesh && !m.isSprite) return;
    [].concat(m.material).forEach(mt => {
      if (mt.userData.o0 === undefined) { mt.userData.o0 = mt.opacity; mt.userData.t0 = mt.transparent; mt.userData.d0 = mt.depthWrite; }
      mt.transparent = a < 1 || mt.userData.t0; mt.opacity = mt.userData.o0 * a; mt.depthWrite = a >= 1 ? mt.userData.d0 : false;
    });
  });
}

export function createChoreo3(C) {
  // C：外部傳入的依賴物件 { stage, fx, sfx, timeline, states, settings, placeInGrave, setTimeScale }
  const I = () => INTENSITY[C.settings.intensity] || INTENSITY.cinematic;
  const tune = () => ({ ...TUNE3_DEFAULTS, ...(C.settings.tune3 || {}) });
  const cue = (name, at, av) => ({ at, lead: 120, av, fn: info => { if (!info.skipped) C.sfx.cue(name, info.target); } });
  const stOf = o => C.states.get(o);
  const ms = s => s * 1000;

  /* ---------- 鏡頭導演（只在電影強度使用） ---------- */
  const cam = C.stage.camera, ctrl = C.stage.controls;
  let saved = null;
  function camBegin() {
    if (saved) return;
    saved = { pos: cam.position.clone(), target: ctrl.target.clone(), minD: ctrl.minDistance };
    ctrl.enabled = false; ctrl.minDistance = 0.3;   // 否則軌道控制器會把近景拉回最小距離
  }
  /** 跟拍軌道：每格依 pose() 算出理想位置，以指數平滑追上（不受幀率影響） */
  function camFollow(at, dur, pose, stiff = 5) {
    let last = null;
    return { at, dur, fn: () => {
      camBegin();
      const now = Clock.now(), dt = last == null ? 0.016 : Math.min(0.1, (now - last) / 1000); last = now;
      const a = 1 - Math.exp(-dt * stiff), p = pose();
      cam.position.lerp(p.pos, a); ctrl.target.lerp(p.target, a);
    } };
  }
  function camRestore(at, dur) {
    let from = null;
    return { at, dur, ease: curves.inOut, fn: (k, raw) => {
      if (!saved) return;
      if (!from) from = { pos: cam.position.clone(), target: ctrl.target.clone() };
      cam.position.lerpVectors(from.pos, saved.pos, k); ctrl.target.lerpVectors(from.target, saved.target, k);
      if (raw >= 1) { ctrl.minDistance = saved.minD; ctrl.enabled = true; saved = null; }
    } };
  }
  /** 側面低角度構圖：主體在畫面中、鏡頭位在行進方向的側邊 */
  function sideShot(subject, dir, { dist = 3.0, height = 1.1, back = 0.8, lookY = 0.55 } = {}) {
    const side = new THREE.Vector3(dir.z, 0, -dir.x);
    // 優先選朝棋盤外側的那一邊（中間沒有其他棋子遮擋）；在棋盤中線附近時，改選靠近目前鏡頭的一側
    const out = side.dot(new THREE.Vector3(subject.x, 0, subject.z));
    if (Math.abs(out) > 0.6 ? out < 0 : side.dot(cam.position.clone().sub(subject)) < 0) side.negate();
    return {
      pos: subject.clone().addScaledVector(side, dist).addScaledVector(dir, -back).add(new THREE.Vector3(0, height, 0)),
      target: subject.clone().add(new THREE.Vector3(0, lookY, 0)),
    };
  }
  const slowEvents = (at, dur) => I().slow ? [
    { at, fn: () => C.setTimeScale(tune().slowmo) },
    { at: at + dur, fn: () => C.setTimeScale(1) },
  ] : [];

  /* ---------- 共用：轉身踏步、退場、落點 ---------- */
  function turnTracks(obj, st, yaw, at, sec) {
    const h = obj.userData.holder, y0 = h.rotation.y, d = angDiff(y0, yaw);
    if (Math.abs(d) < 0.1) return { tracks: [], dur: 0 };
    const dur = ms(sec * Math.min(1.4, 0.45 + Math.abs(d) * 0.35)), w0 = st.walk || 0, steps = Math.max(1, Math.round(Math.abs(d) / 1.2));
    return { dur, tracks: [{ at, dur, ease: curves.inOut, fn: k => {
      h.rotation.y = y0 + d * k;
      if (obj.userData.rig.kind === 'biped') { st.mode = 'gait'; st.amp = 0.4 * Math.sin(Math.PI * k); st.walk = w0 + k * steps * Math.PI; }
    } }] };
  }
  function exitTracks(victim, p1, dir, at) {
    const vs = stOf(victim), base = victim.quaternion.clone();
    const axis = new THREE.Vector3(dir.z, 0, -dir.x).normalize(), q = new THREE.Quaternion();
    const T = ms(0.95);
    return [{ at, dur: T, fn: (k, raw) => {
      // 先被擊退、膝蓋一軟，再往後倒下、沉入棋盤淡出
      const push = curves.out(Math.min(1, raw / 0.35)), fall = smooth(0.15, 0.85, raw);
      if (vs) { vs.mode = 'hit'; vs.act = Math.min(1, raw * 2.2); }
      victim.position.set(p1.x + dir.x * 0.5 * push, -0.18 * smooth(0.55, 1, raw), p1.z + dir.z * 0.5 * push);
      q.setFromAxisAngle(axis, -1.3 * fall); victim.quaternion.copy(base).premultiply(q);
      setOpacity(victim, 1 - smooth(0.55, 1, raw));
      if (raw >= 1) { victim.quaternion.copy(base); setOpacity(victim, 1); if (vs) { vs.mode = 'idle'; vs.act = 0; } C.placeInGrave(victim, true); }
    } }];
  }
  function landEvents(at, to, check, withPlace = true) {
    const ev = [{ at, fn: () => C.stage.setLandFrame(to.r, to.c, true) }];
    if (withPlace) ev.push(cue('place', at, 'place'));
    if (check) ev.push(cue('drum', at + 40, 'drum'), { at: at + 40, fn: () => C.stage.showSeal(check.pos, check.side) });
    return ev;
  }
  function impactFX(pos, big) {
    const lvl = I().fx, p = pos.clone(); p.y = 0.5;
    C.stage.flash.position.copy(p); C.stage.flash.intensity = big ? 18 : 12;
    if (lvl >= 1) C.fx.burst(p, { count: 18 * lvl, color: 0xffc061, speed: 2.4, size: 0.026, life: 0.6, gravity: 5 });
    if (lvl >= 1) C.fx.burst(p, { count: 8 * lvl, color: 0x6b3f22, speed: 2.0, size: 0.05, life: 1.4, gravity: 8, emissive: false, chips: true });
    if (lvl >= 2) C.fx.smoke(pos.clone().setY(0.12), { count: 12, size: 0.16 });
    C.stage.shake = lvl >= 2 ? (big ? 0.7 : 0.45) : 0;
  }

  /* ---------- 1. 人物：多步真人行走 ---------- */
  function humanWalk({ obj, p0, p1, to, check }) {
    const T0 = tune(), k = I().time, st = stOf(obj), h = obj.userData.holder;
    const D = p0.distanceTo(p1), yaw = yawTo(p0, p1);
    const n = Math.max(2, Math.round(D / 0.5));                    // 一格約兩步
    const stepMs = ms(T0.stepSec) * k;
    const turn = turnTracks(obj, st, yaw, 0, T0.stepSec * k);
    const init = 260 * k, T = n * stepMs, settle = 380 * k;       // 起步重心轉移 → 行走 → 收步回穩
    const t0 = turn.dur + init, prof = trapezoid(Math.min(0.45, 1 / n), Math.min(0.45, 1 / n));
    const w0 = Math.round((st.walk || 0) / Math.PI) * Math.PI + Math.PI / 2;   // 從雙腳併立（單腳支撐中點）起步
    st.mode = 'hold'; st.add = {};
    const tracks = [
      ...turn.tracks,
      { at: turn.dur, dur: init, ease: curves.inOut, fn: kk => { st.mode = 'hold'; st.add = { chestX: 0.1 * kk, hipsZ: 0.03 * kk, hipsY: -0.008 * kk }; } },
      { at: t0, dur: T, fn: (kk, raw) => {
        const s = prof(raw);
        obj.position.lerpVectors(p0, p1, s);
        st.mode = 'gait'; st.walk = w0 + s * n * Math.PI; st.speed = 0.5;
        st.amp = Math.min(1, smooth(0, 0.6 / n, s) + 0.15) * (1 - smooth(1 - 0.55 / n, 1, s) * 0.85);   // 起步、收步時步幅漸變
        st.add = { chestX: 0.1 * (1 - smooth(0, 0.5 / n, s)) };
      } },
      { at: t0 + T, dur: settle, ease: curves.out, fn: kk => {
        st.mode = 'hold'; const d = 1 - kk;
        st.add = { chestX: -0.05 * Math.sin(Math.PI * kk) * d, k0: 0.18 * d * d, k1: 0.18 * d * d, hipsY: -0.01 * Math.sin(Math.PI * kk) };
      } },
    ];
    const back = turnTracks(obj, st, obj.userData.baseFacing, t0 + T + settle * 0.5, T0.stepSec * k);
    tracks.push(...back.tracks.map(t => ({ ...t, fn: (kk, r) => { h.rotation.y = yaw + angDiff(yaw, obj.userData.baseFacing) * kk; st.mode = 'gait'; st.amp = 0.35 * Math.sin(Math.PI * kk); st.walk = (st.walk || 0) + 0.06; } })));
    // 每一步腳跟著地的時間點：相位越過 π 的倍數時
    const events = [];
    for (let i = 0; i < n; i++) {
      const tt = t0 + invert(prof, (i + 0.5) / n) * T;
      events.push(cue('step', tt, i === n - 1 ? 'step' : undefined), { at: tt, fn: () => { st.kick = 4 + (i === n - 1 ? 3 : 0); } });
    }
    events.push(...landEvents(t0 + T, to, check, false));
    const total = t0 + T + settle + (back.dur ? back.dur * 0.6 : 0);
    return C.timeline.play({ name: '真人行走', tracks, events, dur: total }).then(() => { st.mode = 'idle'; st.add = {}; st.amp = 1; });
  }

  /* ---------- 2. 馬：蓄勢、慢速奔馳、空中慢動作、兩拍落地 ---------- */
  function horseRun({ obj, p0, p1, to, check, curve, victim }) {
    const T0 = tune(), k = I().time, st = stOf(obj), h = obj.userData.holder;
    const P = t => { if (!curve) return new THREE.Vector3().lerpVectors(p0, p1, t); const u = 1 - t; return p0.clone().multiplyScalar(u * u).add(curve.clone().multiplyScalar(2 * u * t)).add(p1.clone().multiplyScalar(t * t)); };
    const tan = t => { const a = P(Math.max(0, t - 0.02)), b = P(Math.min(1, t + 0.02)); return Math.atan2(b.x - a.x, b.z - a.z); };
    let L = 0; { let q = P(0); for (let i = 1; i <= 24; i++) { const r = P(i / 24); L += r.distanceTo(q); q = r; } }
    const gather = 520 * k, run = ms(T0.horseRun) * k * Math.min(1.3, 0.75 + L * 0.11), land = 620 * k;
    // 位移曲線：起跑加速 → 中段空中慢動作 → 落地前減速
    const warp = r => r + 0.09 * Math.sin(2 * Math.PI * r);       // 導數在中段最小 → 視覺上懸停
    const base = trapezoid(0.22, 0.25), prof = r => Math.min(1, Math.max(0, base(warp(r))));
    const strides = Math.max(2, Math.round(L / 0.75));
    const y0 = h.rotation.y, yaw0 = tan(0.03), w0 = Math.round((st.walk || 0) / (2 * Math.PI)) * 2 * Math.PI;
    st.mode = 'hold'; st.add = {};
    const dir0 = new THREE.Vector3(Math.sin(yaw0), 0, Math.cos(yaw0));
    const tracks = [
      { at: 0, dur: gather, ease: curves.inOut, fn: kk => { // 蓄勢：轉向目標、後腿下沉、昂首
        h.rotation.y = y0 + angDiff(y0, yaw0) * kk;
        const g = Math.sin(Math.PI * Math.min(1, kk * 1.1));
        st.add = { bodyX: -0.16 * g, neckX: -0.3 * g, legs: [[-0.25 * g, -0.4 * g], [0.1 * g, 0], [0.4 * g, 0.6 * g], [0.4 * g, 0.6 * g]] };
      } },
      { at: gather, dur: run, fn: (kk, raw) => {
        const s = prof(raw), pos = P(s);
        obj.position.set(pos.x, Math.max(0, Math.sin(st.walk) * 0.05), pos.z);
        st.mode = 'gallop'; st.walk = w0 + s * strides * 2 * Math.PI;
        st.add = { bodyX: 0.06, neckX: -0.05 };
        h.rotation.y += angDiff(h.rotation.y, tan(Math.min(0.97, Math.max(0.03, s)))) * 0.25;
      } },
      { at: gather + run, dur: land, fn: kk => { // 前蹄先著地、後蹄跟上，上身前後晃回穩
        st.mode = 'hold'; obj.position.set(p1.x, 0, p1.z); const d = 1 - kk;
        st.add = { bodyX: 0.12 * d * Math.cos(kk * 9) * d, neckX: 0.25 * d * Math.sin(kk * 7), legs: [[0.25 * d, 0.1 * d], [0.25 * d, 0.1 * d], [kk < 0.25 ? -0.45 : -0.15 * d, 0.3 * d], [kk < 0.25 ? -0.45 : -0.15 * d, 0.3 * d]] };
        h.rotation.y += angDiff(h.rotation.y, obj.userData.baseFacing) * 0.08;
      } },
    ];
    // 四拍馬蹄聲：每個步幅週期四次落地（只在速度夠快時發聲，避免慢動作時過密）
    const events = [cue('hoof', gather * 0.55)];
    for (let i = 0; i < strides; i++) for (const off of [0.08, 0.6]) {
      const s = (i + off) / strides; if (s > 0.95) continue;
      events.push(cue('hoof', gather + invert(prof, s) * run));
    }
    events.push(cue('hoof', gather + run, 'hoof1'), cue('hoof', gather + run + 110 * k, 'hoof2'));
    events.push(...slowEvents(gather + run * 0.35, run * 0.35));
    events.push(...landEvents(gather + run + 110 * k, to, check, false));
    if (I().camera) {
      const mid = P(0.5);
      tracks.push(camFollow(gather * 0.3, gather * 0.7 + run + land * 0.5, () => sideShot(obj.position.clone().lerp(mid, 0.25), dir0, { dist: 2.9, height: 2.4, back: 1.2, lookY: 0.4 }), 3.2));
      tracks.push(camRestore(gather + run + land * 0.55, 900));
    }
    const total = gather + run + land + (I().camera ? 450 : 0);
    return C.timeline.play({ name: '駿馬奔馳', tracks, events, dur: total }).then(() => { st.mode = 'idle'; st.add = {}; h.rotation.y = obj.userData.baseFacing; });
  }

  /* ---------- 3. 炮吃子：放慢、弧頂懸停、命中慢動作 ---------- */
  function cannonShot({ obj, victim, screen, p0, p1, to, check }) {
    const k = I().time, st = stOf(obj), vs = stOf(victim), rig = obj.userData.rig, catapult = rig.kind === 'catapult';
    const crouch = 480 * k, glowAt = 420 * k, fire = 760 * k, flight = 950 * k, impact = fire + flight;
    const advStart = impact + 520 * k, adv = 900 * k, land = advStart + adv, total = land + 320 * k;
    const dir = p1.clone().sub(p0).setY(0).normalize(), h = obj.userData.holder, y0 = h.rotation.y, dy = angDiff(y0, yawTo(p0, p1));
    st.mode = 'hold'; st.add = {}; vs.mode = 'guard';
    const sBox = new THREE.Box3().setFromObject(screen), sPos = screen.position.clone();
    const ball = new THREE.Mesh(catapult ? new THREE.DodecahedronGeometry(0.13, 1) : new THREE.SphereGeometry(0.11, 18, 14),
      new THREE.MeshStandardMaterial({ color: catapult ? 0x9a948c : 0x3a2a22, roughness: catapult ? 0.9 : 0.35, metalness: catapult ? 0 : 0.6, emissive: catapult ? 0x2a2014 : 0xff5a10, emissiveIntensity: catapult ? 1 : 1.5 }));
    ball.castShadow = true; ball.visible = false; C.stage.scene.add(ball);
    const streak = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.075, 1, 10, 1, true), new THREE.MeshBasicMaterial({ color: catapult ? 0xe8dcc0 : 0xffb050, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
    streak.visible = false; C.stage.scene.add(streak);
    const from = new THREE.Vector3(), target = p1.clone().setY(0.5), prev = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    let H = 1;
    const glow = C.stage.makeBaseGlow(sPos);
    const arcWarp = r => r - 0.12 * Math.sin(2 * Math.PI * r) / (2 * Math.PI) * 2.4;   // 弧頂附近放慢
    const tracks = [
      { at: 0, dur: crouch, ease: curves.inOut, fn: kk => { h.rotation.y = y0 + dy * kk;
        st.add = catapult ? { bodyY: -0.06 * kk, arm: 0.32 * kk, bodyX: -0.07 * kk } : { bodyY: -0.065 * kk, pitch: -0.3 * kk, bodyX: -0.08 * kk }; } },
      { at: glowAt, dur: 420 * k, fn: kk => { const b = kk < 0.3 ? kk / 0.3 : (1 - kk) / 0.7; glow.material.opacity = b; glow.scale.setScalar(0.85 + 0.3 * kk); if (kk >= 1) C.stage.removeBaseGlow(glow); } },
      { at: fire, dur: 260 * k, ease: curves.out, fn: kk => { const r = Math.sin(Math.PI * kk);
        st.add = catapult ? { bodyY: -0.06 * (1 - kk), arm: 0.32 - 2.0 * Math.min(1, kk * 1.5), bodyX: 0.07 * r } : { bodyY: -0.065 * (1 - kk), pitch: -0.3 * (1 - kk), recoil: 0.1 * r, bodyX: -0.08 * (1 - kk) + 0.05 * r }; } },
      { at: fire, dur: flight, fn: kk => {
        if (!ball.visible) {
          (catapult ? rig.stone : rig.muzzle).getWorldPosition(from); if (catapult) rig.stoneFired = true;
          const fs = Math.min(0.92, Math.max(0.08, from.distanceTo(sPos) / from.distanceTo(target)));
          H = Math.max(1.0, (sBox.max.y + 0.3 - (from.y + (target.y - from.y) * fs)) / Math.sin(Math.PI * fs));
          ball.visible = true; prev.copy(from);
          if (!catapult) { C.stage.flash.position.copy(from); C.stage.flash.intensity = 8; C.fx.smoke(from.clone(), { count: 6 + 4 * I().fx, size: 0.09, life: 1.4 }); }
        }
        const u = Math.min(1, Math.max(0, arcWarp(kk)));
        ball.position.lerpVectors(from, target, u); ball.position.y += Math.sin(Math.PI * u) * H; ball.rotation.x += 0.2;
        const v = ball.position.clone().sub(prev);
        if (v.lengthSq() > 1e-7) { streak.visible = true; streak.scale.set(1, 0.5, 1); streak.quaternion.setFromUnitVectors(up, v.normalize().negate()); streak.position.copy(ball.position).addScaledVector(v, 0.25); }
        prev.copy(ball.position);
        C.fx.burst(ball.position, { count: 2, color: catapult ? 0xcabda2 : 0xffa040, speed: 0.12, size: 0.05, life: 0.35, gravity: 0, emissive: true });
        if (kk >= 1) [ball, streak].forEach(o => { C.stage.scene.remove(o); o.geometry.dispose(); o.material.dispose(); });
      } },
      ...exitTracks(victim, p1, dir, impact),
      { at: advStart, dur: adv, fn: (kk, raw) => {
        const s = trapezoid(0.35, 0.3)(raw);
        obj.position.lerpVectors(p0, p1, s); st.dist = (st.d0 ??= st.dist || 0) + s * p0.distanceTo(p1);
        const brake = raw > 0.7 ? Math.sin(Math.PI * (raw - 0.7) / 0.3) : 0;
        st.add = { bodyX: 0.07 * brake };
        if (raw >= 1) st.d0 = undefined;
      } },
      { at: land, dur: 320 * k, fn: kk => { st.add = { bodyX: -0.04 * Math.sin(Math.PI * kk) * (1 - kk) }; } },
    ];
    if (Math.abs(dy) > 0.1) tracks.push({ at: land + 60, dur: 420 * k, ease: curves.inOut, fn: kk => { h.rotation.y = y0 + dy * (1 - kk); } });
    if (I().camera) {   // 鏡頭：開場全盤 → 發射後側拍追著砲彈 → 命中特寫 → 拉回全盤看炮進占
      const midTS = sPos.clone().lerp(p1, 0.55);
      tracks.push(camFollow(fire, flight * 0.75, () => sideShot(midTS, dir, { dist: 4.2, height: 1.6, back: 0.4, lookY: 0.7 }), 2.2));
      tracks.push(camFollow(fire + flight * 0.75, flight * 0.25 + 520 * k, () => sideShot(p1, dir, { dist: 2.7, height: 1.9, back: 0.8, lookY: 0.45 }), 4.5));
      tracks.push(camRestore(impact + 560 * k, 1000));
    }
    const events = [
      cue('mech', 200 * k, 'mech'),
      cue('impact', impact, 'impact'),
      { at: impact, fn: () => impactFX(p1, true) },
      ...slowEvents(impact, 520 * k),
      ...landEvents(land, to, check),
    ];
    return C.timeline.play({ name: '炮吃子（第二版）', tracks, events, dur: total }).then(() => { st.mode = 'idle'; st.add = {}; });
  }

  /* ---------- 4. 近身吃子：逼近、蓄力、慢動作出擊、對手屈膝倒下 ---------- */
  function meleeCapture(info) {
    const { obj, victim, p0, p1, to, check, curve } = info;
    const k = I().time, st = stOf(obj), vs = stOf(victim), rig = obj.userData.rig, h = obj.userData.holder;
    const dir = p1.clone().sub(p0).setY(0).normalize(), stopAt = p1.clone().addScaledVector(dir, -0.45);
    const D = p0.distanceTo(stopAt), y0 = h.rotation.y, yaw = yawTo(p0, p1), dy = angDiff(y0, yaw);
    const human = rig.kind === 'biped', horse = rig.kind === 'quad' && rig.role !== 'elephant';
    const turn = Math.abs(dy) > 0.1 ? 420 * k : 0;
    const n = Math.max(1, Math.round(D / 0.5)), approach = D > 0.05 ? (human ? n * ms(tune().stepSec) * 0.8 : 450 + D * 260) * k : 0;
    const windup = 520 * k, strike = 200 * k, impact = turn + approach + windup + strike;
    const occupy = 900 * k, total = impact + 650 * k + occupy;
    st.mode = 'hold'; vs.mode = 'guard';
    const w0 = Math.round((st.walk || 0) / Math.PI) * Math.PI + Math.PI / 2;
    const prof = trapezoid(0.3, 0.35);
    const tracks = [
      ...(turn ? [{ at: 0, dur: turn, ease: curves.inOut, fn: kk => { h.rotation.y = y0 + dy * kk; if (human) { st.mode = 'gait'; st.amp = 0.4 * Math.sin(Math.PI * kk); st.walk = w0 + kk * Math.PI; } } }] : []),
      ...(approach ? [{ at: turn, dur: approach, fn: (kk, raw) => {
        const s = prof(raw);
        if (curve) { const q = 1 - s; obj.position.copy(p0.clone().multiplyScalar(q * q).add(curve.clone().multiplyScalar(2 * q * s)).add(stopAt.clone().multiplyScalar(s * s))); }
        else obj.position.lerpVectors(p0, stopAt, s);
        if (human) { st.mode = 'gait'; st.speed = 0.8; st.walk = w0 + s * n * Math.PI; st.amp = 1 - smooth(0.8, 1, s) * 0.7; }
        else { st.mode = horse ? 'gallop' : 'walk'; st.walk = (st.walk || 0) + 0.18; st.dist = (st.d0 ??= st.dist || 0) + s * D; if (raw >= 1) st.d0 = undefined; }
      } }] : []),
      { at: turn + approach, dur: windup, ease: curves.out, fn: kk => { st.mode = 'windup'; st.act = kk; st.add = {}; } },
      { at: turn + approach + windup, dur: strike, ease: curves.in, fn: kk => { st.mode = 'strike'; st.act = kk; } },
      ...exitTracks(victim, p1, dir, impact),
      { at: impact + 250 * k, dur: 400 * k, ease: curves.inOut, fn: kk => { st.mode = 'strike'; st.act = 1 - kk; } },
      { at: impact + 650 * k, dur: occupy, fn: (kk, raw) => {   // 走進目標格
        const s = trapezoid(0.4, 0.45)(raw); obj.position.lerpVectors(stopAt, p1, s);
        if (human) { st.mode = 'gait'; st.act = 0; st.walk = w0 + n * Math.PI + s * Math.PI; st.amp = Math.sin(Math.PI * s) * 0.8; }
        else { st.mode = horse ? 'walk' : 'hold'; st.walk = (st.walk || 0) + 0.08; }
      } },
      { at: total - 80, dur: 520 * k, ease: curves.inOut, fn: kk => { st.mode = 'hold'; h.rotation.y = yaw + angDiff(yaw, obj.userData.baseFacing) * kk; } },
    ];
    if (I().camera) {
      const mid = stopAt.clone().lerp(p1, 0.5);
      tracks.push(camFollow(turn + approach * 0.4, approach * 0.6 + windup + strike + 600 * k, () => sideShot(mid, dir, { dist: 2.6, height: 1.9, back: 0.5, lookY: 0.5 }), 3));
      tracks.push(camRestore(impact + 700 * k, 1000));
    }
    const events = [
      cue('impact', impact, 'impact'), { at: impact, fn: () => impactFX(p1, false) },
      ...slowEvents(impact - 60 * k, 600 * k),
      ...landEvents(impact + 650 * k + occupy, to, check),
    ];
    if (human) for (let i = 0; i < n && approach; i++) events.push(cue('step', turn + invert(prof, (i + 0.5) / n) * approach));
    return C.timeline.play({ name: '近身吃子', tracks, events, dur: total }).then(() => { st.mode = 'idle'; st.add = {}; st.act = 0; });
  }

  /* ---------- 5. 象：沉重緩步 ---------- */
  function elephantWalk({ obj, p0, p1, to, check }) {
    const k = I().time, st = stOf(obj), h = obj.userData.holder, D = p0.distanceTo(p1), yaw = yawTo(p0, p1);
    const turn = turnTracks(obj, st, yaw, 0, 0.6 * k), T = (1300 + D * 300) * k, beats = Math.max(4, Math.round(D * 1.6));
    const w0 = Math.round((st.walk || 0) / Math.PI) * Math.PI, prof = trapezoid(0.3, 0.3);
    const tracks = [...turn.tracks.map(t => ({ ...t, fn: kk => { h.rotation.y = h.rotation.y + angDiff(h.rotation.y, yaw) * 0.2; st.mode = 'walk'; st.walk = w0 + kk * Math.PI; } })),
      { at: turn.dur, dur: T, fn: (kk, raw) => { const s = prof(raw); obj.position.lerpVectors(p0, p1, s); st.mode = 'walk'; st.walk = w0 + Math.PI + s * beats * Math.PI / 2; st.add = { bodyZ: Math.sin(st.walk) * 0.025 }; } },
      { at: turn.dur + T, dur: 700 * k, ease: curves.inOut, fn: kk => { st.mode = 'hold'; h.rotation.y = yaw + angDiff(yaw, obj.userData.baseFacing) * kk; st.add = {}; } }];
    const events = [];
    for (let i = 0; i < beats; i++) events.push(cue('stomp', turn.dur + invert(prof, (i + 0.5) / beats) * T));
    events.push(...landEvents(turn.dur + T, to, check, false));
    return C.timeline.play({ name: '象', tracks, events, dur: turn.dur + T + 500 * k }).then(() => { st.mode = 'idle'; st.add = {}; });
  }

  /* ---------- 6. 車與砲車：起步加速、煞停揚塵 ---------- */
  function wheeled({ obj, p0, p1, to, check }) {
    const k = I().time, st = stOf(obj), rig = obj.userData.rig, h = obj.userData.holder, D = p0.distanceTo(p1), yaw = yawTo(p0, p1);
    const dy = angDiff(h.rotation.y, yaw), y0 = h.rotation.y, turn = Math.abs(dy) > 0.1 ? 600 * k : 0;
    const heavy = rig.kind !== 'chariot', T = (heavy ? 900 + D * 380 : 700 + D * 200) * k;
    const prof = trapezoid(heavy ? 0.4 : 0.45, 0.25), d0 = st.dist || 0;
    const tracks = [
      ...(turn ? [{ at: 0, dur: turn, ease: curves.inOut, fn: kk => { h.rotation.y = y0 + dy * kk; st.mode = rig.horse ? 'walk' : 'hold'; st.walk = (st.walk || 0) + 0.05; } }] : []),
      { at: turn, dur: T, fn: (kk, raw) => {
        const s = prof(raw); obj.position.lerpVectors(p0, p1, s); st.dist = d0 + s * D;
        st.mode = rig.horse ? 'gallop' : 'walk'; st.walk = (st.walk || 0) + (rig.horse ? 0.22 : 0.12);
        const brake = raw > 0.75 ? Math.sin(Math.PI * (raw - 0.75) / 0.25) : 0;
        st.add = { bodyX: -0.04 * (raw < 0.4 ? raw / 0.4 : 0) + 0.1 * brake };
      } },
      { at: turn + T, dur: 650 * k, ease: curves.inOut, fn: kk => { st.mode = 'hold'; st.add = {}; if (turn) h.rotation.y = yaw + angDiff(yaw, obj.userData.baseFacing) * kk; } },
    ];
    if (I().camera && D >= 3) {
      const d3 = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      tracks.push(camFollow(turn, T * 0.9, () => sideShot(obj.position.clone(), d3, { dist: 3.4, height: 1.3, back: 1.2 }), 3));
      tracks.push(camRestore(turn + T, 900));
    }
    const events = [cue('roll', turn), cue('brake', turn + T * 0.76), { at: turn + T * 0.85, fn: () => { if (I().fx) C.fx.burst(p1.clone().setY(0.05), { count: 10, color: 0xb59a74, speed: 0.8, size: 0.03, life: 0.9, gravity: 1.5, emissive: false }); } }, ...landEvents(turn + T, to, check)];
    return C.timeline.play({ name: rig.kind === 'chariot' ? '戰車' : '砲車', tracks, events, dur: turn + T + 400 * k }).then(() => { st.mode = 'idle'; st.add = {}; });
  }

  return {
    play(info) {
      const rig = info.obj.userData.rig;
      if (info.victim) {
        if ((rig.kind === 'cannon' || rig.kind === 'catapult') && info.screen) return cannonShot(info);
        return meleeCapture(info);
      }
      if (rig.kind === 'biped') return humanWalk(info);
      if (rig.kind === 'quad') return rig.role === 'elephant' ? elephantWalk(info) : horseRun(info);
      return wheeled(info);
    },
  };
}
