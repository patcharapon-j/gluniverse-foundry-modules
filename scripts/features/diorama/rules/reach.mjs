/**
 * Diorama — how far a creature can go, pure.
 *
 *   solveReach(o) → { cells, at(i, j), pathTo(i, j) }
 *       Cheapest cost (distance units) to every square inside `budget`, by
 *       Dijkstra over grid squares. Diagonals follow the scene's rule
 *       (PF2e: alternating 5 / 10). A step's distance is multiplied by
 *       `enter(i, j)` (difficult terrain: 2, greater: 3, Infinity = never) and
 *       refused when `blocked(from, to)` (walls, cliffs) says so.
 *   reachBands(budgets, cost) → 1-based band, 0 when out of reach
 *   segmentsCross(px,py,qx,qy, ax,ay,bx,by) → bool   touching counts
 *
 * Nothing here reads the world: the view hands in the closures. The check
 * tool drives it against hand-counted grids.
 */

/** CONST.GRID_DIAGONALS, restated so this file imports nothing. */
export const DIAGONALS = Object.freeze({
  EQUIDISTANT: 0, EXACT: 1, APPROXIMATE: 2, RECTILINEAR: 3, ALTERNATING_1: 4, ALTERNATING_2: 5, ILLEGAL: 6,
});

const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

/**
 * The length of one diagonal step, in squares, and the diagonal parity after it.
 * Parity is the number of diagonals taken so far, mod 2 (it only matters for
 * the alternating rules).
 */
export function diagonalStep(rule, parity) {
  switch (rule) {
    case DIAGONALS.EXACT: return { len: Math.SQRT2, parity };
    case DIAGONALS.APPROXIMATE: return { len: 1.5, parity };
    case DIAGONALS.RECTILINEAR: return { len: 2, parity };
    case DIAGONALS.ALTERNATING_1: return { len: parity ? 2 : 1, parity: parity ^ 1 };
    case DIAGONALS.ALTERNATING_2: return { len: parity ? 1 : 2, parity: parity ^ 1 };
    case DIAGONALS.ILLEGAL: return null;
    default: return { len: 1, parity };
  }
}

/** A small binary min-heap of [cost, state]. */
class Heap {
  constructor() { this.c = []; this.s = []; }
  get size() { return this.c.length; }
  push(cost, state) {
    const c = this.c, s = this.s;
    let i = c.length;
    c.push(cost); s.push(state);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (c[p] <= cost) break;
      c[i] = c[p]; s[i] = s[p]; i = p;
    }
    c[i] = cost; s[i] = state;
  }
  pop() {
    const c = this.c, s = this.s;
    const top = s[0], topC = c[0];
    const lc = c.pop(), ls = s.pop();
    if (c.length) {
      let i = 0;
      const n = c.length;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mc = lc;
        if (l < n && c[l] < mc) { m = l; mc = c[l]; }
        if (r < n && c[r] < mc) { m = r; mc = c[r]; }
        if (m === i) break;
        c[i] = c[m]; s[i] = s[m]; i = m;
      }
      c[i] = lc; s[i] = ls;
    }
    return [topC, top];
  }
}

/**
 * @param {object} o
 * @param {{i:number,j:number}} o.start         top-left square of the creature
 * @param {number} o.budget                     distance units (e.g. 3 × Speed)
 * @param {number} [o.gridDistance=5]
 * @param {number} [o.diagonals=ALTERNATING_1]
 * @param {{rows:number, cols:number}} [o.bounds]  squares outside are never entered
 * @param {(i:number, j:number) => number} [o.enter]  multiplier for stepping INTO (i, j)
 * @param {(fi:number, fj:number, ti:number, tj:number) => boolean} [o.blocked]
 * @returns {{cells: {i:number,j:number,cost:number}[], at:(i:number,j:number)=>number, pathTo:(i:number,j:number)=>{i:number,j:number}[]|null}}
 */
export function solveReach({ start, budget, gridDistance = 5, diagonals = DIAGONALS.ALTERNATING_1, bounds = null,
  enter = () => 1, blocked = () => false }) {
  const gd = Number(gridDistance) > 0 ? Number(gridDistance) : 5;
  const B = Math.max(0, Number(budget) || 0);
  const R = Math.ceil(B / gd) + 1;
  const si = Math.round(start.i), sj = Math.round(start.j);
  const W = 2 * R + 1;
  const N = W * W;
  const best = new Float64Array(N * 2).fill(Infinity);
  const prev = new Int32Array(N * 2).fill(-1);
  const enterCache = new Float64Array(N).fill(NaN);
  const idxOf = (i, j) => (i - si + R) * W + (j - sj + R);
  const inside = (i, j) => Math.abs(i - si) <= R && Math.abs(j - sj) <= R
    && (!bounds || (i >= 0 && j >= 0 && i < bounds.rows && j < bounds.cols));
  const mult = (i, j) => {
    const k = idxOf(i, j);
    let v = enterCache[k];
    if (Number.isNaN(v)) {
      v = Number(enter(i, j));
      if (!(v >= 0)) v = v === Infinity ? Infinity : 1;
      enterCache[k] = v;
    }
    return v;
  };
  const heap = new Heap();
  const s0 = idxOf(si, sj) * 2;
  best[s0] = 0;
  heap.push(0, s0);
  const eps = 1e-9;
  while (heap.size) {
    const [cost, st] = heap.pop();
    if (cost > best[st]) continue;
    const cell = st >> 1, parity = st & 1;
    const ci = Math.floor(cell / W) - R + si, cj = (cell % W) - R + sj;
    for (const [di, dj] of ORTHO) {
      const ti = ci + di, tj = cj + dj;
      if (!inside(ti, tj)) continue;
      const m = mult(ti, tj);
      if (m === Infinity) continue;
      const c = cost + gd * m;
      if (c > B + eps) continue;
      const ns = idxOf(ti, tj) * 2 + parity;
      if (c >= best[ns] - eps) continue;
      if (blocked(ci, cj, ti, tj)) continue;
      best[ns] = c; prev[ns] = st;
      heap.push(c, ns);
    }
    const step = diagonalStep(diagonals, parity);
    if (!step) continue;
    for (const [di, dj] of DIAG) {
      const ti = ci + di, tj = cj + dj;
      if (!inside(ti, tj)) continue;
      const m = mult(ti, tj);
      if (m === Infinity) continue;
      const c = cost + gd * step.len * m;
      if (c > B + eps) continue;
      const ns = idxOf(ti, tj) * 2 + step.parity;
      if (c >= best[ns] - eps) continue;
      if (blocked(ci, cj, ti, tj)) continue;
      best[ns] = c; prev[ns] = st;
      heap.push(c, ns);
    }
  }
  const cells = [];
  for (let k = 0; k < N; k++) {
    const c = Math.min(best[k * 2], best[k * 2 + 1]);
    if (c === Infinity) continue;
    cells.push({ i: Math.floor(k / W) - R + si, j: (k % W) - R + sj, cost: Math.round(c * 1e6) / 1e6 });
  }
  const bestState = (i, j) => {
    if (!inside(i, j)) return -1;
    const k = idxOf(i, j) * 2;
    if (best[k] === Infinity && best[k + 1] === Infinity) return -1;
    return best[k] <= best[k + 1] ? k : k + 1;
  };
  return {
    cells,
    at(i, j) { const s = bestState(i, j); return s < 0 ? Infinity : best[s]; },
    pathTo(i, j) {
      let s = bestState(i, j);
      if (s < 0) return null;
      const out = [];
      while (s >= 0) {
        const cell = s >> 1;
        out.push({ i: Math.floor(cell / W) - R + si, j: (cell % W) - R + sj });
        s = prev[s];
      }
      return out.reverse();
    },
  };
}

/** 1-based band a cost falls in (budgets ascending), 0 when beyond the last. */
export function reachBand(budgets, cost) {
  for (let k = 0; k < budgets.length; k++) if (cost <= budgets[k] + 1e-9) return k + 1;
  return 0;
}

/**
 * The bands a creature's movement reads in at this table: PF2e counts one,
 * two and three Strides; Daggerheart one move inside an action (Close).
 * @returns {number[]} ascending budgets in distance units ([] = no reach)
 */
export function reachBudgets({ systemId, speed = null, gridDistance = 5, daggerheart = [] }) {
  const s = Number(speed);
  if (systemId === "pf2e" && s > 0) return [s, s * 2, s * 3];
  if (daggerheart.includes(systemId)) return [6 * (Number(gridDistance) || 5)];
  return [];
}

const orient = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
const onSeg = (ax, ay, bx, by, cx, cy) => Math.min(ax, bx) - 1e-6 <= cx && cx <= Math.max(ax, bx) + 1e-6
  && Math.min(ay, by) - 1e-6 <= cy && cy <= Math.max(ay, by) + 1e-6;

/** Do segments p→q and a→b meet? Touching (an end on the other) counts. */
export function segmentsCross(px, py, qx, qy, ax, ay, bx, by) {
  const d1 = orient(ax, ay, bx, by, px, py), d2 = orient(ax, ay, bx, by, qx, qy);
  const d3 = orient(px, py, qx, qy, ax, ay), d4 = orient(px, py, qx, qy, bx, by);
  const e = 1e-9;
  if (((d1 > e && d2 < -e) || (d1 < -e && d2 > e)) && ((d3 > e && d4 < -e) || (d3 < -e && d4 > e))) return true;
  if (Math.abs(d1) <= e && onSeg(ax, ay, bx, by, px, py)) return true;
  if (Math.abs(d2) <= e && onSeg(ax, ay, bx, by, qx, qy)) return true;
  if (Math.abs(d3) <= e && onSeg(px, py, qx, qy, ax, ay)) return true;
  if (Math.abs(d4) <= e && onSeg(px, py, qx, qy, bx, by)) return true;
  return false;
}

/**
 * A wall index for fast "does this step cross a wall" tests: segments bucketed
 * by the squares their bounding box covers.
 * @param {{ax:number,ay:number,bx:number,by:number, ignoresFrom?:(x:number,y:number)=>boolean}[]} walls  px
 * @param {number} size  grid px
 */
export function wallIndex(walls, size) {
  const S = size || 100;
  const buckets = new Map();
  walls.forEach((w, n) => {
    const i0 = Math.floor(Math.min(w.ay, w.by) / S) - 1, i1 = Math.floor(Math.max(w.ay, w.by) / S) + 1;
    const j0 = Math.floor(Math.min(w.ax, w.bx) / S) - 1, j1 = Math.floor(Math.max(w.ax, w.bx) / S) + 1;
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 40000) return; // absurd wall: skip the index, never the wall
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = `${i},${j}`;
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = []));
      b.push(n);
    }
  });
  return {
    /** Does the step from px point p to q cross a wall that blocks it? */
    crosses(px, py, qx, qy) {
      const seen = new Set();
      const i0 = Math.floor(Math.min(py, qy) / S), i1 = Math.floor(Math.max(py, qy) / S);
      const j0 = Math.floor(Math.min(px, qx) / S), j1 = Math.floor(Math.max(px, qx) / S);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        for (const n of buckets.get(`${i},${j}`) ?? []) {
          if (seen.has(n)) continue;
          seen.add(n);
          const w = walls[n];
          if (w.ignoresFrom?.(px, py)) continue;
          if (segmentsCross(px, py, qx, qy, w.ax, w.ay, w.bx, w.by)) return true;
        }
      }
      return false;
    },
  };
}
