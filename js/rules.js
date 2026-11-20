// 中國象棋規則引擎 — 完整實作官方走子規則
// 棋盤：Int8Array(90)，索引 = 列 × 9 + 行。第 0 列在上方（黑方），第 9 列在下方（紅方）。
// 棋子代碼：正數為紅、負數為黑。1帥將 2仕士 3相象 4傌馬 5俥車 6炮砲 7兵卒

export const K = 1, A = 2, B = 3, N = 4, R = 5, C = 6, P = 7;
export const RED = 1, BLACK = -1;
export const COLS = 9, ROWS = 10;

export const NAMES = {
  [RED]:   { [K]: '帥', [A]: '仕', [B]: '相', [N]: '傌', [R]: '俥', [C]: '炮', [P]: '兵' },
  [BLACK]: { [K]: '將', [A]: '士', [B]: '象', [N]: '馬', [R]: '車', [C]: '砲', [P]: '卒' },
};
export const TYPE_KEYS = { [K]: 'K', [A]: 'A', [B]: 'B', [N]: 'N', [R]: 'R', [C]: 'C', [P]: 'P' };

export const idx = (r, c) => r * 9 + c;
export const rowOf = i => (i / 9) | 0;
export const colOf = i => i % 9;
export const sideOf = p => (p > 0 ? RED : p < 0 ? BLACK : 0);
export const typeOf = p => (p < 0 ? -p : p);
export const mFrom = m => m >> 8;
export const mTo = m => m & 255;
export const mk = (f, t) => (f << 8) | t;

export function initialBoard() {
  const b = new Int8Array(90);
  const back = [R, N, B, A, K, A, B, N, R];
  for (let c = 0; c < 9; c++) { b[idx(0, c)] = -back[c]; b[idx(9, c)] = back[c]; }
  b[idx(2, 1)] = -C; b[idx(2, 7)] = -C; b[idx(7, 1)] = C; b[idx(7, 7)] = C;
  for (let c = 0; c < 9; c += 2) { b[idx(3, c)] = -P; b[idx(6, c)] = P; }
  return b;
}

const inBoard = (r, c) => r >= 0 && r < 10 && c >= 0 && c < 9;
const inPalace = (r, c, s) => c >= 3 && c <= 5 && (s === RED ? r >= 7 && r <= 9 : r >= 0 && r <= 2);
const ownHalf = (r, s) => (s === RED ? r >= 5 : r <= 4);

const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const KNIGHT = [[-2, -1, -1, 0], [-2, 1, -1, 0], [2, -1, 1, 0], [2, 1, 1, 0],
                [-1, -2, 0, -1], [1, -2, 0, -1], [-1, 2, 0, 1], [1, 2, 0, 1]]; // 列差、行差、馬腿列差、馬腿行差

/** 只依各子走法產生的候選著法（尚未檢查送將）。capturesOnly 供靜態搜尋只取吃子。 */
export function pseudoMoves(b, side, capturesOnly = false) {
  const out = [];
  for (let i = 0; i < 90; i++) {
    const p = b[i];
    if (!p || sideOf(p) !== side) continue;
    const r = rowOf(i), c = colOf(i), t = typeOf(p);
    const push = (rr, cc) => {
      const j = idx(rr, cc), q = b[j];
      if (q && sideOf(q) === side) return;
      if (capturesOnly && !q) return;
      out.push(mk(i, j));
    };
    switch (t) {
      case K:
        for (const [dr, dc] of ORTH) { const rr = r + dr, cc = c + dc; if (inPalace(rr, cc, side)) push(rr, cc); }
        break;
      case A:
        for (const [dr, dc] of DIAG) { const rr = r + dr, cc = c + dc; if (inPalace(rr, cc, side)) push(rr, cc); }
        break;
      case B:
        for (const [dr, dc] of DIAG) {
          const rr = r + 2 * dr, cc = c + 2 * dc;
          if (!inBoard(rr, cc) || !ownHalf(rr, side)) continue;   // 象不過河
          if (b[idx(r + dr, c + dc)]) continue;                    // 塞象眼
          push(rr, cc);
        }
        break;
      case N:
        for (const [dr, dc, lr, lc] of KNIGHT) {
          const rr = r + dr, cc = c + dc;
          if (!inBoard(rr, cc)) continue;
          if (b[idx(r + lr, c + lc)]) continue;                    // 蹩馬腿
          push(rr, cc);
        }
        break;
      case R:
        for (const [dr, dc] of ORTH) {
          let rr = r + dr, cc = c + dc;
          while (inBoard(rr, cc)) {
            const q = b[idx(rr, cc)];
            if (!q) { if (!capturesOnly) out.push(mk(i, idx(rr, cc))); }
            else { if (sideOf(q) !== side) out.push(mk(i, idx(rr, cc))); break; }
            rr += dr; cc += dc;
          }
        }
        break;
      case C:
        for (const [dr, dc] of ORTH) {
          let rr = r + dr, cc = c + dc, screen = false;
          while (inBoard(rr, cc)) {
            const q = b[idx(rr, cc)];
            if (!screen) {
              if (!q) { if (!capturesOnly) out.push(mk(i, idx(rr, cc))); }
              else screen = true;                                   // 炮架
            } else if (q) {
              if (sideOf(q) !== side) out.push(mk(i, idx(rr, cc)));  // 隔山打牛
              break;
            }
            rr += dr; cc += dc;
          }
        }
        break;
      case P: {
        const f = side === RED ? -1 : 1;
        if (inBoard(r + f, c)) push(r + f, c);
        if (!ownHalf(r, side)) {                                    // 過河兵可橫走
          if (c > 0) push(r, c - 1);
          if (c < 8) push(r, c + 1);
        }
        break;
      }
    }
  }
  return out;
}

export function findKing(b, side) {
  const k = K * side;
  if (side === RED) { for (let r = 7; r <= 9; r++) for (let c = 3; c <= 5; c++) if (b[idx(r, c)] === k) return idx(r, c); }
  else { for (let r = 0; r <= 2; r++) for (let c = 3; c <= 5; c++) if (b[idx(r, c)] === k) return idx(r, c); }
  return -1;
}

/** `side` 方的將帥是否被將軍（含將帥照面）？ */
export function inCheck(b, side) {
  const k = findKing(b, side);
  if (k < 0) return true;
  const kr = rowOf(k), kc = colOf(k), en = -side;
  // 直線方向：車、炮、將帥照面
  for (const [dr, dc] of ORTH) {
    let rr = kr + dr, cc = kc + dc, screens = 0;
    while (inBoard(rr, cc)) {
      const q = b[idx(rr, cc)];
      if (q) {
        if (screens === 0) {
          if (q === R * en) return true;
          if (q === K * en && dc === 0) return true;   // 將帥照面
        } else if (screens === 1) {
          if (q === C * en) return true;
          break;
        }
        screens++;
      }
      rr += dr; cc += dc;
    }
  }
  // 馬
  for (const [dr, dc] of KNIGHT) {
    const nr = kr + dr, nc = kc + dc;
    if (!inBoard(nr, nc) || b[idx(nr, nc)] !== N * en) continue;
    // 馬腿緊鄰馬本身，位於朝向將帥的長邊方向
    const lr = Math.abs(dr) === 2 ? nr - Math.sign(dr) : nr;
    const lc = Math.abs(dc) === 2 ? nc - Math.sign(dc) : nc;
    if (!b[idx(lr, lc)]) return true;
  }
  // 兵卒
  const pf = side === RED ? -1 : 1; // 敵方兵卒從將帥面對的方向進攻
  if (inBoard(kr + pf, kc) && b[idx(kr + pf, kc)] === P * en) return true;
  if (kc > 0 && b[idx(kr, kc - 1)] === P * en) return true;
  if (kc < 8 && b[idx(kr, kc + 1)] === P * en) return true;
  return false;
}

export function makeMove(b, m) {
  const f = mFrom(m), t = mTo(m), cap = b[t];
  b[t] = b[f]; b[f] = 0;
  return cap;
}
export function unmakeMove(b, m, cap) {
  const f = mFrom(m), t = mTo(m);
  b[f] = b[t]; b[t] = cap;
}

export function legalMoves(b, side, capturesOnly = false) {
  const res = [];
  for (const m of pseudoMoves(b, side, capturesOnly)) {
    const cap = makeMove(b, m);
    if (!inCheck(b, side)) res.push(m);
    unmakeMove(b, m, cap);
  }
  return res;
}

export function boardKey(b, side) {
  let s = side === RED ? 'r' : 'b';
  for (let i = 0; i < 90; i++) s += String.fromCharCode(72 + b[i]);
  return s;
}

/* ---------------------- 中文記譜 ---------------------- */
const RED_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const BLK_NUM = ['', '１', '２', '３', '４', '５', '６', '７', '８', '９'];

export function notation(b, m) {
  const f = mFrom(m), t = mTo(m), p = b[f], side = sideOf(p), tp = typeOf(p);
  const num = side === RED ? RED_NUM : BLK_NUM;
  const fileOf = c => (side === RED ? 9 - c : c + 1);
  const fr = rowOf(f), fc = colOf(f), tr = rowOf(t), tc = colOf(t);
  const name = NAMES[side][tp];
  // 同一直行有相同棋子時，改用前／中／後
  const same = [];
  for (let r = 0; r < 10; r++) if (b[idx(r, fc)] === p) same.push(r);
  let head;
  if (same.length >= 2 && tp !== K && tp !== A && tp !== B) {
    const ordered = side === RED ? same : same.slice().reverse(); // 前方的排在前面
    const pos = ordered.indexOf(fr);
    const tags = same.length === 2 ? ['前', '後'] : same.length === 3 ? ['前', '中', '後'] : ['一', '二', '三', '四', '五'];
    head = tags[pos] + name;
  } else head = name + num[fileOf(fc)];
  const fwd = side === RED ? fr - tr : tr - fr;
  let act, tail;
  if (fr === tr) { act = '平'; tail = num[fileOf(tc)]; }
  else {
    act = fwd > 0 ? '進' : '退';
    tail = (tp === N || tp === B || tp === A) ? num[fileOf(tc)] : num[Math.abs(fwd)];
  }
  return head + act + tail;
}

/* ------------------------------ 對局狀態 ------------------------------ */
export class Game {
  constructor() { this.reset(); }
  reset() {
    this.board = initialBoard();
    this.turn = RED;
    this.history = [];   // {著法, 吃掉的子, 記譜, 是否將軍, 局面鍵, 未吃子步數}
    this.keys = [boardKey(this.board, this.turn)];
    this.result = null;  // {勝方：紅、黑或 0（和）, 原因}
  }
  clone() {
    const g = new Game();
    g.board = new Int8Array(this.board); g.turn = this.turn;
    g.history = this.history.slice(); g.keys = this.keys.slice(); g.result = this.result;
    return g;
  }
  legal() { return this.result ? [] : legalMoves(this.board, this.turn); }
  movesFrom(i) { return this.legal().filter(m => mFrom(m) === i); }
  isLegal(m) { return this.legal().includes(m); }

  play(m) {
    if (!this.isLegal(m)) return null;
    const nota = notation(this.board, m);
    const mover = this.turn;
    const cap = makeMove(this.board, m);
    this.turn = -this.turn;
    const check = inCheck(this.board, this.turn);
    const lastQuiet = this.history.length ? this.history[this.history.length - 1].quiet : 0;
    const rec = { m, cap, notation: nota, check, side: mover, quiet: cap ? 0 : lastQuiet + 1 };
    this.history.push(rec);
    this.keys.push(boardKey(this.board, this.turn));
    this.evaluateEnd();
    return rec;
  }

  undo() {
    const rec = this.history.pop();
    if (!rec) return null;
    unmakeMove(this.board, rec.m, rec.cap);
    this.turn = -this.turn;
    this.keys.pop();
    this.result = null;
    return rec;
  }

  evaluateEnd() {
    const moves = legalMoves(this.board, this.turn);
    if (moves.length === 0) {
      // 象棋：無子可動即負（將死或困斃皆判負）
      const mated = inCheck(this.board, this.turn);
      this.result = { winner: -this.turn, reason: mated ? '將死' : '困斃' };
      return;
    }
    // 長將判負；其餘三次重複局面判和
    const key = this.keys[this.keys.length - 1];
    const occ = [];
    for (let i = this.keys.length - 1; i >= 0; i--) if (this.keys[i] === key) occ.push(i);
    if (occ.length >= 3) {
      const start = occ[occ.length - 1];        // 第一次出現的位置
      const plies = this.history.slice(start);  // 循環內的著法
      const checksBy = s => plies.filter(h => h.side === s).every(h => h.check);
      const rc = checksBy(RED), bc = checksBy(BLACK);
      if (rc && !bc) this.result = { winner: BLACK, reason: '紅方長將判負' };
      else if (bc && !rc) this.result = { winner: RED, reason: '黑方長將判負' };
      else this.result = { winner: 0, reason: '重複局面和棋' };
      return;
    }
    // 六十回合自然限著（120 步未吃子）
    if (this.history[this.history.length - 1].quiet >= 120) {
      this.result = { winner: 0, reason: '六十回合無吃子，和棋' };
      return;
    }
    // 雙方都沒有可進攻的子力
    let attackers = 0;
    for (let i = 0; i < 90; i++) { const t = typeOf(this.board[i]); if (t === R || t === N || t === C || t === P) attackers++; }
    if (!attackers) this.result = { winner: 0, reason: '雙方無進攻子力，和棋' };
  }
}
