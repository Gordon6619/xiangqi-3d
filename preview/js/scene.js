// 3D 場景 — 算繪器、PBR 打光、木製棋盤、桌面、標記，以及因應各種螢幕比例的鏡頭取景
import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';
import { Clock } from './timeline.js';

export const cellPos = (r, c, y = 0) => new THREE.Vector3(c - 4, y, r - 4.5);

const BOARD_STYLES = {
  rosewood: { name: '紫檀木', base: '#7a3e1e', dark: '#4d2410', line: '#2a1206', frame: 0x4a200e },
  maple: { name: '楓木', base: '#e2b97a', dark: '#b07c3e', line: '#3b220e', frame: 0x8a5a2b },
  bamboo: { name: '竹製', base: '#d9c27a', dark: '#a8904a', line: '#3a2f10', frame: 0x6f5a24 },
  marble: { name: '大理石', base: '#e9e6e0', dark: '#b8b2a8', line: '#2a2a2a', frame: 0x2d2d30 },
};
export { BOARD_STYLES };

export class Stage {
  constructor(container) {
    this.container = container;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.92;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x15110e);
    this.scene.fog = new THREE.Fog(0x15110e, 18, 40);
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(r), 0.04).texture;
    this.scene.environmentIntensity = 0.35;

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.minPolarAngle = 0.05; this.controls.maxPolarAngle = 1.35;
    this.controls.minDistance = 5; this.controls.maxDistance = 26;
    this.controls.enablePan = false;
    this.controls.target.set(0, 0, 0);

    this._lights();
    this._table();
    this.boardGroup = new THREE.Group(); this.scene.add(this.boardGroup);
    this.setBoardStyle('rosewood');
    this._markers();
    this.shake = 0;
    this.viewSide = 1;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => this.resize());
  }

  _lights() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0xfff1dc, 0x2a1a10, 0.5));
    const key = this.key = new THREE.DirectionalLight(0xffe2b8, 2.1);
    key.position.set(-6, 12, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera; sc.left = -7; sc.right = 7; sc.top = 7; sc.bottom = -7; sc.near = 1; sc.far = 40;
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 4;
    s.add(key);
    const rim = new THREE.DirectionalLight(0x9fbfff, 0.8); rim.position.set(7, 6, -8); s.add(rim);
    const fill = new THREE.PointLight(0xffb070, 18, 20, 2); fill.position.set(5, 4, 6); s.add(fill);
    this.flash = new THREE.PointLight(0xffaa55, 0, 6, 2); s.add(this.flash);
  }

  _table() {
    const cv = document.createElement('canvas'); cv.width = cv.height = 1024;
    const g = cv.getContext('2d');
    g.fillStyle = '#3a2316'; g.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 400; i++) {
      g.strokeStyle = `rgba(${20 + Math.random() * 30},${10 + Math.random() * 15},5,${0.15 + Math.random() * 0.2})`;
      g.lineWidth = 1 + Math.random() * 3; g.beginPath();
      const y = Math.random() * 1024; g.moveTo(0, y);
      for (let x = 0; x <= 1024; x += 64) g.lineTo(x, y + Math.sin(x * 0.01 + i) * 6);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(3, 3); tex.anisotropy = 8;
    const table = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.3 }));
    table.rotation.x = -Math.PI / 2; table.position.y = -0.36; table.receiveShadow = true;
    this.scene.add(table);
  }

  boardTexture(style) {
    const S = 2048, cv = document.createElement('canvas'); cv.width = S; cv.height = Math.round(S * 11 / 10);
    const g = cv.getContext('2d'), W = cv.width, H = cv.height;
    // 木紋／石紋底
    g.fillStyle = style.base; g.fillRect(0, 0, W, H);
    if (style === BOARD_STYLES.marble) {
      for (let i = 0; i < 60; i++) {
        g.strokeStyle = `rgba(90,90,90,${Math.random() * 0.15})`; g.lineWidth = 1 + Math.random() * 4; g.beginPath();
        let x = Math.random() * W, y = 0; g.moveTo(x, y);
        while (y < H) { x += (Math.random() - 0.5) * 80; y += 40; g.lineTo(x, y); }
        g.stroke();
      }
    } else {
      for (let i = 0; i < 260; i++) {
        g.strokeStyle = style.dark + Math.floor(20 + Math.random() * 50).toString(16);
        g.lineWidth = 1 + Math.random() * 5; g.beginPath();
        const x0 = Math.random() * W; g.moveTo(x0, 0);
        for (let y = 0; y <= H; y += 50) g.lineTo(x0 + Math.sin(y * 0.004 + i) * 25 + Math.sin(y * 0.02) * 4, y);
        g.stroke();
      }
      if (style === BOARD_STYLES.bamboo) for (let x = 0; x < W; x += W / 12) { g.fillStyle = 'rgba(80,60,20,0.18)'; g.fillRect(x, 0, 6, H); }
    }
    // 格線：9 行 × 10 列，四周留一格邊距
    const cell = W / 10, ox = cell, oy = cell; // 棋盤平面為 10 × 11 單位
    const X = c => ox + c * cell, Y = r => oy + r * cell;
    g.strokeStyle = style.line; g.lineCap = 'round';
    g.lineWidth = 10; g.strokeRect(X(0) - 22, Y(0) - 22, 8 * cell + 44, 9 * cell + 44);
    g.lineWidth = 5;
    for (let r = 0; r < 10; r++) { g.beginPath(); g.moveTo(X(0), Y(r)); g.lineTo(X(8), Y(r)); g.stroke(); }
    for (let c = 0; c < 9; c++) {
      g.beginPath(); g.moveTo(X(c), Y(0)); g.lineTo(X(c), Y(c === 0 || c === 8 ? 9 : 4)); g.stroke();
      if (c > 0 && c < 8) { g.beginPath(); g.moveTo(X(c), Y(5)); g.lineTo(X(c), Y(9)); g.stroke(); }
    }
    // 九宮
    [[0, 2], [7, 9]].forEach(([a, b]) => {
      g.beginPath(); g.moveTo(X(3), Y(a)); g.lineTo(X(5), Y(b)); g.moveTo(X(5), Y(a)); g.lineTo(X(3), Y(b)); g.stroke();
    });
    // 砲位與兵位的十字標記
    const mark = (r, c) => {
      const d = 14, l = 30;
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => {
        if ((c === 0 && sx < 0) || (c === 8 && sx > 0)) return;
        g.beginPath(); g.moveTo(X(c) + sx * d, Y(r) + sy * (d + l)); g.lineTo(X(c) + sx * d, Y(r) + sy * d); g.lineTo(X(c) + sx * (d + l), Y(r) + sy * d); g.stroke();
      });
    };
    [[2, 1], [2, 7], [7, 1], [7, 7]].forEach(([r, c]) => mark(r, c));
    for (let c = 0; c < 9; c += 2) { mark(3, c); mark(6, c); }
    // 河界文字：楚河 漢界
    g.fillStyle = style.line; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold ${cell * 0.62}px "BiauKai","DFKai-SB","KaiTi","STKaiti","Noto Serif TC","Noto Serif CJK TC","WenQuanYi Zen Hei",serif`;
    const ry = (Y(4) + Y(5)) / 2;
    g.save(); g.translate(X(2), ry); g.rotate(Math.PI); g.fillText('楚 河', 0, 0); g.restore();
    g.fillText('漢 界', X(6), ry);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 16;
    return tex;
  }

  setBoardStyle(key) {
    const style = BOARD_STYLES[key] || BOARD_STYLES.rosewood;
    this.boardStyleKey = key;
    while (this.boardGroup.children.length) {
      const o = this.boardGroup.children.pop();
      o.traverse(m => { if (m.isMesh) { m.geometry.dispose(); [].concat(m.material).forEach(mt => { mt.map?.dispose(); mt.dispose(); }); } });
    }
    const isMarble = key === 'marble';
    const top = new THREE.Mesh(new THREE.BoxGeometry(10, 0.3, 11),
      [new THREE.MeshPhysicalMaterial({ color: style.frame, roughness: 0.4, clearcoat: 0.8 }), new THREE.MeshPhysicalMaterial({ color: style.frame, roughness: 0.4, clearcoat: 0.8 }),
       new THREE.MeshPhysicalMaterial({ map: this.boardTexture(style), roughness: isMarble ? 0.15 : 0.42, clearcoat: isMarble ? 1 : 0.6, clearcoatRoughness: 0.18 }),
       new THREE.MeshStandardMaterial({ color: style.frame }),
       new THREE.MeshPhysicalMaterial({ color: style.frame, roughness: 0.4, clearcoat: 0.8 }), new THREE.MeshPhysicalMaterial({ color: style.frame, roughness: 0.4, clearcoat: 0.8 })]);
    top.position.y = -0.15; top.receiveShadow = true; top.castShadow = true;
    this.boardGroup.add(top);
    // 邊框線腳
    const fm = new THREE.MeshPhysicalMaterial({ color: style.frame, roughness: 0.35, clearcoat: 1, metalness: 0.05 });
    [[0, -5.6, 10.6, 0.25], [0, 5.6, 10.6, 0.25]].forEach(([x, z, w, d]) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.38, d), fm); m.position.set(x, -0.13, z); m.castShadow = m.receiveShadow = true; this.boardGroup.add(m); });
    [[-5.15, 0], [5.15, 0]].forEach(([x, z]) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.38, 11.45), fm); m.position.set(x, -0.13, z); m.castShadow = m.receiveShadow = true; this.boardGroup.add(m); });
    // 看不見的點擊平面
    this.pickPlane = new THREE.Mesh(new THREE.PlaneGeometry(10, 11), new THREE.MeshBasicMaterial({ visible: false }));
    this.pickPlane.rotation.x = -Math.PI / 2; this.pickPlane.position.y = 0.01;
    this.boardGroup.add(this.pickPlane);
  }

  _markers() {
    this.markerGroup = new THREE.Group(); this.scene.add(this.markerGroup);
    this.dotGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.02, 24);
    this.ringGeo = new THREE.TorusGeometry(0.47, 0.035, 10, 48);
    this.dotMat = new THREE.MeshBasicMaterial({ color: 0x3df5a0, transparent: true, opacity: 0.85 });
    this.capMat = new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.9 });
    this.selMat = new THREE.MeshBasicMaterial({ color: 0xffe066 });
    this.lastMat = new THREE.MeshBasicMaterial({ color: 0x59b8ff, transparent: true, opacity: 0.7 });
    this.checkMat = new THREE.MeshBasicMaterial({ color: 0xff2020 });
    this.lastGroup = new THREE.Group(); this.scene.add(this.lastGroup);
  }
  clearMarkers() { this.markerGroup.clear(); }
  showTargets(list) { // 清單：{r, c, capture}
    this.clearMarkers();
    for (const t of list) {
      const m = t.capture ? new THREE.Mesh(this.ringGeo, this.capMat) : new THREE.Mesh(this.dotGeo, this.dotMat);
      if (t.capture) m.rotation.x = Math.PI / 2;
      m.position.copy(cellPos(t.r, t.c, t.capture ? 0.05 : 0.02));
      m.userData.pulse = Math.random() * 6;
      this.markerGroup.add(m);
    }
  }
  showSelected(r, c) {
    const m = new THREE.Mesh(this.ringGeo, this.selMat); m.rotation.x = Math.PI / 2; m.position.copy(cellPos(r, c, 0.04));
    m.userData.sel = true; this.markerGroup.add(m);
  }
  showLast(from, to) {
    this.lastGroup.clear();
    if (from == null) return;
    for (const [r, c] of [from, to]) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 4, 1), this.lastMat);
      m.rotation.x = -Math.PI / 2; m.rotation.z = Math.PI / 4; m.position.copy(cellPos(r, c, 0.015));
      this.lastGroup.add(m);
    }
  }
  showCheck(pos) {
    if (this.checkRing) { this.scene.remove(this.checkRing); this.checkRing = null; }
    if (!pos) return;
    const m = new THREE.Mesh(this.ringGeo, this.checkMat); m.rotation.x = Math.PI / 2; m.position.copy(pos); m.position.y = 0.06;
    this.checkRing = m; this.scene.add(m);
  }

  /* ---------- 改版標記：炮架光圈、落地細框、將軍印記 ---------- */
  makeBaseGlow(pos) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 48), new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.3, 48), new THREE.MeshBasicMaterial({ color: 0xffb030, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    [ring, disc].forEach(m => { m.rotation.x = -Math.PI / 2; g.add(m); });
    g.position.set(pos.x, 0.02, pos.z); g.renderOrder = 3;
    // 一個透明度同時控制光圈兩層
    const mat = { set opacity(v) { ring.material.opacity = v; disc.material.opacity = v * 0.45; }, get opacity() { return ring.material.opacity; } };
    g.material = mat;
    this.scene.add(g);
    return g;
  }
  removeBaseGlow(g) { this.scene.remove(g); g.children.forEach(m => { m.geometry.dispose(); m.material.dispose(); }); }
  setLandFrame(r, c, animate = false) {
    if (!this.landFrame) {
      const shape = new THREE.Shape(), o = 0.47, i = 0.445;
      shape.moveTo(-o, -o); shape.lineTo(o, -o); shape.lineTo(o, o); shape.lineTo(-o, o); shape.lineTo(-o, -o);
      const hole = new THREE.Path(); hole.moveTo(-i, -i); hole.lineTo(-i, i); hole.lineTo(i, i); hole.lineTo(i, -i); hole.lineTo(-i, -i);
      shape.holes.push(hole);
      this.landFrame = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: 0xfff1c8, transparent: true, opacity: 0.85, depthWrite: false }));
      this.landFrame.rotation.x = -Math.PI / 2; this.landFrame.renderOrder = 2;
      this.scene.add(this.landFrame);
    }
    if (r == null) { this.landFrame.visible = false; return; }
    this.landFrame.visible = true;
    this.landFrame.position.copy(cellPos(r, c, 0.016));
    this.landFrame.userData.anim = animate ? Clock.now() : 0;
  }
  showSeal(pos, side) {
    this.clearSeal();
    if (!pos) return;
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const g = cv.getContext('2d');
    g.fillStyle = 'rgba(190,24,24,0.92)';
    g.beginPath(); g.roundRect(28, 28, 200, 200, 26); g.fill();
    g.strokeStyle = 'rgba(255,236,220,0.9)'; g.lineWidth = 8; g.beginPath(); g.roundRect(44, 44, 168, 168, 16); g.stroke();
    g.fillStyle = '#fff3e6'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 76px "BiauKai","DFKai-SB","KaiTi","STKaiti","Noto Serif TC","Noto Serif CJK TC","WenQuanYi Zen Hei",serif';
    g.fillText('將', 128, 92); g.fillText('軍', 128, 168);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 0.94), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = side > 0 ? 0 : Math.PI; m.position.set(pos.x, 0.018, pos.z); m.renderOrder = 2;
    m.userData.born = Clock.now();
    this.seal = m; this.scene.add(m);
  }
  clearSeal() { if (this.seal) { this.scene.remove(this.seal); this.seal.material.map.dispose(); this.seal.material.dispose(); this.seal.geometry.dispose(); this.seal = null; } }

  /* 鏡頭取景：任何螢幕比例都能看到整個棋盤 */
  fitCamera(animate = false) {
    const w = this.container.clientWidth, h = this.container.clientHeight, aspect = w / h;
    this.camera.aspect = aspect;
    const portrait = aspect < 0.9;
    this.camera.fov = portrait ? 50 : 40;
    // 讓棋盤置中於桌機側欄沒有遮住的區域
    const wide = w > 820 && h > 520;
    const right = wide ? 290 : 0, left = wide ? (this.leftInset || 0) : 0;   // 蓋在畫布上的左右面板
    if (right || left) this.camera.setViewOffset(w, h, (right - left) / 2, 0, w, h); else this.camera.clearViewOffset();
    const effW = w - right - left;
    this.camera.updateProjectionMatrix();
    const polar = portrait ? 0.38 : 0.62;               // 手機上改用較俯視的角度
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (effW / h));
    const needH = 11.6 * Math.cos(polar) + 1.5, needW = 10.6;
    const dist = Math.max(needH / 2 / Math.tan(vfov / 2), needW / 2 / Math.tan(hfov / 2)) * 1.02 + (portrait ? 0.2 : 1.2);
    const z = this.viewSide > 0 ? 1 : -1;
    const target = new THREE.Vector3(0, 0, 0.35 * z);
    const pos = new THREE.Vector3(0, Math.cos(polar) * dist, Math.sin(polar) * dist * z).add(target);
    this.controls.target.copy(target);
    if (!animate) this.camera.position.copy(pos);
    this.homePos = pos;
    this.controls.maxDistance = Math.max(26, dist * 1.6);
    return pos;
  }
  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h, false);
    this.fitCamera();
  }

  pick(clientX, clientY, objects) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObjects(objects, true);
    return { hits, ray };
  }
  pickCell(clientX, clientY) {
    const { hits } = this.pick(clientX, clientY, [this.pickPlane]);
    if (!hits.length) return null;
    const p = hits[0].point, c = Math.round(p.x + 4), r = Math.round(p.z + 4.5);
    if (c < 0 || c > 8 || r < 0 || r > 9) return null;
    if (Math.hypot(p.x - (c - 4), p.z - (r - 4.5)) > 0.55) return null;
    return { r, c };
  }

  render(dt, time) {
    this.markerGroup.children.forEach(m => {
      if (m.userData.sel) m.scale.setScalar(1 + Math.sin(time * 6) * 0.05);
      else m.scale.setScalar(1 + Math.sin(time * 5 + m.userData.pulse) * 0.12);
    });
    if (this.landFrame?.userData.anim) { const k = Math.min(1, (Clock.now() - this.landFrame.userData.anim) / 140); this.landFrame.scale.setScalar(1.18 - 0.18 * (1 - Math.pow(1 - k, 3))); this.landFrame.material.opacity = 0.85 * k; if (k >= 1) this.landFrame.userData.anim = 0; }
    if (this.seal) { // 印記浮出：升起、蓋印縮回原尺寸，之後輕微呼吸
      const k = Math.min(1, (Clock.now() - this.seal.userData.born) / 220);
      this.seal.material.opacity = 0.95 * k; this.seal.scale.setScalar(1.35 - 0.35 * (1 - Math.pow(1 - k, 3)) + (k >= 1 ? Math.sin(time * 4) * 0.03 : 0));
      this.seal.position.y = 0.018 + 0.05 * (1 - k);
    }
    if (this.checkRing) { this.checkRing.scale.setScalar(1 + Math.sin(time * 10) * 0.1); this.checkRing.material.color.setHSL(0, 1, 0.45 + Math.sin(time * 10) * 0.1); }
    this.controls.update();
    let off = null;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      const s = this.shake * this.shake * 0.25;
      off = new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
      this.camera.position.add(off);
    }
    if (this.flash.intensity > 0) this.flash.intensity = Math.max(0, this.flash.intensity - dt * 60);
    this.renderer.render(this.scene, this.camera);
    if (off) this.camera.position.sub(off);
  }
}
