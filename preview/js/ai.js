// 象棋 AI：α-β 剪枝搜尋（逐步加深、靜態搜尋、MVV-LVA 吃子排序、殺手著法與歷史啟發）
import { K, A, B, N, R, C, P, RED, BLACK, pseudoMoves, makeMove, unmakeMove, inCheck,
  mFrom, mTo, typeOf, sideOf, rowOf, colOf, legalMoves } from './rules.js';

const VAL = [0, 6000, 120, 120, 270, 600, 285, 30];

// 子力位置分數表，以紅方視角排列（第 0 列為敵方底線），10 列 × 9 行
const PST = {
  [P]: [
    0, 3, 6, 9, 12, 9, 6, 3, 0,
    18, 36, 56, 80, 120, 80, 56, 36, 18,
    14, 26, 42, 60, 80, 60, 42, 26, 14,
    10, 20, 30, 34, 40, 34, 30, 20, 10,
    6, 12, 18, 18, 20, 18, 18, 12, 6,
    2, 0, 8, 0, 8, 0, 8, 0, 2,
    0, 0, -2, 0, 4, 0, -2, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0],
  [N]: [
    4, 8, 16, 12, 4, 12, 16, 8, 4,
    4, 10, 28, 16, 8, 16, 28, 10, 4,
    12, 14, 16, 20, 18, 20, 16, 14, 12,
    8, 24, 18, 24, 20, 24, 18, 24, 8,
    6, 16, 14, 18, 16, 18, 14, 16, 6,
    4, 12, 16, 14, 12, 14, 16, 12, 4,
    2, 6, 8, 6, 10, 6, 8, 6, 2,
    4, 2, 8, 8, 4, 8, 8, 2, 4,
    0, 2, 4, 4, -2, 4, 4, 2, 0,
    0, -4, 0, 0, 0, 0, 0, -4, 0],
  [R]: [
    14, 14, 12, 18, 16, 18, 12, 14, 14,
    16, 20, 18, 24, 26, 24, 18, 20, 16,
    12, 12, 12, 18, 18, 18, 12, 12, 12,
    12, 18, 16, 22, 22, 22, 16, 18, 12,
    12, 14, 12, 18, 18, 18, 12, 14, 12,
    12, 16, 14, 20, 20, 20, 14, 16, 12,
    6, 10, 8, 14, 14, 14, 8, 10, 6,
    4, 8, 6, 14, 12, 14, 6, 8, 4,
    8, 4, 8, 16, 8, 16, 8, 4, 8,
    -2, 10, 6, 14, 12, 14, 6, 10, -2],
  [C]: [
    6, 4, 0, -10, -12, -10, 0, 4, 6,
    2, 2, 0, -4, -14, -4, 0, 2, 2,
    2, 2, 0, -10, -8, -10, 0, 2, 2,
    0, 0, -2, 4, 10, 4, -2, 0, 0,
    0, 0, 0, 2, 8, 2, 0, 0, 0,
    -2, 0, 4, 2, 6, 2, 4, 0, -2,
    0, 0, 0, 2, 4, 2, 0, 0, 0,
    4, 0, 8, 6, 10, 6, 8, 0, 4,
    0, 2, 4, 6, 6, 6, 4, 2, 0,
    0, 0, 2, 6, 6, 6, 2, 0, 0],
};

function pst(t, i, side) {
  const tbl = PST[t];
  if (!tbl) return 0;
  const r = rowOf(i), c = colOf(i);
  return side === RED ? tbl[r * 9 + c] : tbl[(9 - r) * 9 + c];
}

function evaluate(b, side) {
  let s = 0;
  for (let i = 0; i < 90; i++) {
    const p = b[i]; if (!p) continue;
    const t = typeOf(p), sd = sideOf(p);
    s += sd * (VAL[t] + pst(t, i, sd));
  }
  return s * side;
}

const MATE = 100000;

export function search(board, side, { maxDepth = 4, timeMs = 1500, randomness = 0 } = {}) {
  const b = new Int8Array(board);
  const t0 = performance.now();
  let nodes = 0, stop = false;
  const killers = [];
  const hist = new Int32Array(65536);

  const order = (moves, ply) => {
    const k = killers[ply] || [];
    return moves.map(m => {
      const cap = b[mTo(m)];
      let sc = cap ? 100000 + VAL[typeOf(cap)] * 10 - VAL[typeOf(b[mFrom(m)])] : hist[m];
      if (!cap && (m === k[0] || m === k[1])) sc += 50000;
      return [sc, m];
    }).sort((x, y) => y[0] - x[0]).map(x => x[1]);
  };

  function quiesce(alpha, beta, s, qd) {
    nodes++;
    const stand = evaluate(b, s);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    if (qd > 6) return alpha;
    for (const m of order(pseudoMoves(b, s, true), 63)) {
      const cap = makeMove(b, m);
      if (typeOf(cap) === K) { unmakeMove(b, m, cap); return MATE; }
      if (inCheck(b, s)) { unmakeMove(b, m, cap); continue; }
      const v = -quiesce(-beta, -alpha, -s, qd + 1);
      unmakeMove(b, m, cap);
      if (v >= beta) return beta;
      if (v > alpha) alpha = v;
    }
    return alpha;
  }

  function negamax(depth, alpha, beta, s, ply) {
    if ((++nodes & 1023) === 0 && performance.now() - t0 > timeMs) stop = true;
    if (stop) return 0;
    const checked = inCheck(b, s);
    if (checked) depth++; // 被將軍時延伸搜尋一層
    if (depth <= 0) return quiesce(alpha, beta, s, 0);
    let best = -MATE + ply, legal = 0;
    for (const m of order(pseudoMoves(b, s), ply)) {
      const cap = makeMove(b, m);
      if (inCheck(b, s)) { unmakeMove(b, m, cap); continue; }
      legal++;
      const v = -negamax(depth - 1, -beta, -alpha, -s, ply + 1);
      unmakeMove(b, m, cap);
      if (stop) return 0;
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) {
        if (!cap) {
          const k = killers[ply] || (killers[ply] = [0, 0]);
          if (k[0] !== m) { k[1] = k[0]; k[0] = m; }
          hist[m] += depth * depth;
        }
        break;
      }
    }
    if (!legal) return -MATE + ply; // 無子可動即負
    return best;
  }

  let rootMoves = legalMoves(b, side);
  if (!rootMoves.length) return { move: 0, score: -MATE, depth: 0, nodes };
  let bestMove = rootMoves[0], bestScore = -Infinity, reached = 0;
  for (let d = 1; d <= maxDepth; d++) {
    let alpha = -Infinity, iterBest = 0, iterScore = -Infinity;
    const scored = [];
    for (const m of rootMoves) {
      const cap = makeMove(b, m);
      const v = -negamax(d - 1, -Infinity, -alpha + randomness, -side, 1);
      unmakeMove(b, m, cap);
      if (stop) break;
      scored.push([v, m]);
      if (v > iterScore) { iterScore = v; iterBest = m; }
      if (v > alpha) alpha = v;
    }
    if (stop && !iterBest) break;
    if (iterBest) { bestMove = iterBest; bestScore = iterScore; reached = d; }
    // 依本輪分數重排根節點著法，供下一輪先搜
    scored.sort((x, y) => y[0] - x[0]);
    rootMoves = scored.map(x => x[1]).concat(rootMoves.filter(m => !scored.some(s => s[1] === m)));
    if (stop || Math.abs(bestScore) > MATE - 100) break;
    // 低難度加入隨機：在接近最佳的著法中任選
    if (randomness && d === maxDepth) {
      const near = scored.filter(x => x[0] >= iterScore - randomness);
      bestMove = near[Math.floor(Math.random() * near.length)][1];
    }
  }
  return { move: bestMove, score: bestScore, depth: reached, nodes };
}
