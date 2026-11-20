// 改版編排 (v2 choreography) — every move is one wall-clock timeline whose events drive the sounds.
// Standard framing never moves the camera: the whole board stays in view.
import * as THREE from 'three';
import { curves } from './timeline.js';

export const TUNE_DEFAULTS = {
  cannonTotal: 600,  // 炮吃馬整段
  crouch: 110,       // 炮身壓低
  flight: 180,       // 短弧飛行
  stepTotal: 260,    // 普通一步（220–300）
  leanFrac: 0.23,    // 重心前傾佔比
};
const INTENSITY = {
  fast: { time: 0.82, fx: 0, shake: 0 },
  standard: { time: 1, fx: 1, shake: 0 },
  cinematic: { time: 1, fx: 2, shake: 0.35 },
};

const yawTo = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const bell = (k, peak = 0.25) => (k < peak ? k / peak : Math.max(0, (1 - k) / (1 - peak)));

function setOpacity(obj, a) {
  obj.traverse(m => {
    if (!m.isMesh && !m.isSprite) return;
    [].concat(m.material).forEach(mt => {
      if (mt.userData.o0 === undefined) { mt.userData.o0 = mt.opacity; mt.userData.t0 = mt.transparent; mt.userData.d0 = mt.depthWrite; }
      mt.transparent = a < 1 || mt.userData.t0; mt.opacity = mt.userData.o0 * a; mt.depthWrite = a >= 1 ? mt.userData.d0 : false;
    });
  });
}

export function createChoreo(C) {
  // C: { stage, fx, sfx, timeline, states, settings, placeInGrave, cellPos }
  const I = () => INTENSITY[C.settings.intensity] || INTENSITY.standard;
  const tune = () => ({ ...TUNE_DEFAULTS, ...(C.settings.tune || {}) });
  const cue = (name, av) => ({ lead: 120, av, fn: info => { if (!info.skipped) C.sfx.cue(name, info.target); } });
  const stOf = o => C.states.get(o);

  /* ---------- shared pieces of the rhythm ---------- */
  function exitTracks(victim, p1, dir, at) {
    const base = victim.quaternion.clone(), axis = new THREE.Vector3(dir.z, 0, -dir.x).normalize(); // tip away from the attacker
    const q = new THREE.Quaternion();
    return [{
      at, dur: 240, ease: curves.out,
      fn: (k, raw) => {
        victim.position.set(p1.x + dir.x * 0.45 * k, -0.12 * raw * raw, p1.z + dir.z * 0.45 * k);
        q.setFromAxisAngle(axis, -1.05 * k); victim.quaternion.copy(base).premultiply(q);
        setOpacity(victim, Math.max(0, 1 - Math.pow(raw, 1.4)));
        if (raw >= 1) { victim.quaternion.copy(base); setOpacity(victim, 1); stOf(victim) && (stOf(victim).mode = 'idle'); C.placeInGrave(victim, true); }
      },
    }];
  }
  function landEvents(at, to, check) {
    const ev = [cue('place', 'place'), { at, fn: () => C.stage.setLandFrame(to.r, to.c, true) }];
    ev[0].at = at;
    if (check) ev.push({ at: at + 30, ...cue('drum', 'drum') }, { at: at + 30, fn: () => C.stage.showSeal(check.pos, check.side) });
    return ev;
  }
  function impactFX(pos, dir) {
    const lvl = I().fx, p = pos.clone(); p.y = 0.45;
    C.stage.flash.position.copy(p); C.stage.flash.intensity = lvl ? 12 : 8;
    if (lvl >= 1) C.fx.burst(p, { count: 14 * lvl, color: 0xffc061, speed: 2.6, size: 0.025, life: 0.45, gravity: 6 });
    if (lvl >= 2) { C.fx.smoke(pos.clone().setY(0.1), { count: 8, size: 0.12 }); C.fx.burst(p, { count: 10, color: 0x6b3f22, speed: 2.2, size: 0.05, life: 1.2, gravity: 9, emissive: false, chips: true }); }
    C.stage.shake = I().shake;
  }

  /* ---------- 1. 炮吃子：招牌動作 ---------- */
  function cannonCapture({ obj, victim, screen, p0, p1, to, check }) {
    const T0 = tune(), k = I().time;
    const total = T0.cannonTotal * k, crouch = T0.crouch * k, fireAt = crouch + 40 * k, flight = T0.flight * k;
    const impact = fireAt + flight, advStart = impact + 50 * k, land = Math.max(advStart + 110 * k, total - 20 * k);
    const st = stOf(obj), vs = stOf(victim), rig = obj.userData.rig, catapult = rig.kind === 'catapult';
    const dir = p1.clone().sub(p0).setY(0).normalize();
    st.mode = 'hold'; st.add = {}; vs.mode = 'hold';
    const h = obj.userData.holder, y0 = h.rotation.y, dy = angDiff(y0, yawTo(p0, p1));
    // projectile over the screen ("炮架")
    const sBox = new THREE.Box3().setFromObject(screen), sPos = screen.position.clone();
    const ball = new THREE.Mesh(catapult ? new THREE.DodecahedronGeometry(0.12, 1) : new THREE.SphereGeometry(0.11, 16, 12),
      new THREE.MeshStandardMaterial({ color: catapult ? 0x9a948c : 0x3a2a22, roughness: catapult ? 0.9 : 0.35, metalness: catapult ? 0 : 0.6, emissive: catapult ? 0x3a2a14 : 0xff5a10, emissiveIntensity: catapult ? 1 : 1.6 }));
    // short glowing streak behind the shot so the arc reads on a phone
    const streak = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.07, 1, 10, 1, true), new THREE.MeshBasicMaterial({ color: catapult ? 0xe8dcc0 : 0xffb050, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending }));
    streak.visible = false; C.stage.scene.add(streak);
    const prevPos = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    ball.castShadow = true; ball.visible = false; C.stage.scene.add(ball);
    const from = new THREE.Vector3(), target = p1.clone().setY(0.42);
    let H = 1;
    const glow = C.stage.makeBaseGlow(sPos);
    const tracks = [
      { at: 0, dur: crouch, ease: curves.out, fn: kk => { // 壓低炮身 (and swing onto the target line)
        h.rotation.y = y0 + dy * kk;
        st.add = catapult ? { bodyY: -0.06 * kk, arm: 0.3 * kk, bodyX: -0.07 * kk } : { bodyY: -0.065 * kk, pitch: -0.3 * kk, bodyX: -0.08 * kk };
      } },
      { at: crouch - 10 * k, dur: 160 * k, fn: kk => { const b = bell(kk, 0.22); glow.material.opacity = b; glow.scale.setScalar(0.85 + 0.25 * kk); if (kk >= 1) C.stage.removeBaseGlow(glow); } },
      { at: fireAt, dur: 130 * k, ease: curves.out, fn: kk => { // 發射：後座 / 投臂
        const r = Math.sin(Math.PI * kk);
        st.add = catapult ? { bodyY: -0.06 * (1 - kk), arm: 0.3 - 2.0 * Math.min(1, kk * 1.6), bodyX: 0.06 * r } : { bodyY: -0.065 * (1 - kk), pitch: -0.3 * (1 - kk), recoil: 0.09 * r, bodyX: -0.08 * (1 - kk) + 0.04 * r };
      } },
      { at: fireAt, dur: flight, fn: (kk) => { // 短弧越過炮架
        if (!ball.visible) {
          (catapult ? rig.stone : rig.muzzle).getWorldPosition(from); if (catapult) rig.stoneFired = true;
          const fs = Math.min(0.92, Math.max(0.08, from.distanceTo(sPos) / from.distanceTo(target)));
          H = Math.max(0.7, (sBox.max.y + 0.22 - (from.y + (target.y - from.y) * fs)) / Math.sin(Math.PI * fs));
          ball.visible = true;
          if (!catapult) { C.stage.flash.position.copy(from); C.stage.flash.intensity = 5; if (I().fx) C.fx.smoke(from.clone(), { count: 4 * I().fx, size: 0.07, life: 0.8 }); }
        }
        if (!streak.visible) prevPos.copy(from);
        ball.position.lerpVectors(from, target, kk); ball.position.y += Math.sin(Math.PI * kk) * H;
        ball.rotation.x += 0.3;
        const v = ball.position.clone().sub(prevPos);
        if (v.lengthSq() > 1e-6) { // streak points back along the flight path
          const len = 0.45; streak.visible = true; streak.scale.set(1, len, 1);
          streak.quaternion.setFromUnitVectors(up, v.normalize().negate());
          streak.position.copy(ball.position).addScaledVector(v, len / 2);
        }
        prevPos.copy(ball.position);
        C.fx.burst(ball.position, { count: 2, color: catapult ? 0xcabda2 : 0xffa040, speed: 0.12, size: 0.05, life: 0.25, gravity: 0, emissive: true });
        if (kk >= 1) { [ball, streak].forEach(o => { C.stage.scene.remove(o); o.geometry.dispose(); o.material.dispose(); }); }
      } },
      ...exitTracks(victim, p1, dir, impact),
      { at: advStart, dur: land - advStart, ease: curves.inOut, fn: (kk, raw) => { // 進占目標格
        obj.position.lerpVectors(p0, p1, kk); st.dist = (st.dist0 ??= st.dist || 0) + kk * p0.distanceTo(p1);
        const brake = raw > 0.7 ? Math.sin(Math.PI * (raw - 0.7) / 0.3) : 0;
        st.add = { bodyX: 0.06 * brake, bodyY: 0 };
        if (raw >= 1) st.dist0 = undefined;
      } },
      { at: land, dur: Math.max(20, total - land) + 90 * k, fn: kk => { st.add = { bodyX: -0.03 * Math.sin(Math.PI * kk) * (1 - kk) }; } },
    ];
    if (Math.abs(dy) > 0.1) tracks.push({ at: land + 40, dur: 160, ease: curves.inOut, fn: kk => { h.rotation.y = y0 + dy * (1 - kk); } });
    const events = [
      { at: 45 * k, ...cue('mech', 'mech') },
      { at: impact, ...cue('impact', 'impact') },
      { at: impact, fn: () => impactFX(p1, dir) },
      ...landEvents(land, to, check),
    ];
    return C.timeline.play({ name: '炮吃子', tracks, events, dur: total }).then(() => { st.mode = 'idle'; st.add = {}; });
  }

  /* ---------- 2. 普通走子：有重量的一步 ---------- */
  function bipedStep({ obj, p0, p1, to, check }) {
    const T0 = tune(), dist = p0.distanceTo(p1), k = I().time;
    const T = Math.max(220, Math.min(650, (T0.stepTotal + (dist - 1) * 90) * k));
    const lean = T * T0.leanFrac, contact = T * 0.8, n = Math.max(1, Math.round(dist));
    const st = stOf(obj), h = obj.userData.holder, y0 = h.rotation.y, yaw = yawTo(p0, p1), dy = angDiff(y0, yaw);
    const dir = p1.clone().sub(p0).setY(0).normalize(), pre = p0.clone().addScaledVector(dir, 0.04);
    const w0 = Math.round((st.walk || 0) / Math.PI) * Math.PI;
    st.mode = 'hold'; st.add = {};
    const tracks = [
      { at: 0, dur: lean, ease: curves.inOut, fn: kk => { // 重心先往前
        st.add = { chestX: 0.3 * kk, hipsY: -0.012 * kk, headX: -0.08 * kk };
        obj.position.lerpVectors(p0, pre, kk); h.rotation.y = y0 + dy * kk;
      } },
      { at: lean, dur: contact - lean, ease: curves.inOut, fn: (kk) => { // 腳才踏出去
        st.mode = 'walk'; st.speed = 1; st.amp = 1.15; st.walk = w0 + kk * n * Math.PI;
        st.add = { chestX: 0.3 - 0.12 * kk, headX: -0.08 * (1 - kk) };
        obj.position.lerpVectors(pre, p1, kk);
      } },
      { at: contact, dur: T - contact + 60, fn: kk => { // 接地：膝蓋吸收、上身回穩
        st.mode = 'hold'; const d = 1 - kk;
        st.add = { chestX: 0.18 * Math.cos(kk * Math.PI * 1.25) * d, hipsY: -0.016 * Math.sin(Math.PI * Math.min(1, kk * 1.6)), k0: 0.28 * d, k1: 0.28 * d };
      } },
    ];
    const turnBack = Math.abs(angDiff(yaw, obj.userData.baseFacing)) > 0.1;
    if (turnBack) tracks.push({ at: T + 40, dur: 160, ease: curves.inOut, fn: kk => { h.rotation.y = yaw + angDiff(yaw, obj.userData.baseFacing) * kk; } });
    const events = [
      { at: contact, ...cue('step', 'step') },
      { at: contact, fn: () => { st.kick = 7; if (I().fx) C.fx.burst(p1.clone().setY(0.03), { count: 4, color: 0xb59a74, speed: 0.35, size: 0.02, life: 0.5, gravity: 1.2, emissive: false }); } },
      ...landEvents(contact, to, check).filter(e => !e.av), // the step is the only sound of a plain move
    ];
    if (check) events.push({ at: contact + 30, ...cue('drum', 'drum') });
    return C.timeline.play({ name: '一步', tracks, events, dur: turnBack ? T + 200 : T }).then(() => { st.mode = 'idle'; st.add = {}; st.amp = 1; st.speed = 0; });
  }

  // 馬：蹬地 → 騰起 → 前蹄、後蹄兩拍落地
  function horseLeap({ obj, p0, p1, to, check, curve }) {
    const k = I().time, T = 440 * k, push = 0.2 * T, front = 0.7 * T, hind = 0.82 * T;
    const st = stOf(obj), h = obj.userData.holder, y0 = h.rotation.y;
    const P = t => { if (!curve) return new THREE.Vector3().lerpVectors(p0, p1, t); const u = 1 - t; return p0.clone().multiplyScalar(u * u).add(curve.clone().multiplyScalar(2 * u * t)).add(p1.clone().multiplyScalar(t * t)); };
    const tan = t => { const a = P(Math.max(0, t - 0.02)), b = P(Math.min(1, t + 0.02)); return Math.atan2(b.x - a.x, b.z - a.z); };
    const yaw0 = tan(0.03), w0 = Math.round((st.walk || 0) / Math.PI) * Math.PI;
    st.mode = 'hold';
    const tracks = [
      { at: 0, dur: push, ease: curves.inOut, fn: kk => { h.rotation.y = y0 + angDiff(y0, yaw0) * kk; st.add = { bodyX: -0.12 * kk, legs: [[-0.2 * kk, -0.3 * kk], [-0.2 * kk, -0.3 * kk], [0.35 * kk, 0.5 * kk], [0.35 * kk, 0.5 * kk]] }; } },
      { at: push, dur: front - push, ease: curves.linear, fn: kk => {
        st.mode = 'gallop'; st.walk = w0 + kk * 2 * Math.PI; st.add = { bodyX: -0.12 * (1 - kk) + 0.08 * kk };
        const pos = P(curves.inOut(kk)); obj.position.set(pos.x, Math.sin(Math.PI * kk) * 0.16, pos.z);
        h.rotation.y += angDiff(h.rotation.y, tan(Math.min(0.97, Math.max(0.03, kk)))) * 0.4;
      } },
      { at: front, dur: T - front + 80, fn: kk => { st.mode = 'hold'; obj.position.set(p1.x, 0, p1.z); const d = 1 - kk; st.add = { bodyX: 0.08 * d * Math.cos(kk * 4), legs: [[0.15 * d, 0], [0.15 * d, 0], [kk < 0.3 ? -0.3 : -0.1 * d, 0.2 * d], [kk < 0.3 ? -0.3 : -0.1 * d, 0.2 * d]] }; h.rotation.y += angDiff(h.rotation.y, obj.userData.baseFacing) * 0.18; } },
    ];
    const events = [
      { at: front, ...cue('hoof', 'hoof1') }, { at: hind, ...cue('hoof', 'hoof2') },
      { at: front, fn: () => C.stage.setLandFrame(to.r, to.c, true) },
    ];
    if (check) events.push({ at: hind + 30, ...cue('drum', 'drum') }, { at: hind + 30, fn: () => C.stage.showSeal(check.pos, check.side) });
    return C.timeline.play({ name: '馬', tracks, events, dur: T + 80 }).then(() => { st.mode = 'idle'; st.add = {}; h.rotation.y = obj.userData.baseFacing; });
  }

  // 車 / 砲車：直線加速、煞停
  function wheeledRun({ obj, p0, p1, to, check }) {
    const k = I().time, dist = p0.distanceTo(p1), T = Math.min(700, 230 + dist * 60) * k, brakeAt = 0.72 * T;
    const st = stOf(obj), h = obj.userData.holder, y0 = h.rotation.y, yaw = yawTo(p0, p1), dy = angDiff(y0, yaw), turn = Math.abs(dy) > 0.1 ? 120 * k : 0;
    const d0 = st.dist || 0;
    const prof = r => (r < 0.72 ? 0.8 * (r / 0.72) * (r / 0.72) : 0.8 + 0.2 * (1 - Math.pow(1 - (r - 0.72) / 0.28, 2)));
    st.mode = 'hold';
    const tracks = [
      ...(turn ? [{ at: 0, dur: turn, ease: curves.inOut, fn: kk => { h.rotation.y = y0 + dy * kk; } }] : []),
      { at: turn, dur: T, fn: (kk, raw) => {
        const u = prof(raw); obj.position.lerpVectors(p0, p1, u); st.dist = d0 + u * dist;
        st.mode = st.add && obj.userData.rig.horse ? 'gallop' : 'hold'; st.walk = (st.walk || 0) + 0.25;
        const brake = raw > 0.72 ? Math.sin(Math.PI * (raw - 0.72) / 0.28) : 0;
        st.add = { bodyX: -0.04 * (raw < 0.72 ? raw / 0.72 : 0) + 0.09 * brake };
      } },
      ...(turn ? [{ at: turn + T + 30, dur: 140, ease: curves.inOut, fn: kk => { h.rotation.y = yaw + angDiff(yaw, obj.userData.baseFacing) * kk; } }] : []),
    ];
    const events = [{ at: turn, ...cue('roll') }, { at: turn + brakeAt, ...cue('brake') }, ...landEvents(turn + T, to, check)];
    return C.timeline.play({ name: '車', tracks, events, dur: turn + T + (turn ? 170 : 40) }).then(() => { st.mode = 'idle'; st.add = {}; });
  }

  // 象：沉重兩步
  function heavyWalk({ obj, p0, p1, to, check }) {
    const k = I().time, T = 420 * k, st = stOf(obj), h = obj.userData.holder, y0 = h.rotation.y, yaw = yawTo(p0, p1), dy = angDiff(y0, yaw);
    const w0 = Math.round((st.walk || 0) / Math.PI) * Math.PI;
    st.mode = 'hold';
    const tracks = [
      { at: 0, dur: 110 * k, ease: curves.inOut, fn: kk => { h.rotation.y = y0 + dy * kk; st.add = { bodyX: 0.04 * kk }; } },
      { at: 110 * k, dur: T - 110 * k, ease: curves.inOut, fn: kk => { st.mode = 'walk'; st.walk = w0 + kk * 2 * Math.PI; obj.position.lerpVectors(p0, p1, kk); st.add = { bodyX: 0.04 * (1 - kk) }; } },
      { at: T, dur: 180, ease: curves.inOut, fn: kk => { st.mode = 'hold'; h.rotation.y = yaw + angDiff(yaw, obj.userData.baseFacing) * kk; } },
    ];
    const events = [{ at: T * 0.55, ...cue('stomp') }, { at: T, ...cue('stomp') }, ...landEvents(T, to, check).filter(e => !e.av)];
    if (check) events.push({ at: T + 30, ...cue('drum', 'drum') });
    return C.timeline.play({ name: '象', tracks, events, dur: T + 180 }).then(() => { st.mode = 'idle'; st.add = {}; });
  }

  /* ---------- melee capture (shares the 600 ms rhythm: approach → strike → exit → occupy) ---------- */
  function meleeCapture({ obj, victim, p0, p1, to, check, curve }) {
    const k = I().time, total = 600 * k, dashEnd = 280 * k, impact = 330 * k, land = total - 20 * k;
    const st = stOf(obj), vs = stOf(victim), h = obj.userData.holder, y0 = h.rotation.y, yaw = yawTo(p0, p1), dy = angDiff(y0, yaw);
    const dir = p1.clone().sub(p0).setY(0).normalize(), stopAt = p1.clone().addScaledVector(dir, -0.42);
    const w0 = Math.round((st.walk || 0) / Math.PI) * Math.PI, gait = obj.userData.rig.kind === 'quad' && obj.userData.rig.role !== 'elephant' ? 'gallop' : 'walk';
    st.mode = 'hold'; vs.mode = 'guard';
    const tracks = [
      { at: 0, dur: 80 * k, ease: curves.inOut, fn: kk => { h.rotation.y = y0 + dy * kk; st.add = { chestX: 0.3 * kk, bodyX: -0.06 * kk }; } },
      { at: 80 * k, dur: dashEnd - 80 * k, ease: curves.in, fn: kk => {
        st.mode = gait; st.speed = 1; st.walk = w0 + kk * Math.max(1, Math.round(p0.distanceTo(stopAt) * 1.2)) * Math.PI; st.add = { chestX: 0.2 };
        const u = kk; if (curve) { const q = 1 - u; obj.position.copy(p0.clone().multiplyScalar(q * q).add(curve.clone().multiplyScalar(2 * q * u)).add(stopAt.clone().multiplyScalar(u * u))); } else obj.position.lerpVectors(p0, stopAt, u);
      } },
      { at: dashEnd - 60 * k, dur: 60 * k, fn: kk => { st.mode = 'windup'; st.act = kk; st.add = {}; } },
      { at: dashEnd, dur: impact - dashEnd, ease: curves.in, fn: kk => { st.mode = 'strike'; st.act = kk; } },
      ...exitTracks(victim, p1, dir, impact),
      { at: impact + 60 * k, dur: land - impact - 60 * k, ease: curves.inOut, fn: kk => { st.mode = 'walk'; st.act = 0; st.walk = w0 + 4 * Math.PI + kk * Math.PI; obj.position.lerpVectors(stopAt, p1, kk); } },
      { at: land, dur: 180, ease: curves.inOut, fn: kk => { st.mode = 'hold'; h.rotation.y = yaw + angDiff(yaw, obj.userData.baseFacing) * kk; } },
    ];
    const events = [{ at: impact, ...cue('impact', 'impact') }, { at: impact, fn: () => impactFX(p1, dir) }, ...landEvents(land, to, check)];
    return C.timeline.play({ name: '吃子', tracks, events, dur: total }).then(() => { st.mode = 'idle'; st.add = {}; st.act = 0; });
  }

  return {
    /** Dispatch a move. info: { obj, victim, screen, p0, p1, to:{r,c}, check:{pos,side}|null, curve } */
    play(info) {
      const rig = info.obj.userData.rig;
      if (info.victim) {
        if ((rig.kind === 'cannon' || rig.kind === 'catapult') && info.screen) return cannonCapture(info);
        return meleeCapture(info);
      }
      if (rig.kind === 'biped') return bipedStep(info);
      if (rig.kind === 'quad') return rig.role === 'elephant' ? heavyWalk(info) : horseLeap(info);
      return wheeledRun(info);
    },
  };
}
