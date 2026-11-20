// 遊戲主控 — 介面、輸入（滑鼠與觸控）、動作編排、電腦對手、線上同步
import * as THREE from 'three';
import { Game, RED, BLACK, NAMES, TYPE_KEYS, K, C, N, mk, mFrom, mTo, rowOf, colOf, idx, sideOf, typeOf, findKing } from './rules.js';
import { Stage, cellPos, BOARD_STYLES } from './scene.js';
import { buildPiece, MODEL_OPTIONS, MODEL_NAMES, MEANING, PALETTES, defaultMap } from './models.js';
import { Tweener, poseRig, Particles, ease, setIdleHook } from './anim.js';
import { SFX } from './audio.js';
import { NetPlay } from './net.js';
import { Clock, Timeline } from './timeline.js';
import { createChoreo, TUNE_DEFAULTS } from './choreo.js';
import { createChoreo3, TUNE3_DEFAULTS } from './choreo3.js';

const $ = s => document.querySelector(s);
const sideName = s => (s === RED ? '紅方' : '黑方');
const LEVELS = [
  { name: '入門', maxDepth: 2, timeMs: 300, randomness: 80 },
  { name: '業餘', maxDepth: 3, timeMs: 900, randomness: 20 },
  { name: '高手', maxDepth: 5, timeMs: 2200, randomness: 0 },
  { name: '大師', maxDepth: 8, timeMs: 4500, randomness: 0 },
];

/* ------------------------------ 設定 ------------------------------ */
const DEFAULTS = {
  red: { map: defaultMap(RED), palette: 'crimson' },
  black: { map: defaultMap(BLACK), palette: 'obsidian' },
  board: 'rosewood', figureScale: 1, speed: 1, volume: 0.8, cinematic: true, badges: false, music: false, sound: true, hints: true, idleSounds: true,
  animVersion: 'v3', intensity: 'cinematic', tune: { ...TUNE_DEFAULTS }, tune3: { ...TUNE3_DEFAULTS }, seenV3: true,
};
function loadSettings() {
  try { const s = JSON.parse(localStorage.getItem('xq3d-settings-v3')); if (s) {
      const m = { ...structuredClone(DEFAULTS), ...s, tune: { ...TUNE_DEFAULTS, ...(s.tune || {}) }, tune3: { ...TUNE3_DEFAULTS, ...(s.tune3 || {}) } };
      if (!s.seenV3) { m.animVersion = 'v3'; m.intensity = 'cinematic'; m.seenV3 = true; }   // 第二版上線時預設切換過去一次
      return m;
    } } catch { /* 無法使用瀏覽器儲存 */ }
  return structuredClone(DEFAULTS);
}
const settings = loadSettings();
const saveSettings = () => { try { localStorage.setItem('xq3d-settings-v3', JSON.stringify(settings)); } catch { /* 忽略 */ } };

/* ------------------------------ 核心物件 ------------------------------ */
const stage = new Stage($('#stage'));
const tw = new Tweener();
const fx = new Particles(stage.scene);
const sfx = new SFX();
const game = new Game();
const pieceGroup = new THREE.Group(); stage.scene.add(pieceGroup);
let pieces = new Array(90).fill(null);       // 棋盤索引 → 3D 物件
let graveyard = [];                         // 被吃掉、擺在棋盤旁的棋子
let selected = -1, busy = false, aiThinking = false;
let mode = 'menu';                           // 對局模式：solo（單人）｜local（同機）｜online（線上）｜demo（原型對照）
let humanSide = RED, level = 1, autoFlip = true;
let remoteArmy = null;                       // 線上對戰時對手的自訂造型
const states = new Map();                    // 物件 → 姿勢狀態
const timeline = new Timeline();
const isV2 = () => settings.animVersion === 'v2' || settings.animVersion === 'v3';   // 第一版、第二版共用新標記（細框、印記）

/* ------------------------------ 電腦對手（背景執行緒） ------------------------------ */
let worker = null, aiReq = 0;
function getWorker() {
  if (!worker) worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
  return worker;
}
function aiMove() {
  return new Promise(res => {
    const id = ++aiReq, w = getWorker();
    const onMsg = e => { if (e.data.id !== id) return; w.removeEventListener('message', onMsg); res(e.data); };
    w.addEventListener('message', onMsg);
    w.postMessage({ id, board: Array.from(game.board), side: game.turn, opts: LEVELS[level] });
  });
}

/* ------------------------------ 棋子 ------------------------------ */
function armyFor(side) {
  const key = side === RED ? 'red' : 'black';
  if (mode === 'online' && remoteArmy && side !== humanSide) return remoteArmy;
  return settings[key];
}
function paletteFor(side) {
  const army = armyFor(side), group = side === RED ? PALETTES.red : PALETTES.black;
  return group[army.palette] || Object.values(group)[0];
}
function createPiece(code) {
  const side = sideOf(code), type = typeOf(code), tk = TYPE_KEYS[type];
  const army = armyFor(side);
  const obj = buildPiece(side, type, tk, army.map?.[tk] || defaultMap(side)[tk], paletteFor(side), { figureScale: settings.figureScale, badges: settings.badges });
  states.set(obj, { mode: 'idle', walk: 0, act: 0, dist: 0, speed: 0, amp: 1, scale: obj.userData.scale });
  return obj;
}
let pendingRebuild = false;
function requestRebuild() { if (busy) pendingRebuild = true; else rebuildPieces(); }
function rebuildPieces() {
  pendingRebuild = false;
  timeline.finishAll(); tw.timeScale = 1;
  stage.clearSeal(); stage.setLandFrame(null);
  pieceGroup.clear(); states.clear();
  graveyard.forEach(o => stage.scene.remove(o)); graveyard = [];
  pieces = new Array(90).fill(null);
  for (let i = 0; i < 90; i++) {
    const p = game.board[i]; if (!p) continue;
    const o = createPiece(p);
    o.position.copy(cellPos(rowOf(i), colOf(i)));
    pieceGroup.add(o); pieces[i] = o;
  }
  // 依棋譜重建被吃掉的棋子
  for (const h of game.history) if (h.cap) {
    const o = createPiece(h.cap); placeInGrave(o, true);
  }
  refreshMarkers();
}
function gravePos(side, n) {
  // 被吃掉的棋子排在該方右手邊的桌面上
  const x = side === RED ? 5.9 + (n % 2) * 0.95 : -5.9 - (n % 2) * 0.95;
  const z = side === RED ? 4.6 - Math.floor(n / 2) * 0.95 : -4.6 + Math.floor(n / 2) * 0.95;
  return new THREE.Vector3(x, -0.35, z);
}
function placeInGrave(o, instant) {
  const side = o.userData.side;
  const n = graveyard.filter(g => g.userData.side === side).length;
  graveyard.push(o);
  if (o.parent !== stage.scene) stage.scene.add(o);
  const p = gravePos(side, n);
  if (instant) { o.position.copy(p); o.rotation.set(0, 0, 0); setPose(o, 'idle'); }
  return p;
}
function setPose(o, m, act = 0) { const s = states.get(o); if (s) { s.mode = m; s.act = act; } }

/* ------------------------------ 標記與介面資訊 ------------------------------ */
function refreshMarkers() {
  stage.clearMarkers();
  if (selected >= 0) {
    if (settings.hints) {
      stage.showTargets(game.movesFrom(selected).map(m => ({ r: rowOf(mTo(m)), c: colOf(mTo(m)), capture: !!game.board[mTo(m)] })));
    }
    stage.showSelected(rowOf(selected), colOf(selected));
  }
  const last = game.history[game.history.length - 1];
  const kingIdx = last?.check ? findKing(game.board, game.turn) : -1;
  if (isV2()) { // 改版：落地細框 + 將帥腳下印記
    stage.showLast(null); stage.showCheck(null);
    if (last) { const t = mTo(last.m); if (!stage.landFrame?.visible || stage.landFrame.position.distanceTo(cellPos(rowOf(t), colOf(t), 0.016)) > 0.01) stage.setLandFrame(rowOf(t), colOf(t)); }
    else stage.setLandFrame(null);
    if (kingIdx < 0) stage.clearSeal(); else if (!stage.seal) stage.showSeal(cellPos(rowOf(kingIdx), colOf(kingIdx)), game.turn);
  } else {
    stage.setLandFrame(null); stage.clearSeal();
    if (last) stage.showLast([rowOf(mFrom(last.m)), colOf(mFrom(last.m))], [rowOf(mTo(last.m)), colOf(mTo(last.m))]);
    else stage.showLast(null);
    stage.showCheck(kingIdx >= 0 ? cellPos(rowOf(kingIdx), colOf(kingIdx)) : null);
  }
  updateHud();
}
function updateHud() {
  const t = game.turn;
  $('#turnDot').classList.toggle('black', t === BLACK);
  let txt;
  if (game.result) txt = game.result.winner ? `${sideName(game.result.winner)}勝` : '和棋';
  else if (mode === 'solo') txt = t === humanSide ? `輪到你（${sideName(t)}）` : `電腦（${sideName(t)}）`;
  else if (mode === 'online') txt = t === humanSide ? `輪到你（${sideName(t)}）` : `對手（${sideName(t)}）`;
  else txt = `${sideName(t)}走棋`;
  $('#turnText').textContent = txt;
  const last = game.history[game.history.length - 1];
  $('#statusLine').textContent = game.result ? `${game.result.reason} · ${txt}` : last ? `${game.history.length}. ${last.notation}${last.check ? ' 將軍!' : ''}` : '準備開始';
  // 棋譜清單
  const ol = $('#moveList'); ol.innerHTML = '';
  for (let i = 0; i < game.history.length; i += 2) {
    const li = document.createElement('li');
    const a = game.history[i], b = game.history[i + 1];
    li.innerHTML = `<span class="${a.side === RED ? 'r' : 'b'}${a.check ? ' chk' : ''}">${a.notation}</span>` + (b ? `<span class="${b.side === RED ? 'r' : 'b'}${b.check ? ' chk' : ''}">${b.notation}</span>` : '');
    ol.appendChild(li);
  }
  ol.scrollTop = ol.scrollHeight;
  // 吃子紀錄
  const capR = $('#capRed'), capB = $('#capBlack'); capR.innerHTML = ''; capB.innerHTML = '';
  for (const h of game.history) if (h.cap) {
    const s = document.createElement('span'), cs = sideOf(h.cap);
    s.className = cs === RED ? 'r' : 'b'; s.textContent = NAMES[cs][typeOf(h.cap)];
    (h.side === RED ? capR : capB).appendChild(s);
  }
  const modeTxt = mode === 'solo' ? `單人 · ${LEVELS[level].name} · 你執${sideName(humanSide)}` : mode === 'local' ? '雙人同機' : mode === 'online' ? `線上對戰 · 房間 ${net.code ?? ''} · 你執${sideName(humanSide)}${net.connected ? '' : '（離線）'}` : '';
  $('#modeLine').textContent = modeTxt;
  $('#btnUndo').disabled = !game.history.length || busy;
}
function banner(text, ms = 1300) {
  const b = $('#banner'); b.textContent = text; b.classList.add('show');
  clearTimeout(banner._t); banner._t = setTimeout(() => b.classList.remove('show'), ms);
}

/* ------------------------------ 動作編排（改版前） ------------------------------ */
const yawTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
function moveStyle(obj) {
  const { rig } = obj.userData;
  // stride＝半個步態週期（相位 π）走的距離，讓腳、馬蹄、車輪都不會滑行
  if (rig.kind === 'chariot') return rig.horse ? { mode: 'gallop', speed: 3.0, stride: 0.42 } : { mode: 'walk', speed: 2.6, stride: 0.3 };
  if (rig.kind === 'cannon' || rig.kind === 'catapult') return { mode: 'walk', speed: 1.3, stride: 0.22 };
  if (rig.kind === 'quad') return rig.role === 'elephant' ? { mode: 'walk', speed: 1.0, stride: 0.26 } : { mode: 'gallop', speed: 2.6, stride: 0.48 };
  return { mode: 'walk', speed: obj.userData.typeKey === 'K' ? 1.1 : 1.3, stride: 0.27 * (obj.userData.scale / 1.5) };
}
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
/** 原地小步轉身（不會像溜冰一樣原地旋轉）。 */
async function stepTurn(obj, yaw, base = 0.18) {
  const h = obj.userData.holder, y0 = h.rotation.y, d = angDiff(y0, yaw);
  if (Math.abs(d) < 0.12) { h.rotation.y = y0 + d; return; }
  const st = states.get(obj), steps = Math.max(1, Math.round(Math.abs(d) / 1.1)), w0 = st.walk;
  const dur = (base + steps * 0.16) / settings.speed;
  st.mode = moveStyle(obj).mode === 'gallop' && obj.userData.rig.kind === 'quad' ? 'walk' : 'walk'; st.amp = 0.45; st.speed = 0.2;
  await tw.add(dur, (k, lin) => { h.rotation.y = y0 + d * k; st.walk = w0 + lin * steps * Math.PI; }, ease.inOut);
  st.mode = 'idle'; st.amp = 1; st.speed = 0;
}
function turnTo(obj, yaw, dur = 0.18) { return stepTurn(obj, yaw, dur); }
/** 沿（可能是弧形的）路徑行走或奔馳，面向路徑方向，起步加速、停步減速。 */
async function travel(obj, from, to, { arc = 0, style = moveStyle(obj), sound = true, curve = null } = {}) {
  const P = t => {
    if (!curve) return new THREE.Vector3().lerpVectors(from, to, t);
    const u = 1 - t; return from.clone().multiplyScalar(u * u).add(curve.clone().multiplyScalar(2 * u * t)).add(to.clone().multiplyScalar(t * t));
  };
  let L = 0; { let prev = P(0); for (let i = 1; i <= 24; i++) { const q = P(i / 24); L += q.distanceTo(prev); prev = q; } }
  if (L < 0.01) return;
  const h = obj.userData.holder;
  const tangentYaw = t => { const a = P(Math.max(0, t - 0.02)), b = P(Math.min(1, t + 0.02)); return Math.atan2(b.x - a.x, b.z - a.z); };
  await stepTurn(obj, tangentYaw(0.02), 0.1);
  const dur = Math.min(2.6, 0.45 + L / style.speed) / settings.speed;
  if (sound) sfx.move(obj.userData.typeKey, dur);
  const st = states.get(obj); st.mode = style.mode;
  const cycles = Math.max(1, Math.round(L / style.stride));       // 以整步結束：抵達時雙腳併攏
  const w0 = Math.round(st.walk / Math.PI) * Math.PI, d0 = st.dist || 0;
  const ta = 0.25, vmax = 1 / (1 - ta);                          // 梯形速度：加速、等速、減速
  const prof = k => k < ta ? vmax * k * k / (2 * ta) : k > 1 - ta ? 1 - vmax * (1 - k) * (1 - k) / (2 * ta) : vmax * (ta / 2 + (k - ta));
  const vel = k => (k < ta ? k / ta : k > 1 - ta ? (1 - k) / ta : 1);
  await tw.add(dur, (k) => {
    const u = Math.min(1, prof(k));
    const pos = P(u);
    obj.position.set(pos.x, from.y + (to.y - from.y) * u + Math.sin(Math.PI * u) * arc, pos.z);
    st.walk = w0 + u * cycles * Math.PI;
    st.dist = d0 + u * L;
    st.speed = 0.35 + 0.65 * vel(k);
    // 沿路徑切線平滑轉向
    h.rotation.y += angDiff(h.rotation.y, tangentYaw(Math.min(0.98, Math.max(0.02, u)))) * 0.35;
  }, ease.linear);
  st.mode = 'idle'; st.speed = 0;
  fx.ring(to, 0xe8d9b0);
}
/** 馬走日：自然的弧形路線，先沿長邊（經過馬腿位置）再轉向。 */
function knightCurve(tk, a, b) {
  if (tk !== 'N') return null;
  const dx = b.x - a.x, dz = b.z - a.z;
  return Math.abs(dz) > Math.abs(dx) ? new THREE.Vector3(a.x + dx * 0.15, 0, a.z + dz * 0.75) : new THREE.Vector3(a.x + dx * 0.75, 0, a.z + dz * 0.15);
}
function faceHome(obj) { return stepTurn(obj, obj.userData.baseFacing, 0.12); }

async function cinematicIn(focus) {
  if (!settings.cinematic) return null;
  const cam = stage.camera, ctrl = stage.controls;
  const saved = { pos: cam.position.clone(), target: ctrl.target.clone() };
  const dir = saved.pos.clone().sub(saved.target).normalize();
  const goalT = focus.clone(); goalT.y = 0.3;
  const goalP = goalT.clone().add(dir.multiplyScalar(6.5)); goalP.y = Math.max(goalP.y, 3.2);
  const p0 = cam.position.clone(), t0 = ctrl.target.clone();
  ctrl.enabled = false;
  await tw.add(0.45 / settings.speed, k => { cam.position.lerpVectors(p0, goalP, k); ctrl.target.lerpVectors(t0, goalT, k); });
  return saved;
}
async function cinematicOut(saved) {
  if (!saved) return;
  const cam = stage.camera, ctrl = stage.controls;
  const p0 = cam.position.clone(), t0 = ctrl.target.clone();
  await tw.add(0.6 / settings.speed, k => { cam.position.lerpVectors(p0, saved.pos, k); ctrl.target.lerpVectors(t0, saved.target, k); });
  ctrl.enabled = true;
}

function impactFX(pos, big = false) {
  const p = pos.clone(); p.y += 0.35;
  fx.burst(p, { count: big ? 60 : 36, color: 0xffc061, speed: big ? 5 : 3.6, size: 0.03, life: 0.7, gravity: 7 });
  fx.burst(p, { count: big ? 26 : 16, color: 0x6b3f22, speed: 3, size: 0.06, life: 1.6, gravity: 9, emissive: false, chips: true });
  fx.smoke(pos.clone().setY(0.1), { count: big ? 22 : 10, size: big ? 0.2 : 0.13 });
  fx.ring(pos, 0xfff0c0);
  stage.flash.position.copy(p); stage.flash.intensity = big ? 60 : 35;
  stage.shake = big ? 1.4 : 1.0;
}

async function knockAway(victim, fromPos, attackDir) {
  setPose(victim, 'hit', 1);
  const grave = placeInGrave(victim, false);
  // pieceGroup 座標與場景座標相同（原點一致）
  stage.scene.add(victim);
  const start = victim.position.clone();
  const fling = start.clone().add(attackDir.clone().setY(0).normalize().multiplyScalar(1.1));
  const spin = (Math.random() > 0.5 ? 1 : -1) * (Math.PI * 2 + Math.random() * 2);
  // 第一段：翻滾著被擊飛
  await tw.add(0.55 / settings.speed, k => {
    victim.position.lerpVectors(start, fling, k);
    victim.position.y = start.y + Math.sin(Math.PI * k) * 1.3 + (k > 0.5 ? 0 : 0);
    victim.rotation.z = spin * k * 0.5; victim.rotation.x = -k * 1.2;
  }, ease.out);
  sfx.place();
  fx.burst(fling.clone().setY(0.1), { count: 10, color: 0x9a8a70, speed: 1.4, size: 0.03, life: 0.6, emissive: false });
  // 第二段：滾到棋盤旁並站正
  const mid = victim.position.clone(), rz = victim.rotation.z, rx = victim.rotation.x;
  await tw.add(0.7 / settings.speed, k => {
    victim.position.lerpVectors(mid, grave, k);
    victim.position.y = mid.y + (grave.y - mid.y) * k + Math.sin(Math.PI * k) * 0.8;
    victim.rotation.z = rz * (1 - k); victim.rotation.x = rx * (1 - k);
  }, ease.inOut);
  victim.rotation.set(0, 0, 0);
  setPose(victim, 'idle');
  victim.userData.holder.rotation.y = victim.userData.baseFacing;
}

async function animateMove(m, rec) {
  const from = mFrom(m), to = mTo(m);
  const obj = pieces[from], victim = rec.cap ? pieces[to] : null;
  const p0 = obj.position.clone(), p1 = cellPos(rowOf(to), colOf(to));
  pieces[to] = obj; pieces[from] = null;
  const style = moveStyle(obj);
  const tk = obj.userData.typeKey;
  if (!victim) {
    await travel(obj, p0, p1, { style, curve: knightCurve(tk, p0, p1) });
    sfx.place();
    await faceHome(obj);
    return;
  }
  /* ---------- 吃子演出 ---------- */
  const vk = victim.userData.typeKey;
  const dir = p1.clone().sub(p0).setY(0).normalize();
  const saved = await cinematicIn(p0.clone().lerp(p1, 0.6));
  // 被吃一方轉身面對、擺出防禦姿勢
  turnTo(victim, yawTo(p1, p0), 0.25);
  setPose(victim, 'guard');
  const rk = obj.userData.rig?.kind;
  const isCannonShot = rk === 'cannon' || rk === 'catapult';
  if (isCannonShot) {
    const catapult = rk === 'catapult';
    await turnTo(obj, yawTo(p0, p1), 0.25 / settings.speed);
    // 瞄準、點燃引信
    sfx.windup('C');
    await tw.add(0.5 / settings.speed, k => setPose(obj, 'windup', k));
    tw.timeScale = 0.6;
    // 越過炮架發射：炮射出砲彈，砲拋出巨石
    const rig = obj.userData.rig;
    const muzzle = new THREE.Vector3();
    let ball;
    if (catapult) {
      await tw.add(0.12 / settings.speed, k => setPose(obj, 'strike', k * 0.3));
      rig.stone.getWorldPosition(muzzle);
      rig.stoneFired = true;
      sfx.impact('B', vk);
      ball = new THREE.Mesh(new THREE.DodecahedronGeometry(0.1, 1), new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.95 }));
      tw.add(0.3 / settings.speed, k => setPose(obj, 'strike', 0.3 + k * 0.7));
    } else {
      rig.muzzle.getWorldPosition(muzzle);
      fx.burst(muzzle, { count: 30, color: 0xffe08a, speed: 2.5, size: 0.03, life: 0.4, gravity: 0 });
      fx.smoke(muzzle, { count: 12, size: 0.12 });
      stage.flash.position.copy(muzzle); stage.flash.intensity = 40; stage.shake = 0.6;
      sfx.impact('C', vk);
      ball = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.3, emissive: 0x552200 }));
      tw.add(0.35 / settings.speed, k => setPose(obj, 'strike', k));
    }
    ball.castShadow = true; stage.scene.add(ball);
    const target = p1.clone().setY(0.35), arcH = (catapult ? 2.0 : 1.2) + p0.distanceTo(p1) * 0.25;
    await tw.add((catapult ? 0.75 : 0.5) / settings.speed, k => {
      ball.position.lerpVectors(muzzle, target, k); ball.position.y += Math.sin(Math.PI * k) * arcH;
      if (catapult) { ball.rotation.x += 0.2; ball.rotation.z += 0.13; }
      else if (Math.random() < 0.6) fx.burst(ball.position, { count: 1, color: 0xff9944, speed: 0.2, size: 0.03, life: 0.3, gravity: 0 });
    }, ease.linear);
    if (catapult) fx.burst(p1.clone().setY(0.3), { count: 20, color: 0x8a8580, speed: 3, size: 0.05, life: 1.4, gravity: 9, emissive: false, chips: true });
    stage.scene.remove(ball);
    impactFX(p1, true);
    tw.timeScale = 0.35;
    await knockAway(victim, p1, dir);
    tw.timeScale = 1;
    setPose(obj, 'idle');
    await travel(obj, p0, p1, { style });
  } else {
    // 逼近到出擊距離
    const dist = p0.distanceTo(p1);
    const stopAt = p1.clone().sub(dir.clone().multiplyScalar(0.62));
    const leap = tk === 'C' || tk === 'N';                    // 非器械的炮與馬會躍入
    if (dist > 0.7) await travel(obj, p0, stopAt, { style, arc: tk === 'C' ? 0.9 + dist * 0.12 : 0, curve: knightCurve(tk, p0, stopAt) });
    // 蓄力（人立或舉起兵器），以慢動作營造張力
    sfx.windup(tk);
    tw.timeScale = 0.55;
    await tw.add(0.4 / settings.speed, k => setPose(obj, 'windup', k), ease.out);
    // 出擊！
    const s0 = obj.position.clone(), s1 = s0.clone().add(dir.clone().multiplyScalar(0.28));
    sfx.impact(tk, vk);
    await tw.add(0.16 / settings.speed, k => { setPose(obj, 'strike', k); obj.position.lerpVectors(s0, s1, k); if (leap) obj.position.y = s0.y + Math.sin(Math.PI * k) * 0.15; }, ease.in);
    impactFX(p1, tk === 'B' || tk === 'R' || tk === 'K');
    tw.timeScale = 0.3;
    const knock = knockAway(victim, p1, dir);
    await tw.wait(0.25);
    tw.timeScale = 1;
    await knock;
    await tw.add(0.2 / settings.speed, k => setPose(obj, 'strike', 1 - k));
    setPose(obj, 'idle');
    await travel(obj, obj.position.clone().setY(0), p1, { style, sound: false });
    sfx.place();
  }
  await cinematicOut(saved);
  await faceHome(obj);
}

/* ------------------------------ 改版編排 ------------------------------ */
const choreo = createChoreo({ stage, fx, sfx, timeline, states, settings, placeInGrave: (o, instant) => placeInGrave(o, instant), cellPos });
const choreo3 = createChoreo3({ stage, fx, sfx, timeline, states, settings, placeInGrave: (o, instant) => placeInGrave(o, instant), setTimeScale: v => { tw.timeScale = v; } });
function screenBetween(from, to) { // 炮越過的那一顆棋子（炮架）
  const fr = rowOf(from), fc = colOf(from), tr = rowOf(to), tc = colOf(to);
  if (fr !== tr && fc !== tc) return null;
  const dr = Math.sign(tr - fr), dc = Math.sign(tc - fc);
  for (let r = fr + dr, c = fc + dc; r !== tr || c !== tc; r += dr, c += dc) if (pieces[idx(r, c)]) return pieces[idx(r, c)];
  return null;
}
async function animateMoveV2(m, rec) {
  const from = mFrom(m), to = mTo(m);
  const obj = pieces[from], victim = rec.cap ? pieces[to] : null;
  const screen = victim && obj.userData.typeKey === 'C' ? screenBetween(from, to) : null;
  stage.clearSeal();
  const p0 = obj.position.clone().setY(0), p1 = cellPos(rowOf(to), colOf(to));
  pieces[to] = obj; pieces[from] = null;
  const kIdx = rec.check ? findKing(game.board, game.turn) : -1;
  await (settings.animVersion === 'v3' ? choreo3 : choreo).play({
    obj, victim, screen, p0, p1, to: { r: rowOf(to), c: colOf(to) },
    check: kIdx >= 0 ? { pos: cellPos(rowOf(kIdx), colOf(kIdx)), side: game.turn } : null,
    curve: knightCurve(obj.userData.typeKey, p0, p1),
  });
  obj.position.copy(p1); tw.timeScale = 1;
}

/* ------------------------------ 走子流程 ------------------------------ */
async function commitMove(m, { fromNet = false } = {}) {
  if (busy || !game.isLegal(m)) return false;
  busy = true; selected = -1; stage.clearMarkers();
  const rec = game.play(m);
  if (mode === 'online' && !fromNet) net.send({ t: 'move', m, n: game.history.length });
  if (isV2()) await animateMoveV2(m, rec); else await animateMove(m, rec);
  busy = false;
  if (pendingRebuild) rebuildPieces();
  refreshMarkers();
  afterMove(rec);
  return true;
}
function afterMove(rec) {
  updateLab();
  if (game.result) return endGame();
  if (rec.check) {
    if (!isV2()) { sfx.check(); banner('將 軍 !'); }   // 改版：印記與短鼓已在同一段節奏裡
    const k = pieces[findKing(game.board, game.turn)];
    if (k) setPose(k, 'guard');
    setTimeout(() => { if (k && states.get(k)?.mode === 'guard') setPose(k, 'idle'); }, 1500);
  }
  if (mode === 'local' && autoFlip) flipTo(game.turn);
  maybeAI();
}
async function maybeAI() {
  if (mode === 'demo') return demoReply();
  if (mode !== 'solo' || game.result || game.turn === humanSide || aiThinking) return;
  aiThinking = true; $('#thinking').hidden = false;
  const startHist = game.history.length, t0 = performance.now();
  const res = await aiMove();
  const wait = Math.max(0, 450 - (performance.now() - t0));
  await new Promise(r => setTimeout(r, wait));
  aiThinking = false; $('#thinking').hidden = true;
  if (mode !== 'solo' || game.history.length !== startHist || !res.move) return; // 等待期間局面已改變（悔棋或新局）
  commitMove(res.move);
}
/** 電影模式：將殺時的英雄特寫，點一下收尾 */
function heroCloseup(obj) {
  return new Promise(resolve => {
    const cam = stage.camera, ctrl = stage.controls, saved = { pos: cam.position.clone(), target: ctrl.target.clone() };
    const yaw = obj.userData.holder.rotation.y, fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const tgt = obj.position.clone().setY(0.75), goal = tgt.clone().addScaledVector(fwd, 3.3).add(new THREE.Vector3(0.9, 1.0, 0));
    const p0 = cam.position.clone(), t0 = ctrl.target.clone();
    ctrl.enabled = false; banner('絕 殺', 1800);
    const minD = ctrl.minDistance; ctrl.minDistance = 0.5;   // 否則軌道控制器會把特寫鏡頭拉回最小距離
    timeline.play({ name: '英雄特寫', tracks: [{ at: 0, dur: 700, ease: t => 1 - Math.pow(1 - t, 3), fn: k => { cam.position.lerpVectors(p0, goal, k); ctrl.target.lerpVectors(t0, tgt, k); } }] });
    setPose(obj, 'cheer');
    const finish = e => {
      e?.stopPropagation?.(); window.removeEventListener('pointerdown', finish, true); window.removeEventListener('keydown', finish, true);
      const p1 = cam.position.clone(), t1 = ctrl.target.clone();
      timeline.play({ name: '收尾', tracks: [{ at: 0, dur: 500, ease: t => t * t * (3 - 2 * t), fn: k => { cam.position.lerpVectors(p1, saved.pos, k); ctrl.target.lerpVectors(t1, saved.target, k); } }] }).then(() => { ctrl.minDistance = minD; ctrl.enabled = true; resolve(); });
    };
    setTimeout(() => { window.addEventListener('pointerdown', finish, true); window.addEventListener('keydown', finish, true); }, 500);
    toast('點一下畫面收尾');
  });
}
async function endGame() {
  const r = game.result;
  const winner = r.winner;
  if (isV2() && settings.intensity === 'cinematic' && r.reason === '將死') {
    const last = game.history[game.history.length - 1];
    const hero = last && pieces[mTo(last.m)];
    if (hero) { sfx.win(); await heroCloseup(hero); return showEndDialog(r, winner); }
  }
  for (let i = 0; i < 90; i++) {
    const o = pieces[i]; if (!o) continue;
    if (winner && o.userData.side === winner) setPose(o, 'cheer');
  }
  const youWin = mode === 'local' ? null : winner === humanSide;
  if (winner === 0) { sfx.lose(); banner('和 棋', 2200); }
  else if (youWin === false) { sfx.lose(); banner(`${sideName(winner)}勝`, 2200); }
  else { sfx.win(); banner(r.reason === '將死' ? '絕 殺 !' : `${sideName(winner)}勝`, 2200); }
  setTimeout(() => showEndDialog(r, winner), isV2() ? 1100 : 2300);
}
function showEndDialog(r, winner) {
  const youWin = mode === 'local' ? null : winner === humanSide;
  const title = winner === 0 ? '和棋' : youWin === null ? `${sideName(winner)}獲勝` : youWin ? '你贏了！' : '你輸了';
  dialog(title, `${r.reason}。共 ${game.history.length} 步。`, [
    { label: '再來一局', primary: true, fn: () => newGame(true) },
    { label: '觀看棋盤', fn: () => {} },
  ]);
}

/* ------------------------------ 輸入：滑鼠與觸控 ------------------------------ */
const canvas = stage.renderer.domElement;
let down = null, drag = null;
function canControl(side) {
  if (busy || game.result || aiThinking) return false;
  if (mode === 'solo' || mode === 'online' || mode === 'demo') return side === humanSide && game.turn === humanSide;
  return mode === 'local' && side === game.turn;
}
function pieceAt(e) {
  const { hits } = stage.pick(e.clientX, e.clientY, pieceGroup.children);
  for (const h of hits) {
    let o = h.object;
    while (o && !o.userData?.side) o = o.parent;
    if (o) { const i = pieces.indexOf(o); if (i >= 0) return i; }
  }
  const cell = stage.pickCell(e.clientX, e.clientY);
  return cell ? idx(cell.r, cell.c) : -1;
}
canvas.addEventListener('pointerdown', e => {
  if (!e.isPrimary) { // 第二根手指：縮放或旋轉，取消拖曳
    if (drag) cancelDrag();
    return;
  }
  sfx.ensure();
  down = { x: e.clientX, y: e.clientY, t: performance.now() };
  const i = pieceAt(e);
  if (i >= 0 && game.board[i] && canControl(sideOf(game.board[i]))) {
    // 按住己方棋子：選取並可拖曳
    if (selected !== i) { selected = i; sfx.select(); refreshMarkers(); }
    drag = { i, obj: pieces[i], start: pieces[i].position.clone(), moved: false, id: e.pointerId };
    stage.controls.enabled = false;
  }
});
canvas.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) drag.moved = true;
  if (!drag.moved) return;
  const { ray } = stage.pick(e.clientX, e.clientY, []);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.0);
  const p = new THREE.Vector3();
  if (ray.ray.intersectPlane(plane, p)) {
    p.x = THREE.MathUtils.clamp(p.x, -4.6, 4.6); p.z = THREE.MathUtils.clamp(p.z, -5.1, 5.1);
    drag.obj.position.set(p.x, 0.35, p.z);
    setPose(drag.obj, 'walk'); states.get(drag.obj).walk += 0.3;
  }
});
function cancelDrag() {
  if (!drag) return;
  const { obj, start } = drag; const from = obj.position.clone();
  tw.add(0.2, k => obj.position.lerpVectors(from, start, k));
  setPose(obj, 'idle');
  drag = null; stage.controls.enabled = true;
}
canvas.addEventListener('pointerup', e => {
  if (!down || !e.isPrimary) return;
  const tap = Math.hypot(e.clientX - down.x, e.clientY - down.y) < 10 && performance.now() - down.t < 600;
  const cell = stage.pickCell(e.clientX, e.clientY);
  if (drag && drag.moved) {
    const { i, obj } = drag; drag = null; stage.controls.enabled = true;
    const to = cell ? idx(cell.r, cell.c) : -1;
    const m = mk(i, to);
    if (to >= 0 && game.isLegal(m)) { obj.position.y = 0; setPose(obj, 'idle'); commitMove(m); }
    else { drag = { obj, start: cellPos(rowOf(i), colOf(i)) }; cancelDrag(); sfx.deny(); }
    down = null; return;
  }
  if (drag) { drag = null; stage.controls.enabled = true; }
  if (tap) handleTap(e);
  down = null;
});
canvas.addEventListener('pointercancel', () => { cancelDrag(); down = null; });
function handleTap(e) {
  const i = pieceAt(e);
  if (i < 0) { if (selected >= 0) { selected = -1; refreshMarkers(); } return; }
  const p = game.board[i];
  if (p && canControl(sideOf(p))) return; // 已在按下時選取
  if (selected >= 0) {
    const m = mk(selected, i);
    if (game.isLegal(m)) { commitMove(m); return; }
    sfx.deny();
    selected = -1; refreshMarkers();
  }
}
// 鍵盤：Esc 取消選取、U 悔棋、F 翻轉視角
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'Escape') { selected = -1; refreshMarkers(); }
  if (e.key === 'u' || e.key === 'U') undo();
  if (e.key === 'f' || e.key === 'F') flipTo(-stage.viewSide);
});

/* ------------------------------ 鏡頭 ------------------------------ */
function flipTo(side) {
  if (stage.viewSide === side) return;
  stage.viewSide = side;
  const cam = stage.camera, ctrl = stage.controls;
  const t0 = ctrl.target.clone(), r0 = cam.position.clone().sub(t0);
  const goal = stage.fitCamera(true), tGoal = ctrl.target.clone();
  ctrl.target.copy(t0);
  const g = goal.clone().sub(tGoal);
  const a0 = Math.atan2(r0.x, r0.z), a1 = Math.atan2(g.x, g.z);
  let da = a1 - a0; da = Math.atan2(Math.sin(da), Math.cos(da));
  const rad0 = Math.hypot(r0.x, r0.z), rad1 = Math.hypot(g.x, g.z);
  tw.add(0.9, k => {
    const a = a0 + da * k, rad = rad0 + (rad1 - rad0) * k;
    ctrl.target.lerpVectors(t0, tGoal, k);
    cam.position.set(ctrl.target.x + Math.sin(a) * rad, ctrl.target.y + r0.y + (g.y - r0.y) * k, ctrl.target.z + Math.cos(a) * rad);
  });
}

/* ------------------------------ 對局管理 ------------------------------ */
function startGame(newMode, opts = {}) {
  mode = newMode;
  game.reset(); selected = -1; busy = false; aiThinking = false; aiReq++;
  $('#thinking').hidden = true;
  if (mode === 'solo') { humanSide = opts.side; level = opts.level; }
  if (mode === 'local') { humanSide = RED; autoFlip = opts.autoFlip; }
  if (mode === 'online') humanSide = opts.side;
  if (mode === 'demo') humanSide = RED;
  stage.viewSide = 0; flipTo(humanSide);
  rebuildPieces();
  closeModal('#menu');
  $('#closeMenu').hidden = false;
  sfx.ensure(); if (mode !== 'demo') { sfx.place(); banner('對 局 開 始', 1100); }
  $('#lab').hidden = mode !== 'demo'; updateLab();
  const newInset = mode === 'demo' ? 382 : 0;
  if (stage.leftInset !== newInset) { stage.leftInset = newInset; stage.resize(); }
  maybeAI();
}
function newGame(fromDialog) {
  if (mode === 'online') {
    if (!net.connected) return openMenu();
    net.send({ t: 'new-req' }); toast('已向對手提出新局請求');
    return;
  }
  if (mode === 'menu') return openMenu();
  if (mode === 'demo') return startGame('demo');
  startGame(mode, { side: mode === 'solo' ? humanSide : RED, level, autoFlip });
}
function undo() {
  if (busy || !game.history.length) return;
  if (mode === 'online') { net.send({ t: 'undo-req' }); toast('已向對手提出悔棋請求'); return; }
  aiReq++; aiThinking = false; $('#thinking').hidden = true;
  game.undo();
  if (mode === 'solo') while (game.history.length && game.turn !== humanSide) game.undo();
  selected = -1; rebuildPieces(); sfx.select();
  maybeAI();
}
const waitIdle = async () => { while (busy) await new Promise(r => setTimeout(r, 50)); };
async function undoForOnline(requester) {
  await waitIdle();
  game.undo();
  while (game.history.length && game.turn !== requester) game.undo();
  selected = -1; rebuildPieces();
}
function resign() {
  if (game.result || mode === 'menu') return;
  const loser = mode === 'local' ? game.turn : humanSide;
  dialog('確定認輸？', '', [
    { label: '認輸', primary: true, fn: () => {
      if (mode === 'online') net.send({ t: 'resign' });
      game.result = { winner: -loser, reason: `${sideName(loser)}認輸` }; refreshMarkers(); endGame();
    } },
    { label: '取消', fn: () => {} },
  ]);
}

/* ------------------------------ 線上對戰 ------------------------------ */
const net = new NetPlay({
  onOpen: role => {
    $('#netErr').textContent = '';
    if (role === 'host') {
      net.send({ t: 'hello', side: -humanSidePending, army: settings[humanSidePending === RED ? 'red' : 'black'], moves: [] });
      startGame('online', { side: humanSidePending });
      toast('對手已加入！');
    }
  },
  onData: d => handleNet(d),
  onClose: () => { toast('對手已離線'); updateHud(); },
  onError: e => { $('#netErr').textContent = '連線錯誤：' + (e.type || e.message || e); },
});
let humanSidePending = RED;
function handleNet(d) {
  switch (d.t) {
    case 'hello': // 加入方接收房主分配的執方
      remoteArmy = d.army;
      startGame('online', { side: d.side });
      net.send({ t: 'army', army: settings[d.side === RED ? 'red' : 'black'] });
      for (const m of d.moves || []) game.play(m);
      rebuildPieces();
      toast('已連線，祝對局愉快！');
      break;
    case 'army': remoteArmy = d.army; requestRebuild(); break;
    case 'move':
      waitIdle().then(() => {
        if (game.turn === humanSide) return; // 不是對方回合：忽略
        if (!game.isLegal(d.m)) { net.send({ t: 'desync', moves: game.history.map(h => h.m) }); return; }
        commitMove(d.m, { fromNet: true });
      });
      break;
    case 'desync':
      game.reset(); for (const m of d.moves) game.play(m); requestRebuild(); break;
    case 'undo-req':
      dialog('對手請求悔棋', '是否同意？', [
        { label: '同意', primary: true, fn: () => { net.send({ t: 'undo-ok' }); undoForOnline(-humanSide); } },
        { label: '拒絕', fn: () => net.send({ t: 'undo-no' }) },
      ]);
      break;
    case 'undo-ok': undoForOnline(humanSide); toast('對手同意悔棋'); break;
    case 'undo-no': toast('對手拒絕悔棋'); break;
    case 'resign': game.result = { winner: humanSide, reason: `${sideName(-humanSide)}認輸` }; refreshMarkers(); endGame(); break;
    case 'new-req':
      dialog('對手請求開新局', '', [
        { label: '同意', primary: true, fn: () => { net.send({ t: 'new-ok' }); closeModal('#dialog'); startGame('online', { side: humanSide }); } },
        { label: '拒絕', fn: () => {} },
      ]);
      break;
    case 'new-ok': closeModal('#dialog'); startGame('online', { side: humanSide }); break;
    case 'full': $('#netErr').textContent = '房間已滿'; break;
  }
}

/* ------------------------------ 選單與對話框 ------------------------------ */
function openModal(sel) { $(sel).hidden = false; }
function closeModal(sel) { $(sel).hidden = true; }
function openMenu() { openModal('#menu'); }
function dialog(title, text, btns) {
  $('#dlgTitle').textContent = title; $('#dlgText').textContent = text;
  const box = $('#dlgBtns'); box.innerHTML = '';
  btns.forEach(b => {
    const el = document.createElement('button'); el.className = b.primary ? 'primary' : 'ghost'; el.textContent = b.label;
    el.onclick = () => { closeModal('#dialog'); b.fn(); };
    box.appendChild(el);
  });
  openModal('#dialog');
}
function toast(msg) { $('#statusLine').textContent = msg; banner._t2 && clearTimeout(banner._t2); banner._t2 = setTimeout(updateHud, 2500); }

document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
  document.querySelectorAll('.tabpane').forEach(p => p.hidden = p.dataset.pane !== t.dataset.tab);
});
$('#startSolo').onclick = () => {
  let side = +$('#soloSide').value; if (side === 0) side = Math.random() < 0.5 ? RED : BLACK;
  net.close(); remoteArmy = null;
  startGame('solo', { side, level: +$('#soloLevel').value });
};
$('#startLocal').onclick = () => { net.close(); remoteArmy = null; startGame('local', { autoFlip: $('#autoFlip').checked }); };
$('#btnHost').onclick = async () => {
  $('#netErr').textContent = '';
  humanSidePending = +$('#hostSide').value;
  try {
    $('#btnHost').disabled = true;
    const code = await net.host();
    $('#roomCode').textContent = code; $('#hostInfo').hidden = false;
  } catch (e) { $('#netErr').textContent = '無法建立房間（需要網路連線）：' + (e.type || e.message || e); }
  finally { $('#btnHost').disabled = false; }
};
$('#copyLink').onclick = async () => {
  const url = `${location.origin}${location.pathname}?join=${net.code}`;
  try { await navigator.clipboard.writeText(url); $('#hostWait').textContent = '連結已複製，等待對手加入…'; }
  catch { $('#hostWait').textContent = url; }
};
$('#btnJoin').onclick = async () => {
  const code = $('#joinCode').value.trim();
  if (code.length < 4) { $('#netErr').textContent = '請輸入房間代碼'; return; }
  $('#netErr').textContent = '連線中…';
  try { await net.join(code); $('#netErr').textContent = ''; }
  catch (e) { $('#netErr').textContent = '加入失敗：' + (e.type === 'peer-unavailable' ? '找不到房間' : e.message || e.type || e); }
};
$('#closeMenu').onclick = () => closeModal('#menu');
$('#btnMenu').onclick = openMenu;
$('#btnUndo').onclick = undo;
$('#btnFlip').onclick = () => flipTo(-stage.viewSide);
$('#btnNew').onclick = () => newGame();
$('#btnResign').onclick = resign;
$('#btnSound').onclick = () => {
  settings.sound = !settings.sound; sfx.enabled = settings.sound; saveSettings();
  $('#btnSound').textContent = settings.sound ? '🔊' : '🔇';
  if (!settings.sound) sfx.setMusic(false); else if (settings.music) sfx.setMusic(true);
};
$('#panelHandle').onclick = () => $('#panel').classList.toggle('collapsed');

/* ------------------------------ 角色自訂介面 ------------------------------ */
let customSide = 'red';
function renderCustomSide() {
  const army = settings[customSide], side = customSide === 'red' ? RED : BLACK;
  const pals = customSide === 'red' ? PALETTES.red : PALETTES.black;
  const box = $('#customSide');
  box.innerHTML = `
    <p class="hint">每顆棋子的人物都依照棋面文字的本義塑造；可在符合字義的造型中挑選。</p>
    <div class="swatches">${Object.entries(pals).map(([k, p]) => `<button class="swatch ${army.palette === k ? 'active' : ''}" data-pal="${k}"><i style="background:#${p.primary.toString(16).padStart(6, '0')}"></i>${p.name}</button>`).join('')}</div>
    <div class="piece-grid">${['K', 'A', 'B', 'N', 'R', 'C', 'P'].map(k => {
      const t = { K: 1, A: 2, B: 3, N: 4, R: 5, C: 6, P: 7 }[k];
      const opts = MODEL_OPTIONS[k][side];
      const cur = opts.includes(army.map[k]) ? army.map[k] : opts[0];
      return `<label><span class="pname">${NAMES[side][t]}</span><span class="meaning">${MEANING[k][side]}</span><select id="pm-${customSide}-${k}" data-k="${k}">${opts.map(m => `<option value="${m}" ${cur === m ? 'selected' : ''}>${MODEL_NAMES[m]}</option>`).join('')}</select></label>`;
    }).join('')}</div>
    <div class="row"><button class="ghost small" id="resetArmy">恢復字義預設造型</button></div>`;
  box.querySelectorAll('.swatch').forEach(b => b.onclick = () => { army.palette = b.dataset.pal; applyCustom(); renderCustomSide(); });
  box.querySelectorAll('select[data-k]').forEach(s => s.onchange = () => { army.map[s.dataset.k] = s.value; applyCustom(); });
  $('#resetArmy').onclick = () => { army.map = defaultMap(side); applyCustom(); renderCustomSide(); };
}
function applyCustom() {
  saveSettings();
  requestRebuild();
  if (mode === 'online') net.send({ t: 'army', army: settings[humanSide === RED ? 'red' : 'black'] });
}
document.querySelectorAll('.stab').forEach(b => b.onclick = () => {
  customSide = b.dataset.side;
  document.querySelectorAll('.stab').forEach(x => x.classList.toggle('active', x === b));
  renderCustomSide();
});
$('#boardStyle').innerHTML = Object.entries(BOARD_STYLES).map(([k, s]) => `<option value="${k}">${s.name}</option>`).join('');
function syncSceneControls() {
  $('#boardStyle').value = settings.board; $('#figScale').value = settings.figureScale; $('#animSpeed').value = settings.speed;
  $('#volume').value = settings.volume; $('#cinematic').checked = settings.cinematic; $('#badges').checked = settings.badges;
  $('#music').checked = settings.music; $('#hints').checked = settings.hints; $('#idleSounds').checked = settings.idleSounds;
}
$('#boardStyle').onchange = e => { settings.board = e.target.value; stage.setBoardStyle(settings.board); saveSettings(); };
$('#figScale').oninput = e => { settings.figureScale = +e.target.value; saveSettings(); clearTimeout(applyCustom._t); applyCustom._t = setTimeout(() => { requestRebuild(); }, 150); };
$('#animSpeed').oninput = e => { settings.speed = +e.target.value; saveSettings(); };
$('#volume').oninput = e => { settings.volume = +e.target.value; sfx.setVolume(settings.volume); saveSettings(); };
$('#cinematic').onchange = e => { settings.cinematic = e.target.checked; saveSettings(); };
$('#badges').onchange = e => { settings.badges = e.target.checked; saveSettings(); requestRebuild(); };
$('#music').onchange = e => { settings.music = e.target.checked; saveSettings(); sfx.setMusic(settings.music && settings.sound); };
$('#idleSounds').onchange = e => { settings.idleSounds = e.target.checked; saveSettings(); };
$('#hints').onchange = e => { settings.hints = e.target.checked; saveSettings(); refreshMarkers(); };
const openCustom = () => { renderCustomSide(); syncSceneControls(); openModal('#custom'); };
$('#btnCustom').onclick = openCustom;
$('#openCustom').onclick = openCustom;
$('#customDone').onclick = () => closeModal('#custom');

/* ------------------------------ 待機生氣：塵土、煙與環境音 ------------------------------ */
const _v = new THREE.Vector3();
let lastIdleSound = 0;
setIdleHook((kind, obj) => {
  if (!obj || !obj.getWorldPosition) return;
  obj.getWorldPosition(_v);
  if (kind === 'dust') fx.burst(_v.clone().setY(0.05), { count: 8, color: 0xb59a74, speed: 0.6, size: 0.025, life: 0.8, gravity: 1.5, emissive: false });
  else if (kind === 'dustUp') fx.burst(_v.clone(), { count: 18, color: 0xb59a74, speed: 1.2, size: 0.03, life: 1.2, gravity: 2, emissive: false, up: 2 });
  else if (kind === 'smoke') fx.smoke(_v.clone(), { count: 4, size: 0.05, life: 1.6 });
  else if (kind === 'breath') fx.smoke(_v.clone(), { count: 3, size: 0.03, life: 0.8, color: 0xdedad2 });
  else if (kind.startsWith('sound:') && settings.idleSounds) {
    const now = performance.now();
    if (busy || now - lastIdleSound < 1800) return;
    lastIdleSound = now;
    sfx.idle(kind.slice(6));
  }
});

/* ------------------------------ 改版原型對照面板 ------------------------------ */
const DEMO_RED = (70 << 8) | 7;      // 炮二進七（炮越過黑砲吃黑馬）
const DEMO_BLACK = (31 << 8) | 40;   // 卒５進１
async function demoReply() {
  if (mode !== 'demo' || game.result || game.turn !== BLACK || aiThinking) return;
  aiThinking = true;
  const n = game.history.length;
  await new Promise(r => setTimeout(r, 420));
  let m = 0;
  if (n === 1 && game.history[0].m === DEMO_RED && game.isLegal(DEMO_BLACK)) m = DEMO_BLACK;
  else { const res = await aiMove(); m = res.move; }
  aiThinking = false;
  if (mode === 'demo' && game.history.length === n && m) commitMove(m);
}
async function demoAuto() {
  startGame('demo');
  await new Promise(r => setTimeout(r, 650));
  aiThinking = true;              // 等紅方這步演完，再讓黑方照劇本回應
  await commitMove(DEMO_RED);
  aiThinking = false;
  demoReply();
}
// 手感滑桿：[版本設定群組, 鍵, 名稱, 最小, 最大, 間距, 單位]
const LAB_SLIDERS = [
  ['tune', 'cannonTotal', '炮吃馬整段', 400, 900, 10, 'ms'], ['tune', 'crouch', '炮身壓低', 60, 200, 5, 'ms'], ['tune', 'flight', '短弧飛行', 100, 320, 5, 'ms'],
  ['tune', 'stepTotal', '黑卒一步', 200, 360, 5, 'ms'], ['tune', 'leanFrac', '重心前傾佔比', 0.1, 0.4, 0.01, '%'],
  ['tune3', 'stepSec', '真人每步', 0.3, 0.9, 0.02, 's'], ['tune3', 'horseRun', '駿馬奔馳段', 1.0, 3.0, 0.05, 's'], ['tune3', 'slowmo', '慢動作倍率', 0.15, 1, 0.05, '×'],
];
const sliderText = (v, unit) => unit === '%' ? `${Math.round(v * 100)}%` : unit === '×' ? `×${(+v).toFixed(2)}` : unit === 's' ? `${(+v).toFixed(2)} 秒` : `${v} ms`;
const groupOf = () => settings.animVersion === 'v3' ? 'tune3' : settings.animVersion === 'v2' ? 'tune' : null;
function buildLab() {
  const box = $('#labTune');
  box.innerHTML = LAB_SLIDERS.map(([g, k, name, min, max, step]) =>
    `<label class="lab-slider" data-g="${g}"><span>${name}<b id="lv-${k}"></b></span><input type="range" id="ls-${k}" min="${min}" max="${max}" step="${step}"></label>`).join('') +
    `<button class="ghost small" id="labTuneReset">恢復起始值</button>`;
  LAB_SLIDERS.forEach(([g, k, , , , , unit]) => {
    const el = $(`#ls-${k}`);
    el.oninput = () => { settings[g][k] = +el.value; $(`#lv-${k}`).textContent = ' ' + sliderText(el.value, unit); saveSettings(); };
  });
  $('#labTuneReset').onclick = () => { settings.tune = { ...TUNE_DEFAULTS }; settings.tune3 = { ...TUNE3_DEFAULTS }; saveSettings(); updateLab(); };
  document.querySelectorAll('#labVer button').forEach(b => b.onclick = () => { settings.animVersion = b.dataset.v; saveSettings(); if (!busy) { rebuildPieces(); } updateLab(); });
  document.querySelectorAll('#labInt button').forEach(b => b.onclick = () => { settings.intensity = b.dataset.i; saveSettings(); updateLab(); });
  $('#labReset').onclick = () => startGame('demo');
  $('#labAuto').onclick = () => demoAuto();
  $('#labMin').onclick = () => $('#lab').classList.toggle('min');
  $('#openLab').onclick = () => { closeModal('#menu'); startGame('demo'); };
  if (window.matchMedia('(max-width: 820px)').matches) $('#lab').classList.add('min');
}
function updateLab() {
  if (!$('#lab')) return;
  document.querySelectorAll('#labVer button').forEach(b => b.classList.toggle('on', b.dataset.v === settings.animVersion));
  document.querySelectorAll('#labInt button').forEach(b => { b.classList.toggle('on', b.dataset.i === settings.intensity); b.disabled = !isV2(); });
  const g = groupOf();
  document.querySelectorAll('.lab-slider').forEach(l => { l.hidden = l.dataset.g !== g; });
  LAB_SLIDERS.forEach(([gg, k, , , , , unit]) => { const el = $(`#ls-${k}`); if (!el) return; el.value = settings[gg][k]; $(`#lv-${k}`).textContent = ' ' + sliderText(settings[gg][k], unit); });
  $('#labTune').closest('details').hidden = !g;
  const n = game.history.length;
  $('#labHint').textContent = mode !== 'demo' ? '' : n === 0 ? '點紅炮（右側），再點黑馬；黑方會回「卒５進１」。' : n === 1 ? '黑方應著中…' : n === 2 ? '兩步完成。可切換版本或強度後再試一次。' : '自由對弈中（黑方由電腦應對）。';
}
function updateLabStats() {
  const el = $('#labStats'); if (!el || !timeline.log.length) return;
  el.innerHTML = timeline.log.slice(0, 2).map(l => {
    const av = l.av.filter(a => a.frame != null).map(a => {
      const off = Math.round(a.frame + 8 - a.target);   // +8 毫秒 ≈ 60 Hz 半格，畫面真正顯示前的延遲
      const ok = Math.abs(off) <= 50;
      return `<span class="${ok ? 'ok' : 'bad'}">${{ impact: '命中', step: '腳步', place: '落盤', mech: '機括', drum: '鼓', hoof1: '前蹄', hoof2: '後蹄' }[a.name] || a.name} ${off >= 0 ? '+' : ''}${off}ms</span>`;
    }).join(' ');
    return `<div><b>${l.name}</b> 計畫 ${Math.round(l.planned)}ms・實際 ${Math.round(l.actual)}ms${av ? `<br><small>畫面對聲音：${av}</small>` : ''}</div>`;
  }).join('') + `<small>目前畫面約 ${Math.round(loop.fps || 0)} fps${(loop.fps || 60) < 40 ? '（幀率偏低，偏差會跟著放大）' : ''}；偏差 ±50ms 內為綠色。</small>`;
}
buildLab();
const intSel = $('#intensity');
if (intSel) { intSel.value = settings.intensity; intSel.onchange = () => { settings.intensity = intSel.value; saveSettings(); updateLab(); }; }

/* ------------------------------ 主迴圈 ------------------------------ */
const clock = new THREE.Clock();
let time = 0;
function advance(raw) {
  tw.update(raw);
  const dt = raw * tw.timeScale;
  time += dt;
  timeline.update();
  fx.update(dt);
  for (const [o, st] of states) poseRig(o.userData.rig, st, time);
}
function loop() {
  const raw = Math.min(clock.getDelta(), 0.05);
  if (!Clock.manual) {
    loop.fps = (loop.fps || 60) * 0.95 + (raw > 0 ? 1 / raw : 60) * 0.05;
    advance(raw);
    stage.render(raw, time);
    timeline.markFrame(performance.now());
    if (timeline.log.length && timeline.log[0] !== loop._lastLog) { loop._lastLog = timeline.log[0]; setTimeout(updateLabStats, 60); }
  }
  requestAnimationFrame(loop);
}
/** 逐格推進（截圖用）：把共用時鐘往前推 `ms` 毫秒，並只畫一格。 */
function stepFrames(ms, sub = 16, draw = true) {
  Clock.setManual(true);
  let left = ms;
  while (left > 0) { const d = Math.min(sub, left); Clock.t += d; advance(d / 1000); left -= d; }
  if (draw) stage.render(0.016, time);
}

/* ------------------------------ 啟動 ------------------------------ */
sfx.enabled = settings.sound; sfx.setVolume(settings.volume);
$('#btnSound').textContent = settings.sound ? '🔊' : '🔇';
stage.setBoardStyle(settings.board);
rebuildPieces();
loop();
document.addEventListener('pointerdown', () => { sfx.ensure(); if (settings.music && settings.sound && !sfx.musicOn) sfx.setMusic(true); }, { once: true });
const joinParam = new URLSearchParams(location.search).get('join');
if (joinParam) {
  document.querySelector('.tab[data-tab="online"]').click();
  $('#joinCode').value = joinParam;
}
if (window.matchMedia('(min-width: 821px)').matches) $('#panel').classList.remove('collapsed');
window.__xq = { game, stage, commitMove, settings, startGame, pieces: () => pieces, rebuild: () => rebuildPieces(), timeline, Clock, stepFrames, sfx, setVersion: v => { settings.animVersion = v; refreshMarkers(); updateLab(); } }; // 測試用介面
if (new URLSearchParams(location.search).has('lab')) { closeModal('#menu'); startGame('demo'); }
