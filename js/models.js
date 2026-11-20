// 程序化 3D 角色/動物模型 — procedural rigged figures that follow the literal meaning of each piece's character.
//   帥/將 元帥將軍   仕 文官   士 謀士   相 宰相   象 戰象   傌 騎兵(人+馬)   馬 戰馬
//   俥 戰車(人立車上)   車 馬拉戰車   炮 火砲(火字旁)   砲 投石機(石字旁)   兵 長槍兵   卒 刀盾步卒
// Each model returns a Group with userData.rig: an articulated skeleton + role the animator poses.
import * as THREE from 'three';
import { NAMES } from './rules.js';

/* ----------------------------- shared textures ----------------------------- */
const texCache = {};
function canvasTex(key, w, h, draw, srgb = true) {
  if (texCache[key]) return texCache[key];
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  texCache[key] = t;
  return t;
}
export function furBump() {
  return canvasTex('fur', 256, 256, (g, w, h) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const x = Math.random() * w, y = Math.random() * h, l = 2 + Math.random() * 6, v = (Math.random() * 255) | 0;
      g.strokeStyle = `rgba(${v},${v},${v},0.35)`; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.random() * 2 - 1, y + l); g.stroke();
    }
  }, false);
}
function skinBump() { // wrinkled elephant hide
  return canvasTex('hide', 256, 256, (g, w, h) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) {
      g.strokeStyle = `rgba(0,0,0,${0.1 + Math.random() * 0.25})`; g.lineWidth = 1 + Math.random() * 1.5;
      const x = Math.random() * w, y = Math.random() * h;
      g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + 10, y + Math.random() * 6 - 3, x + 20, y + Math.random() * 6 - 3, x + 30, y); g.stroke();
    }
  }, false);
}
function fabricBump() {
  return canvasTex('fabric', 128, 128, (g, w, h) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) { g.fillStyle = y % 4 ? '#8a8a8a' : '#707070'; g.fillRect(0, y, w, 1); }
    for (let x = 0; x < w; x += 2) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x, 0, 1, h); }
  }, false);
}
function scaleBump() { // lamellar armour plates 鱗甲
  return canvasTex('lamellar', 128, 128, (g, w, h) => {
    g.fillStyle = '#909090'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 12) for (let x = (y / 12) % 2 ? 0 : 8; x < w; x += 16) {
      g.fillStyle = '#5a5a5a'; g.fillRect(x, y, 15, 11); g.fillStyle = '#b8b8b8'; g.fillRect(x + 1, y + 1, 13, 4);
    }
  }, false);
}
function woodTex(seed = 0, base = '#7a3b1d', dark = '#4a200d') {
  return canvasTex('discwood' + seed + base, 256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      g.strokeStyle = dark + '40'; g.lineWidth = 1 + Math.random() * 2;
      g.beginPath(); g.arc(w / 2 + (Math.random() - 0.5) * 20, h / 2 + (Math.random() - 0.5) * 20, i * 2.2 + Math.random() * 3, 0, Math.PI * 2); g.stroke();
    }
  });
}
const FONT = '"BiauKai","DFKai-SB","KaiTi","STKaiti","Kaiti TC","Noto Serif TC","Noto Serif CJK TC","PMingLiU","WenQuanYi Zen Hei",serif';
function emblemTex(ch, color) { // 號衣 — the character sewn on a soldier's tabard
  return canvasTex('emb' + ch + color, 128, 128, (g) => {
    g.beginPath(); g.arc(64, 64, 60, 0, 7); g.fillStyle = '#f3e6c4'; g.fill();
    g.lineWidth = 6; g.strokeStyle = color; g.stroke();
    g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold 78px ${FONT}`; g.fillText(ch, 64, 68);
  });
}
function flagTex(ch, bg, fg) { // 帥旗 / 令旗
  return canvasTex('flag' + ch + bg, 128, 128, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = fg; g.lineWidth = 8; g.strokeRect(6, 6, 116, 116);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold 84px ${FONT}`; g.fillText(ch, 64, 70);
  });
}

/* ------------------------------ materials ------------------------------ */
const hex = c => '#' + c.toString(16).padStart(6, '0');
const M = {
  std: (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: o.r ?? 0.6, metalness: o.m ?? 0, ...o.extra }),
  phys: (color, o = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: o.r ?? 0.4, metalness: o.m ?? 0, clearcoat: o.cc ?? 0, clearcoatRoughness: 0.2, sheen: o.sheen ?? 0, sheenColor: new THREE.Color(o.sheenColor ?? 0xffffff), sheenRoughness: 0.6, ...o.extra }),
  fur: (color, r = 0.85) => new THREE.MeshStandardMaterial({ color, roughness: r, bumpMap: furBump(), bumpScale: 0.6 }),
  hide: (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.95, bumpMap: skinBump(), bumpScale: 1.2 }),
  coat: (color) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.42, sheen: 0.6, sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.4), clearcoat: 0.25, bumpMap: furBump(), bumpScale: 0.25 }), // glossy horse coat
  metal: (color, r = 0.28) => new THREE.MeshStandardMaterial({ color, roughness: r, metalness: 1 }),
  armor: (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.9, bumpMap: scaleBump(), bumpScale: 0.8 }),
  cloth: (color) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.75, sheen: 1, sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.5), sheenRoughness: 0.5, bumpMap: fabricBump(), bumpScale: 0.3, side: THREE.DoubleSide }),
  silk: (color) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, sheen: 1, sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.6), sheenRoughness: 0.3, side: THREE.DoubleSide }),
  skin: (color) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.55, sheen: 0.4, sheenColor: new THREE.Color(0xffccaa), clearcoat: 0.1 }),
  eye: () => new THREE.MeshPhysicalMaterial({ color: 0x0a0806, roughness: 0.05, clearcoat: 1 }),
  ivory: () => new THREE.MeshPhysicalMaterial({ color: 0xf3ead6, roughness: 0.3, clearcoat: 0.6 }),
  wood: (seed = 3) => new THREE.MeshStandardMaterial({ color: 0x6b4425, roughness: 0.7, map: woodTex(seed, '#6b4425', '#3a210f') }),
};

function mesh(geo, mat, x = 0, y = 0, z = 0, parent) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}
function pivot(parent, x = 0, y = 0, z = 0) { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }
const sph = (r, ws = 24, hs = 16, ...rest) => new THREE.SphereGeometry(r, ws, hs, ...rest);
const cap = (r, l, s = 8) => new THREE.CapsuleGeometry(r, l, 6, s * 2);
const cyl = (rt, rb, h, s = 20) => new THREE.CylinderGeometry(rt, rb, h, s);
const cone = (r, h, s = 20) => new THREE.ConeGeometry(r, h, s);

function addEyes(head, r, spread, y, z) {
  const em = M.eye(), eyes = [];
  [-1, 1].forEach(s => {
    const e = mesh(sph(r, 12, 10), em, s * spread, y, z, head);
    const hl = mesh(sph(r * 0.3, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), r * 0.35, r * 0.35, r * 0.8, e);
    hl.castShadow = false;
    eyes.push(e);
  });
  return eyes;
}

/** Character emblem (棋字) on the figure body, facing outward along +z of `parent` space after rotY. */
function emblem(parent, ch, color, x, y, z, rotY, r = 0.06) {
  const tex = emblemTex(ch, color);
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 32), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0x3a3a3a, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.position.set(x, y, z); m.rotation.y = rotY; m.castShadow = false; m.receiveShadow = true;
  parent.add(m);
  return m;
}

/* ------------------------------ palettes ------------------------------ */
export const PALETTES = {
  red: {
    crimson: { name: '朱紅金甲', primary: 0xa3161b, secondary: 0xe8b84a, metal: 0xd9a441, cloth: 0x8e0f16, robe: 0x7a1020, text: '#b3121a', rim: 0xb3121a },
    imperial: { name: '皇家明黃', primary: 0xc98a12, secondary: 0x8e1414, metal: 0xe9c25a, cloth: 0xd49b1c, robe: 0xb3700c, text: '#a8670a', rim: 0xc98a12 },
    jade: { name: '翡翠青玉', primary: 0x1f7a55, secondary: 0xd8c9a0, metal: 0xc0c7b5, cloth: 0x166044, robe: 0x12543b, text: '#14724c', rim: 0x1f7a55 },
  },
  black: {
    obsidian: { name: '玄黑鐵甲', primary: 0x22252b, secondary: 0x8f9aa8, metal: 0x9aa4b0, cloth: 0x1b1d22, robe: 0x23262e, text: '#1a1c20', rim: 0x24272d },
    azure: { name: '靛藍銀甲', primary: 0x1c3b7a, secondary: 0xc9d3e3, metal: 0xc4ccd8, cloth: 0x183064, robe: 0x142a58, text: '#173072', rim: 0x1c3b7a },
    violet: { name: '紫晶魔甲', primary: 0x4b1f6e, secondary: 0xd3b6f0, metal: 0xb7a4c9, cloth: 0x3c165a, robe: 0x34124f, text: '#47196b', rim: 0x4b1f6e },
  },
};

/* --------------- catalogue: options per side/type follow the character's meaning --------------- */
export const MODEL_NAMES = {
  marshal: '元帥（持劍披風）', marshalHalberd: '元帥（方天畫戟）', marshalFlag: '元帥（揮令旗）',
  official: '文官（手捧奏卷）', strategist: '謀士（羽扇綸巾）', guard: '御前衛士（持戟）',
  chancellor: '宰相（執笏）', warElephant: '戰象（背負象轎）', elephant: '亞洲象',
  cavalry: '騎兵・棗紅戰馬', cavalryWhite: '騎兵・白龍駒', cavalryRed: '騎兵・赤兔馬', cavalryBlack: '騎兵・烏騅馬',
  chariot: '戰車（武士立乘）', horseChariot: '馬拉戰車',
  cannon: '銅火砲', catapult: '投石機',
  spearman: '長槍兵', swordsman: '刀盾步卒', archer: '弓箭手',
};
// 1 = red, -1 = black. First entry is the literal default.
export const MODEL_OPTIONS = {
  K: { 1: ['marshal', 'marshalHalberd', 'marshalFlag'], [-1]: ['marshal', 'marshalHalberd', 'marshalFlag'] },
  A: { 1: ['official', 'guard', 'strategist'], [-1]: ['strategist', 'guard', 'official'] },
  B: { 1: ['chancellor'], [-1]: ['warElephant', 'elephant'] },
  N: { 1: ['cavalry', 'cavalryRed', 'cavalryWhite', 'cavalryBlack'], [-1]: ['cavalryBlack', 'cavalry', 'cavalryWhite', 'cavalryRed'] },
  R: { 1: ['chariot', 'horseChariot'], [-1]: ['horseChariot', 'chariot'] },
  C: { 1: ['cannon'], [-1]: ['catapult'] },
  P: { 1: ['spearman', 'archer'], [-1]: ['swordsman', 'spearman'] },
};
export const MEANING = {
  K: { 1: '帥：統帥三軍的元帥', [-1]: '將：統兵的大將軍' },
  A: { 1: '仕：入朝為官的文臣', [-1]: '士：運籌帷幄的謀士' },
  B: { 1: '相：輔佐君王的宰相', [-1]: '象：衝鋒陷陣的戰象' },
  N: { 1: '傌：人字旁，騎在馬上的騎兵', [-1]: '馬：騎士策馬馳騁的戰騎' },
  R: { 1: '俥：人字旁，武士立乘的戰車', [-1]: '車：駿馬牽引的戰車' },
  C: { 1: '炮：火字旁，火藥銅砲', [-1]: '砲：石字旁，拋石的投石機' },
  P: { 1: '兵：手持兵器的長槍兵', [-1]: '卒：號衣書「卒」的步卒' },
};
export function defaultMap(side) {
  const m = {}; for (const k in MODEL_OPTIONS) m[k] = MODEL_OPTIONS[k][side][0]; return m;
}

/* ------------------------------ disc base ------------------------------ */
function charTexture(ch, color) {
  return canvasTex('ch' + ch + color, 256, 256, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2);
    grd.addColorStop(0, '#f2dcae'); grd.addColorStop(1, '#d9b47a');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 30; i++) { g.strokeStyle = 'rgba(120,70,30,0.08)'; g.lineWidth = 2; g.beginPath(); g.arc(w / 2 + 6, h / 2 - 4, i * 4.3, 0, 7); g.stroke(); }
    g.strokeStyle = color; g.lineWidth = 7; g.beginPath(); g.arc(w / 2, h / 2, w * 0.41, 0, 7); g.stroke();
    g.lineWidth = 2; g.beginPath(); g.arc(w / 2, h / 2, w * 0.37, 0, 7); g.stroke();
    g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold 140px ${FONT}`;
    g.shadowColor = 'rgba(0,0,0,0.25)'; g.shadowOffsetY = 2; g.shadowBlur = 2;
    g.fillText(ch, w / 2, h / 2 + 6);
  });
}
export function makeBadge(ch, color) {
  const tex = canvasTex('badge' + ch + color, 128, 128, (g) => {
    g.beginPath(); g.arc(64, 64, 58, 0, 7); g.fillStyle = '#f4e3bd'; g.fill();
    g.lineWidth = 6; g.strokeStyle = color; g.stroke();
    g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold 72px ${FONT}`; g.fillText(ch, 64, 68);
  });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
  sp.scale.set(0.3, 0.3, 0.3); sp.renderOrder = 5;
  return sp;
}
function makeDisc(side, type, pal, withFigure) {
  const g = new THREE.Group();
  const h = withFigure ? 0.12 : 0.2, R = 0.43;
  const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(R - 0.03, 0), new THREE.Vector2(R, 0.025), new THREE.Vector2(R, h - 0.025), new THREE.Vector2(R - 0.03, h), new THREE.Vector2(0, h)];
  mesh(new THREE.LatheGeometry(pts, 48), M.phys(0xd8b27a, { r: 0.35, cc: 0.8, extra: { map: woodTex(1, '#d1a46a', '#8b5a2b') } }), 0, 0, 0, g);
  mesh(new THREE.CylinderGeometry(R + 0.002, R + 0.002, 0.025, 48, 1, true), M.phys(pal.rim, { r: 0.3, cc: 1 }), 0, h * 0.5, 0, g);
  const top = mesh(new THREE.CircleGeometry(R - 0.03, 48), M.phys(0xffffff, { r: 0.4, cc: 0.9, extra: { map: charTexture(NAMES[side][type], pal.text) } }), 0, h + 0.001, 0, g);
  top.rotation.x = -Math.PI / 2; top.rotation.z = side > 0 ? 0 : Math.PI;
  g.userData.height = h;
  return g;
}

/* ------------------------------ biped (human) rig ------------------------------ */
function biped(o) {
  const root = new THREE.Group();
  const skin = M.skin(o.skin ?? 0xe0b48c);
  const robeMat = o.robe ? M.silk(o.robeColor ?? o.primary) : null;
  const prim = robeMat || M.phys(o.primary, { r: 0.5, sheen: 0.5 });
  const metal = M.metal(o.metal);
  const armorMat = M.armor(o.metal);
  const dark = M.std(0x2a1c12, { r: 0.7 });
  const hips = pivot(root, 0, 0.36, 0);
  const rig = { kind: 'biped', role: o.role || 'soldier', root, hips, legs: [], arms: [] };
  rig.knees = [];
  [-1, 1].forEach(s => {
    const hp = pivot(hips, s * 0.07, 0, 0);
    const legMat = o.robe ? prim : M.phys(o.secondary, { r: 0.6 });
    mesh(cap(0.047, 0.1), legMat, 0, -0.085, 0, hp);              // thigh
    const kn = pivot(hp, 0, -0.17, 0);                              // knee joint
    mesh(cap(0.04, 0.1), legMat, 0, -0.07, 0, kn);                  // shin
    if (o.armor) mesh(cyl(0.046, 0.042, 0.07, 12), armorMat, 0, -0.07, 0.005, kn); // greave
    mesh(new THREE.BoxGeometry(0.08, 0.05, 0.13), dark, 0, -0.165, 0.025, kn);    // boot
    rig.legs.push(hp); rig.knees.push(kn);
  });
  if (o.robe) {
    const skirt = pivot(hips, 0, 0, 0); rig.skirt = skirt;
    mesh(new THREE.CylinderGeometry(0.1, 0.2, 0.36, 28, 1, true), prim, 0, -0.15, 0, skirt);
    mesh(new THREE.TorusGeometry(0.2, 0.008, 6, 28), M.metal(o.secondary), 0, -0.33, 0, skirt).rotation.x = Math.PI / 2;
  }
  const chest = pivot(hips, 0, 0.04, 0); rig.chest = chest;
  mesh(cap(0.12, 0.16), prim, 0, 0.16, 0, chest).scale.set(1, 1, 0.75);
  mesh(cyl(0.125, 0.125, 0.05), M.std(o.robe ? o.secondary : 0x3a2412, { r: 0.5 }), 0, 0.04, 0, chest);
  if (o.robe) { // wide sleeves' collar 交領
    const col = mesh(new THREE.TorusGeometry(0.075, 0.012, 6, 20, Math.PI), M.silk(o.secondary), 0, 0.27, 0.05, chest); col.rotation.set(-0.9, 0, Math.PI);
  }
  let frontZ = 0.092;
  if (o.armor) {
    const plate = mesh(cap(0.13, 0.12), armorMat, 0, 0.19, 0.01, chest); plate.scale.set(1.04, 1, 0.8);
    mesh(sph(0.04, 14, 10), metal, 0, 0.2, 0.11, chest).scale.set(1, 1, 0.4); // 護心鏡
    rig.pauldrons = [-1, 1].map(s => { const pv = pivot(chest, s * 0.13, 0.31, 0); const pad = mesh(sph(0.075, 16, 10), armorMat, s * 0.02, -0.02, 0, pv); pad.scale.set(1, 0.6, 1); return pv; });
    mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.12, 20, 1, true), armorMat, 0, -0.03, 0, chest);
    frontZ = 0.118;
  }
  if (o.pauldrons && !o.armor) { // leather shoulder guards 皮肩甲 that settle after each step
    const lm = M.std(0x4a2e1a, { r: 0.55, extra: { bumpMap: scaleBump(), bumpScale: 0.4 } });
    rig.pauldrons = [-1, 1].map(s => { const pv = pivot(chest, s * 0.13, 0.31, 0); const pad = mesh(sph(0.07, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), lm, s * 0.025, -0.025, 0, pv); pad.scale.set(1, 0.8, 1.05); return pv; });
  }
  if (o.emblem) { // 棋字 on chest and back so it reads from either side of the board
    const ey = o.armor ? 0.15 : 0.16;
    emblem(chest, o.emblem, o.emblemColor, 0, ey, frontZ + 0.006, 0, 0.075);
    if (!o.cape) emblem(chest, o.emblem, o.emblemColor, 0, ey, -frontZ - 0.006, Math.PI, 0.075);
  }
  if (o.cape) {
    const cp = pivot(chest, 0, 0.3, -0.1); rig.cape = cp;
    const c = mesh(new THREE.PlaneGeometry(0.32, 0.52, 6, 8), M.cloth(o.cloth), 0, -0.26, 0, cp); c.rotation.x = 0.12;
    if (o.emblem) emblem(c, o.emblem, o.emblemColor, 0, 0.05, -0.004, Math.PI, 0.1);
  }
  // head
  const neck = pivot(chest, 0, 0.32, 0); rig.head = neck;
  mesh(cyl(0.04, 0.045, 0.06), skin, 0, 0.02, 0, neck);
  const head = mesh(sph(0.095, 28, 20), skin, 0, 0.12, 0.005, neck); head.scale.set(0.95, 1.05, 1);
  rig.eyes = addEyes(head, 0.014, 0.035, 0.012, 0.082);
  [-1, 1].forEach(s => { const br = mesh(new THREE.BoxGeometry(0.03, 0.006, 0.006), M.std(0x1b120c), s * 0.035, 0.035, 0.087, head); br.rotation.z = s * -0.2; });
  mesh(sph(0.014, 8, 6), skin, 0, -0.012, 0.094, head);
  mesh(new THREE.TorusGeometry(0.022, 0.005, 6, 12, Math.PI), M.std(0x7a3a2a), 0, -0.04, 0.085, head).rotation.z = Math.PI;
  if (o.beard) {
    const b = pivot(head, 0, -0.06, 0.07); rig.beard = b;
    const bd = mesh(cone(0.045, o.beard === 'long' ? 0.2 : 0.12, 12), M.fur(o.beardColor ?? 0x1a110a), 0, -0.07, 0, b); bd.rotation.x = Math.PI + 0.25;
    [-1, 1].forEach(s => { const mu = mesh(cyl(0.004, 0.006, 0.06, 6), M.fur(o.beardColor ?? 0x1a110a), s * 0.025, 0.035, 0.015, b); mu.rotation.z = s * 1.0; });
  }
  mesh(sph(0.098, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.fur(o.hair ?? 0x1b120c), 0, 0.02, -0.01, head).scale.set(1, 0.9, 1);
  mesh(sph(0.035, 12, 8), M.fur(o.hair ?? 0x1b120c), 0, 0.1, -0.05, head); // topknot 髮髻
  const hg = o.helmet;
  if (hg === 'plume') {
    mesh(sph(0.11, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), armorMat, 0, 0.02, 0, head);
    mesh(cone(0.02, 0.1, 10), metal, 0, 0.14, 0, head);
    const plume = pivot(head, 0, 0.19, 0); rig.plume = plume;
    mesh(cone(0.04, 0.17, 12), M.fur(o.cloth), 0, 0.06, -0.03, plume).rotation.x = -0.5;
    mesh(new THREE.TorusGeometry(0.11, 0.012, 8, 28), M.metal(o.secondary), 0, 0.02, 0, head).rotation.x = Math.PI / 2;
    [-1, 1].forEach(s => { const w = mesh(new THREE.BoxGeometry(0.02, 0.07, 0.06), armorMat, s * 0.1, -0.03, -0.01, head); });
  } else if (hg === 'wingHat') { // 宰相 烏紗帽 with long wings
    mesh(cyl(0.085, 0.1, 0.1), M.std(0x111111, { r: 0.35 }), 0, 0.1, -0.01, head);
    mesh(cyl(0.06, 0.07, 0.06), M.std(0x111111, { r: 0.35 }), 0, 0.17, -0.03, head);
    const wings = pivot(head, 0, 0.11, -0.07); rig.wings = wings;
    mesh(new THREE.BoxGeometry(0.5, 0.012, 0.03), M.std(0x111111, { r: 0.35 }), 0, 0, 0, wings);
  } else if (hg === 'futou') { // 文官幞頭 short wings
    mesh(cyl(0.085, 0.1, 0.09), M.std(0x161616, { r: 0.4 }), 0, 0.09, -0.01, head);
    [-1, 1].forEach(s => { const w = mesh(new THREE.BoxGeometry(0.12, 0.01, 0.025), M.std(0x161616), s * 0.13, 0.1, -0.06, head); w.rotation.z = s * 0.25; });
  } else if (hg === 'scarf') { // 綸巾
    mesh(sph(0.102, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), M.silk(0x2d4a5a), 0, 0.02, -0.005, head);
    [-1, 1].forEach(s => { const t = mesh(new THREE.PlaneGeometry(0.03, 0.14), M.silk(0x2d4a5a), s * 0.03, -0.02, -0.1, head); t.rotation.x = 0.2; });
  } else if (hg === 'cap') {
    mesh(sph(0.105, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), armorMat, 0, 0.02, 0, head);
    mesh(cone(0.015, 0.06, 8), M.std(o.cloth), 0, 0.12, 0, head);
  } else if (hg === 'band') {
    mesh(new THREE.TorusGeometry(0.097, 0.014, 8, 24), M.cloth(o.cloth), 0, 0.04, 0, head).rotation.x = Math.PI / 2 - 0.1;
  }
  // arms
  [-1, 1].forEach(s => {
    const sh = pivot(chest, s * 0.17, 0.27, 0);
    mesh(cap(0.038, 0.14), o.robe ? prim : (o.armor ? armorMat : prim), 0, -0.09, 0, sh);
    const fore = pivot(sh, 0, -0.18, 0);
    if (o.robe) { mesh(new THREE.CylinderGeometry(0.04, 0.075, 0.14, 14, 1, true), prim, 0, -0.07, 0, fore); } // wide sleeve 廣袖
    else mesh(cap(0.033, 0.11), skin, 0, -0.06, 0, fore);
    if (o.armor) mesh(cyl(0.04, 0.036, 0.08, 12), metal, 0, -0.05, 0, fore); // bracer
    const hand = mesh(sph(0.035, 12, 8), skin, 0, -0.15, 0.01, fore);
    rig.arms.push({ sh, fore, hand });
  });
  const weap = pivot(rig.arms[1].fore, 0, -0.15, 0.02); rig.weapon = weap;
  const steel = M.metal(0xdfe6ee, 0.15);
  switch (o.weapon) {
    case 'sword':
      mesh(new THREE.BoxGeometry(0.025, 0.4, 0.008), steel, 0, 0.02, 0.22, weap).rotation.x = Math.PI / 2;
      mesh(new THREE.BoxGeometry(0.11, 0.02, 0.03), M.metal(o.secondary), 0, 0, 0.02, weap);
      mesh(cyl(0.012, 0.012, 0.06, 8), M.std(0x3a1a0a), 0, 0, -0.02, weap).rotation.x = Math.PI / 2;
      weap.rotation.x = -0.2; break;
    case 'dao': // 刀 single-edged broadsword
      mesh(new THREE.BoxGeometry(0.04, 0.3, 0.008), steel, 0, 0.0, 0.17, weap).rotation.x = Math.PI / 2;
      mesh(new THREE.BoxGeometry(0.07, 0.02, 0.03), metal, 0, 0, 0.02, weap);
      weap.rotation.x = -0.2; break;
    case 'halberd': // 方天畫戟
      mesh(cyl(0.012, 0.012, 1.0, 8), M.std(0x5a1a10, { r: 0.4 }), 0, 0.18, 0, weap);
      mesh(cone(0.028, 0.14, 8), steel, 0, 0.74, 0, weap);
      [-1, 1].forEach(s => { const c = mesh(new THREE.TorusGeometry(0.05, 0.008, 6, 14, Math.PI), steel, s * 0.05, 0.62, 0, weap); c.rotation.z = s > 0 ? -Math.PI / 2 : Math.PI / 2; });
      mesh(cone(0.04, 0.06, 10), M.cloth(o.cloth), 0, 0.55, 0, weap); break;
    case 'spear':
      mesh(cyl(0.012, 0.012, 0.9, 8), M.std(0x6b4423, { r: 0.6 }), 0, 0.15, 0, weap);
      mesh(cone(0.03, 0.12, 8), steel, 0, 0.66, 0, weap);
      mesh(cone(0.04, 0.06, 10), M.cloth(o.cloth), 0, 0.57, 0, weap); break;
    case 'featherFan': { // 羽扇
      const fan = pivot(weap, 0, 0.02, 0.02); rig.fan = fan;
      mesh(cyl(0.008, 0.008, 0.08, 6), M.std(0x5a3216), 0, 0.02, 0, fan);
      const f = mesh(new THREE.CircleGeometry(0.11, 18, 0, Math.PI), M.std(0xf6f1e6, { r: 0.9, extra: { side: THREE.DoubleSide, bumpMap: furBump(), bumpScale: 0.4 } }), 0, 0.06, 0, fan);
      f.scale.set(0.8, 1.4, 1); break;
    }
    case 'scroll': // 奏卷
      mesh(cyl(0.022, 0.022, 0.16, 12), M.std(0xefe2c0, { r: 0.8 }), 0, 0.0, 0.03, weap).rotation.z = Math.PI / 2;
      [-1, 1].forEach(s => mesh(cyl(0.026, 0.026, 0.015, 12), M.std(0x5a1a10), s * 0.085, 0, 0.03, weap).rotation.z = Math.PI / 2);
      break;
    case 'tablet': // 笏板
      mesh(new THREE.BoxGeometry(0.04, 0.2, 0.012), M.ivory(), 0, 0.08, 0.03, weap); break;
    case 'flag': { // 令旗
      mesh(cyl(0.008, 0.008, 0.55, 6), M.std(0x5a3216), 0, 0.16, 0, weap);
      const fl = pivot(weap, 0, 0.36, 0); rig.flag = fl;
      const f = mesh(new THREE.PlaneGeometry(0.16, 0.16, 4, 4), M.std(0xffffff, { r: 0.8, extra: { map: flagTex(o.flagChar ?? '令', hex(o.cloth), hex(o.secondary)), side: THREE.DoubleSide } }), 0.08, 0, 0, fl);
      break;
    }
    case 'bow': {
      const bow = mesh(new THREE.TorusGeometry(0.22, 0.01, 6, 24, Math.PI * 0.9), M.std(0x5a3216, { r: 0.5 }), 0, 0, 0.02, weap);
      bow.rotation.set(0, Math.PI / 2, Math.PI * 0.55);
      const quiver = mesh(cyl(0.035, 0.03, 0.22, 10), M.std(0x5a3216), 0.05, 0.2, -0.12, chest); quiver.rotation.z = -0.4;
      break;
    }
  }
  if (o.shield) {
    const lf = rig.arms[0].fore;
    const sh = mesh(o.shield === 'round' ? cyl(0.12, 0.12, 0.02, 24) : new THREE.BoxGeometry(0.02, 0.26, 0.15), M.phys(o.primary, { r: 0.4, cc: 0.5, extra: o.shield === 'round' ? {} : { map: emblemTex(o.emblem ?? '兵', o.emblemColor ?? '#a00') } }), -0.035, -0.08, 0.05, lf);
    if (o.shield === 'round') sh.rotation.z = Math.PI / 2;
    mesh(sph(0.03, 10, 8), metal, -0.015, 0, 0, sh);
    rig.shield = sh;
  }
  root.userData.rig = rig;
  return root;
}

/* ------------------------------ quadruped rig (horse / elephant) ------------------------------ */
function quad(o) {
  const root = new THREE.Group();
  const s = o.size ?? 1;
  const fur = o.matFn ? o.matFn(o.color) : M.fur(o.color, o.rough ?? 0.85);
  const legLen = (o.legLen ?? 0.22) * s;
  const bodyR = (o.bodyR ?? 0.11) * s, bodyL = (o.bodyL ?? 0.26) * s;
  const H = legLen + bodyR * 0.9;
  const body = pivot(root, 0, H, 0);
  const rig = { kind: 'quad', role: o.role, root, body, legs: [], H, bodyR, bodyL };
  mesh(cap(bodyR, bodyL, 10), fur, 0, 0, 0, body).rotation.x = Math.PI / 2;
  // shoulder & haunch muscles for a less tube-like silhouette
  mesh(sph(bodyR * 1.02, 18, 12), fur, 0, bodyR * 0.05, bodyL * 0.38, body).scale.set(0.95, 1.05, 1);
  mesh(sph(bodyR * 1.05, 18, 12), fur, 0, bodyR * 0.08, -bodyL * 0.4, body).scale.set(0.98, 1.05, 1);
  const legR = (o.legR ?? 0.035) * s;
  [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([sx, sz]) => {
    const hp = pivot(body, sx * bodyR * 0.58, -bodyR * 0.3, sz * bodyL * 0.42);
    mesh(cap(legR * 1.35, legLen * 0.4), fur, 0, -legLen * 0.22, 0, hp);
    const knee = pivot(hp, 0, -legLen * 0.5, 0);
    const lowMat = o.legColor ? (o.matFn ? o.matFn(o.legColor) : M.fur(o.legColor)) : fur;
    mesh(cap(legR, legLen * 0.38), lowMat, 0, -legLen * 0.22, 0, knee);
    if (o.hoof) {
      mesh(cyl(legR * 1.05, legR * 1.25, legR * 1.3, 12), M.std(0x1c1410, { r: 0.4 }), 0, -legLen * 0.47, 0, knee);
      if (o.feathering) mesh(cyl(legR * 1.4, legR * 1.6, legR * 1.4, 12), M.fur(o.feathering, 0.95), 0, -legLen * 0.4, 0, knee);
    } else { // elephant pad foot with toenails
      mesh(cyl(legR * 1.15, legR * 1.3, legR * 1.2, 16), lowMat, 0, -legLen * 0.47, 0, knee);
      for (let i = -1; i <= 1; i++) mesh(sph(legR * 0.25, 8, 6), M.ivory(), i * legR * 0.6, -legLen * 0.5, legR * 1.15, knee);
    }
    rig.legs.push({ hp, knee, front: sz > 0, side: sx });
  });
  // neck + head
  const neckLen = (o.neckLen ?? 0.1) * s;
  const neck = pivot(body, 0, bodyR * 0.4, bodyL * 0.55); rig.neck = neck;
  neck.rotation.x = -(o.neckAngle ?? 0.6);
  mesh(cap(bodyR * (o.neckThick ?? 0.55), neckLen, 8), fur, 0, neckLen * 0.5, 0, neck);
  const head = pivot(neck, 0, neckLen + bodyR * 0.2, 0); rig.head = head;
  head.rotation.x = (o.neckAngle ?? 0.6);
  const hr = (o.headR ?? 0.07) * s;
  const skull = mesh(sph(hr, 24, 16), fur, 0, 0, 0, head); skull.scale.set(o.skullW ?? 1, 0.95, 1.1);
  const ml = (o.muzzle ?? 0.06) * s;
  if (ml > 0.02) {
    const muz = mesh(cap(hr * (o.muzzleR ?? 0.55), ml, 8), o.muzzleColor ? M.fur(o.muzzleColor) : fur, 0, -hr * 0.2, hr * 0.7 + ml * 0.3, head);
    muz.rotation.x = Math.PI / 2 - (o.muzzleTilt ?? 0.3);
    [-1, 1].forEach(sx => mesh(sph(hr * 0.09, 8, 6), M.phys(0x15100c, { r: 0.2, cc: 0.8 }), sx * hr * 0.18, -hr * 0.05 - ml * 0.55, hr * 0.75 + ml * 0.75, head)); // nostrils
    if (o.blaze) { const bl = mesh(new THREE.PlaneGeometry(hr * 0.3, ml * 1.4), M.fur(0xf5f0e8), 0, hr * 0.15, hr * 0.98, head); bl.rotation.x = -0.6; }
  }
  rig.eyes = addEyes(head, hr * 0.12, hr * (o.eyeSpread ?? 0.55), hr * 0.25, hr * 0.78);
  rig.ears = [];
  if (o.ears === 'big') { // flapping elephant ears on pivots
    [-1, 1].forEach(sx => {
      const ep = pivot(head, sx * hr * 0.75, hr * 0.15, -hr * 0.25);
      const e = mesh(new THREE.CircleGeometry(hr * 1.2, 24), M.hide(o.color), sx * hr * 0.6, -hr * 0.2, 0, ep);
      e.material.side = THREE.DoubleSide; e.scale.set(1, 1.25, 1);
      ep.rotation.y = sx * 1.25;
      ep.userData.side = sx;
      rig.ears.push(ep);
    });
  } else if (o.ears) {
    [-1, 1].forEach(sx => {
      const ep = pivot(head, sx * hr * 0.45, hr * 0.8, -hr * 0.15);
      mesh(cone(hr * 0.22, hr * 0.75, 10), fur, 0, hr * 0.3, 0, ep);
      ep.rotation.z = -sx * 0.2; ep.userData.side = sx;
      rig.ears.push(ep);
    });
  }
  if (o.mane) { // flowing horse mane + forelock
    const mn = pivot(neck, 0, 0, -bodyR * 0.35); rig.mane = mn;
    for (let i = 0; i < 7; i++) {
      const t = mesh(new THREE.BoxGeometry(0.018 * s, neckLen * 0.28, bodyR * 0.55), M.fur(o.mane, 0.95), 0, neckLen * (0.1 + i * 0.14), -bodyR * 0.05, mn);
      t.rotation.x = 0.25;
    }
    mesh(new THREE.BoxGeometry(hr * 0.5, hr * 0.5, 0.012 * s), M.fur(o.mane, 0.95), 0, hr * 0.75, hr * 0.55, head).rotation.x = -0.6;
  }
  if (o.trunk) {
    const tr = pivot(head, 0, -hr * 0.25, hr * 0.85); rig.trunk = tr;
    let parent = tr; rig.trunkSegs = [];
    for (let i = 0; i < 7; i++) {
      const seg = pivot(parent, 0, i ? -hr * 0.27 : 0, 0);
      mesh(cyl(hr * (0.26 - i * 0.025), hr * (0.29 - i * 0.025), hr * 0.3, 14), fur, 0, -hr * 0.14, 0, seg);
      seg.rotation.x = i ? 0.15 : -0.15; parent = seg; rig.trunkSegs.push(seg);
    }
    [-1, 1].forEach(sx => { const t = mesh(cone(hr * 0.1, hr * 0.95, 10), M.ivory(), sx * hr * 0.38, -hr * 0.6, hr * 0.95, head); t.rotation.x = Math.PI * 0.72; });
    // forehead dome
    mesh(sph(hr * 0.8, 16, 12), fur, 0, hr * 0.45, hr * 0.2, head);
  }
  // tail
  const tail = pivot(body, 0, bodyR * 0.3, -bodyL * 0.62); rig.tail = tail;
  const tl = (o.tailLen ?? 0.18) * s;
  if (o.tail === 'horse') {
    mesh(cyl(0.012 * s, 0.022 * s, tl * 0.25, 8), fur, 0, -tl * 0.08, -tl * 0.05, tail).rotation.x = 0.5;
    const hair = mesh(cone(tl * 0.16, tl, 10), M.fur(o.tailColor ?? o.mane ?? 0x1a100a, 0.95), 0, -tl * 0.55, -tl * 0.15, tail); hair.rotation.x = Math.PI + 0.25;
  } else {
    mesh(cyl(0.008 * s, 0.014 * s, tl, 6), fur, 0, -tl * 0.45, -tl * 0.15, tail).rotation.x = 0.35;
    mesh(sph(0.022 * s, 8, 6), M.fur(0x2a2a2a), 0, -tl * 0.92, -tl * 0.3, tail).scale.set(0.7, 1.6, 0.7);
  }
  tail.rotation.x = o.tailUp ?? -0.3;
  const cloth = M.cloth(o.cloth);
  if (o.saddle) {
    const sd = mesh(new THREE.CylinderGeometry(bodyR * 1.07, bodyR * 1.07, bodyL * (o.howdah ? 0.75 : 0.45), 24, 1, true, -Math.PI * 0.45, Math.PI * 0.9), cloth, 0, 0, o.howdah ? 0 : bodyL * 0.08, body);
    sd.rotation.set(Math.PI / 2, Math.PI, 0);
    mesh(new THREE.TorusGeometry(bodyR * 1.08, 0.006 * s, 6, 24, Math.PI * 0.9), M.metal(o.metal), 0, 0, bodyL * 0.3, body).rotation.z = Math.PI * 0.05;
    if (!o.howdah) { // leather saddle seat + stirrups
      mesh(new THREE.BoxGeometry(bodyR * 0.9, bodyR * 0.25, bodyL * 0.35), M.std(0x4a2a14, { r: 0.45 }), 0, bodyR * 0.98, bodyL * 0.08, body);
      [-1, 1].forEach(sx => mesh(new THREE.TorusGeometry(0.018 * s, 0.004 * s, 6, 12), M.metal(o.metal), sx * bodyR * 1.05, -bodyR * 0.75, bodyL * 0.08, body).rotation.y = Math.PI / 2);
    }
    if (o.howdah) { // 象轎 with canopy and faction banner
      const hw = pivot(body, 0, bodyR * 1.0, 0); rig.howdah = hw;
      mesh(new THREE.BoxGeometry(bodyR * 1.1, bodyR * 0.5, bodyL * 0.65), M.phys(o.primary, { r: 0.4, cc: 0.6 }), 0, bodyR * 0.25, 0, hw);
      mesh(cone(bodyR * 0.85, bodyR * 0.7, 4), M.metal(o.metal), 0, bodyR * 1.15, 0, hw).rotation.y = Math.PI / 4;
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([x, z]) => mesh(cyl(0.006 * s, 0.006 * s, bodyR * 0.75, 6), M.metal(o.metal), x * bodyR * 0.5, bodyR * 0.85, z * bodyL * 0.28, hw));
      const fl = pivot(hw, 0, bodyR * 1.5, 0); rig.flag = fl;
      mesh(cyl(0.004 * s, 0.004 * s, bodyR * 0.8, 6), M.metal(o.metal), 0, bodyR * 0.2, 0, fl);
      mesh(new THREE.PlaneGeometry(bodyR * 0.6, bodyR * 0.4), M.cloth(o.cloth), bodyR * 0.3, bodyR * 0.45, 0, fl);
      // mahout 象夫 on the neck
      const mh = biped({ role: 'mahout', skin: 0xc68e5c, primary: o.cloth, secondary: o.secondary, metal: o.metal, cloth: o.cloth, helmet: 'band', weapon: 'none', emblem: o.emblem, emblemColor: o.emblemColor });
      mh.scale.setScalar(0.5); mh.position.set(0, bodyR * 0.75 - 0.36 * 0.5 + 0.02, bodyL * 0.5); body.add(mh);
      rig.rider = mh.userData.rig; rig.riderSeated = true;
    }
  }
  if (o.emblem) [-1, 1].forEach(sx => emblem(body, o.emblem, o.emblemColor, sx * bodyR * 1.1, bodyR * 0.05, o.howdah ? 0 : bodyL * 0.05, sx * Math.PI / 2, bodyR * 0.62));
  if (o.bridle) {
    mesh(new THREE.TorusGeometry(hr * 0.62, 0.006 * s, 6, 20), M.std(0x3a2412), 0, -hr * 0.2, hr * 0.85, head);
    mesh(new THREE.TorusGeometry(hr * 0.9, 0.005 * s, 6, 20), M.std(0x3a2412), 0, hr * 0.1, hr * 0.2, head).rotation.y = Math.PI / 2;
    if (o.armorPlate) mesh(new THREE.BoxGeometry(hr * 0.6, hr * 0.9, 0.01), M.metal(o.metal), 0, hr * 0.2, hr * 0.9, head).rotation.x = -0.5; // 馬面甲
  }
  if (o.rider) { // 傌 = 人 + 馬
    const r = biped({ ...o.rider, role: 'rider' });
    r.scale.setScalar(0.72);
    r.position.set(0, bodyR * 1.05 - 0.36 * 0.72 + 0.025, bodyL * 0.08);
    body.add(r);
    rig.rider = r.userData.rig; rig.riderSeated = true;
  }
  root.userData.rig = rig;
  return root;
}

/* ------------------------------ war machines ------------------------------ */
function wheel(r, mat, spokes = 8) {
  const g = new THREE.Group();
  mesh(new THREE.TorusGeometry(r, r * 0.09, 8, 28), mat, 0, 0, 0, g);
  mesh(new THREE.TorusGeometry(r * 1.0, r * 0.03, 6, 28), M.metal(0x3a3a3a, 0.5), 0, 0, 0, g); // iron tyre
  mesh(cyl(r * 0.18, r * 0.18, r * 0.3, 12), mat, 0, 0, 0, g).rotation.x = Math.PI / 2;
  for (let i = 0; i < spokes; i++) { const sp = mesh(cyl(r * 0.04, r * 0.04, r * 1.8, 6), mat, 0, 0, 0, g); sp.rotation.z = (i / spokes) * Math.PI; }
  g.rotation.y = Math.PI / 2;
  return g;
}
function banner(parent, o, x, y, z, h = 0.5, ch) {
  const wood = M.wood(5);
  mesh(cyl(0.006, 0.006, h, 6), wood, x, y + h / 2, z, parent);
  const fl = pivot(parent, x, y + h - 0.08, z);
  mesh(new THREE.PlaneGeometry(0.17, 0.13, 4, 3), ch ? M.std(0xffffff, { r: 0.8, extra: { map: flagTex(ch, hex(o.cloth), hex(o.secondary)), side: THREE.DoubleSide } }) : M.cloth(o.cloth), 0.085, 0, 0, fl);
  return fl;
}
function cannonModel(o) { // 炮 — 火藥銅砲
  const root = new THREE.Group();
  const wood = M.wood(3);
  const rig = { kind: 'cannon', role: 'cannon', root, wheels: [], wheelR: 0.12 };
  const carriage = pivot(root, 0, 0.12, 0); rig.body = carriage;
  mesh(new THREE.BoxGeometry(0.2, 0.06, 0.42), wood, 0, 0.02, -0.03, carriage);
  [-1, 1].forEach(s => { const w = wheel(0.12, wood); w.position.set(s * 0.15, 0, 0.04); carriage.add(w); rig.wheels.push(w); });
  const barrelPivot = pivot(carriage, 0, 0.1, 0); rig.barrel = barrelPivot;
  barrelPivot.rotation.x = -0.25;
  const prof = [[0, -0.22], [0.075, -0.22], [0.085, -0.2], [0.07, -0.18], [0.07, -0.05], [0.062, -0.04], [0.055, 0.2], [0.065, 0.21], [0.065, 0.24], [0.04, 0.24], [0.04, 0.0]].map(([x, y]) => new THREE.Vector2(x, y));
  const bronze = M.metal(0xb08d57, 0.32);
  mesh(new THREE.LatheGeometry(prof, 32), bronze, 0, 0, 0.05, barrelPivot).rotation.x = Math.PI / 2;
  mesh(new THREE.TorusGeometry(0.066, 0.01, 8, 24), M.metal(o.secondary), 0, 0, 0.0, barrelPivot);
  mesh(new THREE.TorusGeometry(0.06, 0.008, 8, 24), M.metal(o.secondary), 0, 0, 0.15, barrelPivot);
  mesh(sph(0.03, 10, 8), M.metal(o.secondary), 0, 0, -0.2, barrelPivot);
  rig.fuse = pivot(barrelPivot, 0, 0.07, -0.14);
  rig.muzzle = pivot(barrelPivot, 0, 0, 0.3);
  // powder keg & cannonballs
  mesh(cyl(0.045, 0.045, 0.08, 14), M.std(0x5b3a20, { r: 0.7 }), -0.2, 0.04, -0.18, root);
  [[0.19, 0.03, 0.15], [0.23, 0.03, 0.18], [0.21, 0.07, 0.17]].forEach(([x, y, z]) => mesh(sph(0.03, 12, 8), M.metal(0x222222, 0.5), x, y, z, root));
  rig.flag = banner(carriage, o, -0.1, 0, -0.2, 0.5, o.ch);
  mesh(new THREE.BoxGeometry(0.16, 0.13, 0.02), wood, 0, 0.06, 0.19, carriage); mesh(new THREE.BoxGeometry(0.16, 0.13, 0.02), wood, 0, 0.06, -0.25, carriage);
  emblem(carriage, o.ch, o.emblemColor, 0, 0.06, 0.201, 0, 0.055); emblem(carriage, o.ch, o.emblemColor, 0, 0.06, -0.261, Math.PI, 0.055);
  const g = biped({ ...o, role: 'gunner', helmet: 'cap', weapon: 'none', emblem: o.ch });
  g.scale.setScalar(0.62); g.position.set(0.18, 0, -0.2); g.rotation.y = -0.4; root.add(g);
  rig.crew = g.userData.rig;
  root.userData.rig = rig;
  return root;
}
function catapultModel(o) { // 砲 — 石字旁：投石機
  const root = new THREE.Group();
  const wood = M.wood(6);
  const rig = { kind: 'catapult', role: 'catapult', root, wheels: [], wheelR: 0.09 };
  const frame = pivot(root, 0, 0.1, 0); rig.body = frame;
  [-1, 1].forEach(s => {
    mesh(new THREE.BoxGeometry(0.03, 0.03, 0.46), wood, s * 0.11, 0.0, 0, frame);
    const up = mesh(new THREE.BoxGeometry(0.03, 0.3, 0.03), wood, s * 0.11, 0.15, -0.02, frame);
    const br = mesh(new THREE.BoxGeometry(0.025, 0.32, 0.025), wood, s * 0.11, 0.12, 0.08, frame); br.rotation.x = -0.6;
    const w = wheel(0.09, wood, 6); w.position.set(s * 0.14, -0.01, s > 0 ? 0.16 : 0.16); frame.add(w); rig.wheels.push(w);
    const w2 = wheel(0.09, wood, 6); w2.position.set(s * 0.14, -0.01, -0.16); frame.add(w2); rig.wheels.push(w2);
  });
  mesh(cyl(0.015, 0.015, 0.26, 8), M.metal(0x444444), 0, 0.29, -0.02, frame).rotation.z = Math.PI / 2; // axle
  const arm = pivot(frame, 0, 0.29, -0.02); rig.arm = arm;
  mesh(new THREE.BoxGeometry(0.03, 0.03, 0.52), wood, 0, 0, 0.06, arm);
  const bucket = mesh(sph(0.055, 14, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M.std(0x3a2412, { r: 0.6, extra: { side: THREE.DoubleSide } }), 0, 0.02, -0.2, arm);
  rig.stone = mesh(sph(0.045, 12, 10), M.std(0x8a8580, { r: 0.95, extra: { bumpMap: skinBump(), bumpScale: 2 } }), 0, 0.045, -0.2, arm);
  mesh(new THREE.BoxGeometry(0.1, 0.1, 0.08), M.metal(0x4a4a4a, 0.6), 0, -0.04, 0.32, arm); // counterweight
  arm.rotation.x = 0.55; // cocked: bucket down at the back
  // pile of stones
  [[-0.18, 0.025, -0.2], [-0.21, 0.025, -0.16], [-0.19, 0.06, -0.18]].forEach(([x, y, z]) => mesh(sph(0.03, 10, 8), M.std(0x8a8580, { r: 0.95 }), x, y, z, root));
  rig.flag = banner(frame, o, 0.12, 0, -0.22, 0.5, o.ch);
  [0.24, -0.24].forEach(z => mesh(new THREE.BoxGeometry(0.2, 0.12, 0.02), wood, 0, 0.07, z, frame));
  emblem(frame, o.ch, o.emblemColor, 0, 0.07, 0.251, 0, 0.05); emblem(frame, o.ch, o.emblemColor, 0, 0.07, -0.251, Math.PI, 0.05);
  const g = biped({ ...o, role: 'loader', helmet: 'band', weapon: 'none', emblem: o.ch });
  g.scale.setScalar(0.6); g.position.set(-0.2, 0, -0.06); g.rotation.y = 0.6; root.add(g);
  rig.crew = g.userData.rig;
  root.userData.rig = rig;
  return root;
}
function chariotModel(o, { horseDrawn = false } = {}) {
  const root = new THREE.Group();
  const wood = M.wood(4);
  const rig = { kind: 'chariot', role: horseDrawn ? 'horseChariot' : 'chariot', root, wheels: [], wheelR: horseDrawn ? 0.16 * 0.8 : 0.16 };
  const holder = pivot(root, 0, 0, horseDrawn ? -0.16 : 0);
  const body = pivot(holder, 0, 0.17, 0); rig.body = body;
  mesh(new THREE.BoxGeometry(0.3, 0.03, 0.26), wood, 0, 0, 0, body);
  const box = M.phys(o.primary, { r: 0.4, cc: 0.7 });
  mesh(new THREE.BoxGeometry(0.3, 0.12, 0.02), box, 0, 0.07, 0.13, body);
  [-1, 1].forEach(s => mesh(new THREE.BoxGeometry(0.02, 0.1, 0.26), box, s * 0.15, 0.06, 0, body));
  mesh(new THREE.TorusGeometry(0.03, 0.008, 6, 16), M.metal(o.metal), 0, 0.08, 0.142, body);
  [-1, 1].forEach(s => { const w = wheel(0.16, wood, 10); w.position.set(s * 0.19, 0, 0); body.add(w); rig.wheels.push(w); });
  mesh(cyl(0.012, 0.012, 0.42, 6), wood, 0, -0.01, 0.0, body).rotation.z = Math.PI / 2;
  [-1, 1].forEach(s => mesh(cone(0.012, 0.08, 6), M.metal(o.metal), s * 0.25, 0, 0, body).rotation.z = -s * Math.PI / 2); // axle blades
  const shaft = mesh(cyl(0.01, 0.012, 0.45, 6), wood, 0, 0.0, 0.33, body); shaft.rotation.x = Math.PI / 2 - 0.08;
  rig.flag = banner(body, o, -0.12, 0.0, -0.11, 0.6, o.ch);
  emblem(body, o.ch, o.emblemColor, 0.05, 0.07, 0.142, 0, 0.05); mesh(new THREE.BoxGeometry(0.3, 0.12, 0.02), box, 0, 0.07, -0.13, body);
  emblem(body, o.ch, o.emblemColor, 0, 0.07, -0.142, Math.PI, 0.05);
  if (horseDrawn) {
    const h = quad(horseOpts(o, { color: 0x3b2414, mane: 0x120a05, legColor: 0x1a0f08, role: 'drafthorse', emblem: o.ch }));
    h.scale.setScalar(0.72); h.position.set(0, 0, 0.47); root.add(h);
    rig.horse = h.userData.rig;
    const d = biped({ ...o, role: 'driver', helmet: 'cap', weapon: 'none', armor: true, emblem: o.ch });
    d.scale.setScalar(0.62); d.position.set(0, 0.01, 0.02); body.add(d);
    rig.crew = d.userData.rig;
  } else {
    const d = biped({ ...o, role: 'charioteer', armor: true, helmet: 'plume', weapon: 'halberd', cape: true, emblem: o.ch });
    d.scale.setScalar(0.74); d.position.set(0.02, 0.01, -0.02); body.add(d);
    rig.crew = d.userData.rig;
  }
  root.userData.rig = rig;
  return root;
}
function horseOpts(base, over = {}) {
  return {
    ...base, role: 'horse', matFn: M.coat, color: 0x6b3d1f, legLen: 0.27, legR: 0.03, bodyR: 0.09, bodyL: 0.28, neckLen: 0.17, neckAngle: 0.45, neckThick: 0.52,
    headR: 0.055, skullW: 0.8, muzzle: 0.1, muzzleR: 0.6, muzzleTilt: 0.95, eyeSpread: 0.6, ears: 'pointed', mane: 0x1a100a, tail: 'horse', tailLen: 0.3,
    hoof: true, saddle: true, bridle: true, legColor: 0x2a170b, tailUp: -0.7, ...over,
  };
}

/* ------------------------------ model factory ------------------------------ */
function buildFigure(model, pal, side, ch) {
  const emblemColor = pal.text;
  const base = { primary: pal.primary, secondary: pal.secondary, metal: pal.metal, cloth: pal.cloth, emblem: ch, emblemColor, ch };
  const rider = { ...base, armor: true, helmet: 'plume', weapon: 'spear', cape: true };
  switch (model) {
    case 'marshal': return biped({ ...base, role: 'marshal', armor: true, cape: true, helmet: 'plume', weapon: 'sword', beard: 'long' });
    case 'marshalHalberd': return biped({ ...base, role: 'marshal', armor: true, cape: true, helmet: 'plume', weapon: 'halberd', beard: 'long' });
    case 'marshalFlag': return biped({ ...base, role: 'marshalFlag', armor: true, cape: true, helmet: 'plume', weapon: 'flag', flagChar: ch, beard: 'long' });
    case 'official': return biped({ ...base, role: 'official', robe: true, robeColor: pal.robe, helmet: 'futou', weapon: 'scroll', beard: 'short' });
    case 'strategist': return biped({ ...base, role: 'strategist', robe: true, robeColor: 0xe9e2d0, secondary: pal.primary, helmet: 'scarf', weapon: 'featherFan', beard: 'long', beardColor: 0x2a2a2a });
    case 'guard': return biped({ ...base, role: 'guard', armor: true, helmet: 'cap', weapon: 'halberd' });
    case 'chancellor': return biped({ ...base, role: 'chancellor', robe: true, robeColor: 0x5b2a6e, secondary: pal.secondary, helmet: 'wingHat', weapon: 'tablet', beard: 'long', beardColor: 0x8a8a8a, skin: 0xdcae86 });
    case 'warElephant': return quad({ ...base, role: 'elephant', matFn: M.hide, color: 0x7d7a78, size: 1.15, legLen: 0.2, legR: 0.055, bodyR: 0.15, bodyL: 0.22, neckLen: 0.03, neckAngle: 0.2, neckThick: 0.85, headR: 0.1, muzzle: 0.0, ears: 'big', trunk: true, tail: 'thin', tailLen: 0.18, saddle: true, howdah: true, eyeSpread: 0.6 });
    case 'elephant': return quad({ ...base, role: 'elephant', matFn: M.hide, color: 0x85817e, size: 1.15, legLen: 0.2, legR: 0.055, bodyR: 0.15, bodyL: 0.22, neckLen: 0.03, neckAngle: 0.2, neckThick: 0.85, headR: 0.1, muzzle: 0.0, ears: 'big', trunk: true, tail: 'thin', tailLen: 0.18, eyeSpread: 0.6 });
    case 'cavalry': return quad(horseOpts(base, { blaze: true, armorPlate: true, rider }));
    case 'cavalryWhite': return quad(horseOpts(base, { color: 0xeeeae2, mane: 0xd8d2c6, legColor: 0xd9d3c8, armorPlate: true, rider }));
    case 'cavalryRed': return quad(horseOpts(base, { color: 0x9a2a12, mane: 0x3a0e06, legColor: 0x5a160a, armorPlate: true, rider }));
    case 'cavalryBlack': return quad(horseOpts(base, { color: 0x1d1a18, mane: 0x0a0807, legColor: 0x141210, blaze: true, armorPlate: true, rider }));
    case 'chariot': return chariotModel(base);
    case 'horseChariot': return chariotModel(base, { horseDrawn: true });
    case 'cannon': return cannonModel(base);
    case 'catapult': return catapultModel(base);
    case 'spearman': return biped({ ...base, role: 'spearman', armor: true, helmet: 'cap', weapon: 'spear', shield: 'round' });
    case 'swordsman': return biped({ ...base, role: 'swordsman', helmet: 'cap', weapon: 'dao', shield: 'tower', pauldrons: true });
    case 'archer': return biped({ ...base, role: 'archer', helmet: 'band', weapon: 'bow' });
    default: return null;
  }
}

/** Build a full piece: a free-standing figure (no base) with its character on its body. */
export function buildPiece(side, type, typeKey, model, pal, opts = {}) {
  const root = new THREE.Group();
  const allowed = MODEL_OPTIONS[typeKey][side];
  if (!allowed.includes(model)) model = allowed[0];
  const holder = new THREE.Group();
  root.add(holder);
  const ch = NAMES[side][type];
  const fig = buildFigure(model, pal, side, ch);
  const shrink = model === 'horseChariot' ? 0.8 : model.startsWith('cavalry') ? 0.95 : 1;
  const scale = 1.5 * shrink * (opts.figureScale ?? 1);
  fig.scale.multiplyScalar(scale);
  holder.add(fig);
  // soft contact shadow so figures feel planted on the wood
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.36, 32), new THREE.MeshBasicMaterial({ map: contactTex(), transparent: true, depthWrite: false, opacity: 0.55 }));
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.004; blob.renderOrder = 1;
  root.add(blob);
  const badge = makeBadge(ch, pal.text);
  badge.position.y = 1.3 * (opts.figureScale ?? 1) + 0.15;
  badge.visible = !!opts.badges;
  root.add(badge);
  root.userData = { side, type, typeKey, model, holder, fig, rig: fig.userData.rig, badge, scale, baseFacing: side > 0 ? Math.PI : 0 };
  holder.rotation.y = root.userData.baseFacing;
  root.traverse(o => { if (o.isMesh && o !== blob) { o.castShadow = true; o.receiveShadow = true; } });
  return root;
}
function contactTex() {
  return canvasTex('contact', 128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(0,0,0,0.7)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  });
}
